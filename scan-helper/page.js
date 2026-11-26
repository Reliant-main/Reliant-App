// Reliant Scan Helper — runs on the CashMonkey page (only on sites staff turned on).
// READ-ONLY toward CashMonkey: it listens to what the barcode scanner types, reads the page to
// confirm the same ISBN shows up, and draws its own small panel. It never types into, clicks,
// or sends anything to CashMonkey. The only keys it holds back are the printed card codes
// (they start with "~"), so a card scan never lands in CashMonkey's search box.
(() => {
  if (window.__relScanHelper) return; window.__relScanHelper = true;
  const { isbn13, isbn10, isbnsIn } = self.RSH_ISBN;
  const TOP = window === window.top;
  const KEY = location.origin + location.pathname.replace(/\/\d+(?=\/|$)/g, "/#");   // which page a learned spot belongs to
  const MAX_GAP = 60;      // ms between scanner keystrokes (people type slower)
  const MIN_LEN = 8;       // shortest code we count as a scan
  const LOOK_MS = 8000;    // how long to wait for CashMonkey to show the scanned ISBN
  // After the helper is updated or reloaded, this page keeps running the old copy, which can no longer
  // reach the helper ("Extension context invalidated"). Then: stop, and tell staff to refresh the page.
  let dead = false;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  function goneStale() {
    if (dead) return; dead = true;
    try {
      const box = document.createElement("div");
      box.textContent = "Reliant Scan Helper was updated — press F5 to refresh this page before scanning.";
      box.style.cssText = "position:fixed;top:0;right:0;z-index:2147483647;max-width:340px;margin:8px;padding:12px 14px;background:#7a1f16;color:#fff;font:700 15px system-ui;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.4)";
      (document.body || document.documentElement).appendChild(box);
    } catch {}
  }
  const send = (m) => {
    if (dead || !alive()) { goneStale(); return Promise.resolve(null); }
    try { return chrome.runtime.sendMessage(m).catch((e) => { if (/context invalidated/i.test(String(e))) goneStale(); return null; }); }
    catch { goneStale(); return Promise.resolve(null); }
  };
  let host = null, root = null;
  let S = {};              // latest stored state
  const ours = (e) => host && e.composedPath && e.composedPath().includes(host);

  // ---------- 1. catch what the scanner types ----------
  let buf = "", last = 0, idle = null, card = null, cardTimer = null, swallowUntil = 0;
  function endCard() {
    clearTimeout(cardTimer);
    const c = (card || "").trim().toUpperCase(); card = null; swallowUntil = performance.now() + 250;
    if (c === "FE" || c === "FRONT") { send({ type: "front" }); beep(true); }
    else if (/^B[1-9]$/.test(c)) { send({ type: "front", bin: c }); beep(true); }
    else if (c === "SKIP" || c === "DNA" || c === "NOADD") { send({ type: "skip" }); beep(false); }
    else if (c === "COPY") { send({ type: "front", copy: true }); beep(true); }
    else if (c === "UNDO") { const r = (S.st && S.st.recent || [])[0]; if (r) send({ type: "undo", ref: r.ref }); }
  }
  function finishBurst(viaEnter) {
    clearTimeout(idle);
    const txt = buf; buf = "";
    if (txt.length < MIN_LEN) return;
    if (!viaEnter && !/^[0-9Xx]{10,14}$/.test(txt)) return;      // no Enter after it: only accept clean number runs
    send({ type: "scan", raw: txt });
  }
  function onKeydown(e) {
    if (ours(e)) return;
    const k = e.key;
    if (card !== null) {                                   // inside a card code: keep it away from CashMonkey
      e.preventDefault(); e.stopImmediatePropagation(); clearTimeout(cardTimer);
      if (k === "Enter" || k === "Tab") return endCard();
      if (k.length === 1) card += k;
      cardTimer = setTimeout(endCard, 400); return;
    }
    if (k === "F8" || e.code === "NumpadSubtract") { e.preventDefault(); e.stopImmediatePropagation(); swallowUntil = performance.now() + 150; send({ type: "skip" }); beep(false); return; }
    if (k === "F9" || e.code === "NumpadAdd") { e.preventDefault(); e.stopImmediatePropagation(); swallowUntil = performance.now() + 150; send({ type: "front" }); beep(true); return; }
    if (k === "~") { e.preventDefault(); e.stopImmediatePropagation(); card = ""; buf = ""; cardTimer = setTimeout(endCard, 400); return; }
    const now = performance.now();
    if (k === "Enter" || k === "Tab") { if (now - last < MAX_GAP * 3) finishBurst(true); else buf = ""; return; }
    if (k.length !== 1) { if (k !== "Shift") buf = ""; return; }
    if (now - last > MAX_GAP) buf = "";
    buf += k; last = now;
    clearTimeout(idle); idle = setTimeout(() => finishBurst(false), 200);
  }
  function onOtherKey(e) {
    if (ours(e)) return;
    if (card !== null || performance.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  window.addEventListener("keydown", onKeydown, true);
  for (const t of ["keypress", "keyup", "beforeinput"]) window.addEventListener(t, onOtherKey, true);

  // ---------- 2. find the ISBN on the page and remember where it shows ----------
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TEMPLATE"]);
  const visible = (el) => !!(el && el.getClientRects().length);
  const learned = () => (S.st && S.st.learn && S.st.learn[KEY] || {}).path || null;
  function q(path) { try { return path ? document.querySelector(path) : null; } catch { return null; } }
  function pathOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && !/\d{3}/.test(n.id)) { parts.unshift("#" + CSS.escape(n.id)); return parts.join(" > "); }
      const i = Array.prototype.indexOf.call(n.parentElement.children, n) + 1;
      parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${i})`);
    }
    parts.unshift("body"); return parts.join(" > ");
  }
  function findOnPage(isbn) {
    const spot = q(learned());
    if (spot && isbnsIn(spot.textContent).has(isbn)) return { el: spot, atSpot: true };
    if (!document.body) return null;
    const ten = isbn10(isbn);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP.has(p.tagName) || (host && host.contains(p))) return NodeFilter.FILTER_REJECT;
        const d = n.data; if (d.length < 10) return NodeFilter.FILTER_SKIP;
        const flat = d.replace(/[\s-]/g, "");
        return flat.includes(isbn) || (ten && flat.includes(ten)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (isbnsIn(n.data).has(isbn) && visible(n.parentElement)) return { el: n.parentElement, atSpot: false };
    }
    return null;
  }
  let looking = null;
  function lookFor(cur) {
    if (!cur || !cur.isbn || cur.page !== "checking") return;
    const id = cur.at; if (looking === id) return; looking = id;
    const t0 = Date.now();
    const tick = () => {
      if (looking !== id) return;
      const hit = findOnPage(cur.isbn);
      if (hit) {
        looking = null;
        const msg = { type: "page", isbn: cur.isbn, status: "confirmed" };
        if (!hit.atSpot) Object.assign(msg, { key: KEY, path: pathOf(hit.el), relearned: !!learned() });
        lastSpot = cur.isbn; send(msg); return;
      }
      if (Date.now() - t0 > LOOK_MS) { looking = null; if (TOP) send({ type: "page", isbn: cur.isbn, status: "missing" }); return; }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 150);
  }
  // Watch the learned spot: if it changes to another ISBN without a scan (typed by hand, or CashMonkey
  // turned a price/UPC barcode into the book), that's the new current book.
  let lastSpot;
  setInterval(() => {
    const spot = q(learned()); if (!spot) return;
    const v = [...isbnsIn(spot.textContent)][0] || null;
    if (lastSpot === undefined) { lastSpot = v; return; }
    if (v && v !== lastSpot) { lastSpot = v; const c = S.st && S.st.current; if (!c || c.isbn !== v) send({ type: "pageBook", isbn: v }); }
    else if (!v) lastSpot = null;
  }, 600);

  // ---------- 2b. read what CashMonkey shows for the book (read-only) ----------
  // CashMonkey prints its full record for the book in the "Debugging info" box; the result box (REJECT / MF / …)
  // and the profit table are read from the page text above it.
  function debugText() {
    if (!document.body) return null;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT
        : /"(productxml_item|moreinfo_info|routeinfo)"/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const n = w.nextNode();
    if (!n) { const ta = [...document.querySelectorAll("textarea")].find((t) => /"(productxml_item|routeinfo)"/.test(t.value)); return ta ? ta.value : null; }
    const el = n.parentElement;
    return el && !(host && host.contains(el)) && el.textContent.length < 2000000 ? el.textContent : n.data;
  }
  function pageTop() { const t = (document.body && document.body.innerText) || ""; const i = t.indexOf("Debugging info"); return (i >= 0 ? t.slice(0, i) : t).slice(0, 20000); }
  const num = (v) => { if (v === null || v === undefined) return null; const n = parseFloat(String(v).replace(/[$,]/g, "")); return isFinite(n) ? n : null; };
  const flipName = (a) => { a = String(a || "").trim(); const i = a.indexOf(","); return i > 0 ? (a.slice(i + 1).trim() + " " + a.slice(0, i).trim()).trim() : a; };
  function readCM(cur, before, waited) {
    const dbg = debugText(); if (!dbg) return null;
    const ten = cur.isbn ? isbn10(cur.isbn) : null;
    const sig = dbg.length + ":" + dbg.slice(0, 200);
    if (cur.isbn) {
      const mentions = dbg.includes(cur.isbn) || (ten && dbg.includes(ten));
      if (!mentions && !(waited > 3000 && before && sig !== before)) return null;   // still showing the previous book
    } else {
      // Sticker code (Amazon ASIN / FNSKU): CashMonkey swaps it for the book's ISBN, so the code itself never
      // shows. Take the page once it shows a different ISBN than at the scan, or the record has changed.
      const raw = String(cur.raw || "").toLowerCase();
      const fresh = raw && (dbg.toLowerCase().includes(raw) || pageTop().toLowerCase().includes(raw));
      const now = isbnFrom(dbg, pageTop());
      const changed = (now && now !== isbnAtScan) || (before ? sig !== before : waited > 1500);
      if (!fresh && !changed) return null;
    }
    let j = null; try { j = JSON.parse(dbg.trim()); } catch {}
    const top = pageTop();
    const lines = top.split(/\n/).map((s) => s.trim()).filter(Boolean);
    const bi = lines.findIndex((l) => /^scan barcode/i.test(l));
    const result = bi >= 0 && lines[bi + 1] && lines[bi + 1].length < 60 ? lines[bi + 1] : null;
    const pm = top.match(/Profit Information[^\n]*\n[\s\S]{0,160}?profit\s+(-?\$?[\d.,]+)\s+(-?\$?[\d.,]+)/i);
    const ci = top.indexOf("Normal Categories");
    const cm = ci >= 0 ? top.slice(ci + 17, ci + 200).match(/^\s*(\d+)\s*[-.]\s*(\d+)\s*\n\s*([^\n]{2,80})/) : null;
    const pr = (j && j.productxml_item) || {};
    const ri = (j && j.routeinfo) || {};
    const fm = (j && j.fees_merchant) || {}, ff = (j && j.fees_fba) || {};
    const ok = j && j.okroutes && typeof j.okroutes === "object" && !Array.isArray(j.okroutes) ? j.okroutes : {};
    const fails = (j && j.failreasons) || {};
    const cats = []; const pci = pr.productcategoryinfo || {};
    for (const k in pci) {
      const tr = (pci[k] && pci[k].category_tree) || [];
      const names = tr.map((x) => x && x.amazonproductcategory_name).filter((x) => x && !/^(Books|Subjects|United States)$/.test(x));
      if (names.length) cats.push(names.reverse().join(" > "));
    }
    const data = Object.assign({}, pr);
    for (const k of ["imageurls", "itemdimensions", "packagedimensions", "chosendimensions", "productcategoryinfo"]) delete data[k];
    data.categories = cats;
    const authors = Array.isArray(pr.authors) && pr.authors.length ? pr.authors.map(flipName).join(" & ") : flipName(pr.authors_string);
    return {
      result: ri.loggedscan_route || ri.routetextoverride || result, result_text: ri.routedisplaytext_plain || result,
      cm_color: ri.routebackground || null, route_rule: ri.routename || null,
      ok_routes: Object.keys(ok), sbyb_quote: ok.sbyb && ok.sbyb.sbyb_item ? num(ok.sbyb.sbyb_item.quote) : null,
      fail_reasons: Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 3) : v])),
      profit_fba: pm ? num(pm[1]) : num(ff.total_profit), profit_mf: pm ? num(pm[2]) : num(fm.total_profit),
      target_mf: num(fm.targetprice), target_fba: num(ff.targetprice),
      cm_number: cm ? cm[1] + " - " + cm[2] : null, cm_cat: cm ? cm[3].trim() : null, amazon_category: cats[0] || null,
      category: cm ? cm[3].trim() : (cats[0] || null),
      title: pr.title || null, author: authors || null, publisher: pr.publisher || null, binding: pr.binding || null,
      published: pr.publicationdate || pr.releasedate || null, edition: pr.edition || null, pagecount: pr.pagecount || null,
      listprice: num(pr["listprice-msrp"]), salesrank: num(pr.salesrank_main), image: pr.imageurl || null,
      parsed: !!j, data, isbn_found: isbnFrom(dbg, top),
      _dbg: dbg, _top: top,
    };
  }
  // The book's ISBN as CashMonkey reports it (used when the scanned sticker wasn't an ISBN, e.g. an Amazon
  // ASIN / FNSKU label): isbn_13 in its record, else the "isbn-13:" line on the page, else its ISBN-10.
  function isbnFrom(dbg, top) {
    const m13 = (dbg || "").match(/"isbn_13"\s*:\s*"(97[89]\d{10})"/) || (top || "").match(/isbn-13:\s*(97[89]\d{10})/i);
    if (m13 && isbn13(m13[1])) return isbn13(m13[1]);
    const m10 = (dbg || "").match(/"isbn_?10"\s*:\s*"(\d{9}[\dXx])"/) || (top || "").match(/isbn-10:\s*(\d{9}[\dXx])/i);
    return m10 && isbn13(m10[1]) ? isbn13(m10[1]) : null;
  }
  let reading = null;
  function captureCM(cur) {
    if (!TOP || !cur || (!cur.isbn && !(cur.raw && cur.from === "scan")) || cur.cmAt === cur.at || reading === cur.at) return;
    const id = cur.at; reading = id;
    const before = dbgAtScan, t0 = Date.now();
    const tick = () => {
      if (reading !== id) return;
      const r = readCM(cur, before, Date.now() - t0);
      if (r) {
        reading = null;
        const st = S.st || {};
        const sample = (st.sampled || 0) < 5 ? { page: r._top, debug: (r._dbg || "").slice(0, 400000) } : null;
        delete r._dbg; delete r._top;
        send({ type: "cm", at: id, isbn: cur.isbn || r.isbn_found || null, cm: r, sample });
        return;
      }
      if (Date.now() - t0 > (cur.isbn ? 10000 : 30000)) {
        reading = null;
        const sample = cur.isbn ? null : { page: pageTop(), debug: (debugText() || "").slice(0, 400000) };
        send({ type: "cm", at: id, isbn: cur.isbn, cm: null, sample }); return;
      }
      setTimeout(tick, 300);
    };
    setTimeout(tick, 400);
  }
  // remember what the debugging box said at the moment of a scan, so we can tell when it changes
  let dbgAtScan = null;
  let isbnAtScan = null;
  window.addEventListener("keydown", (e) => { if (e.key === "Enter" && TOP) { const d = debugText(); dbgAtScan = d ? d.length + ":" + d.slice(0, 200) : null; try { isbnAtScan = isbnFrom(d, pageTop()); } catch { isbnAtScan = null; } } }, true);

  // ---------- 3. the panel (top frame only) ----------
  function beep(ok) {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = ok ? 880 : 220; g.gain.value = 0.06; o.connect(g); g.connect(a.destination); o.start();
      setTimeout(() => { o.stop(); a.close(); }, ok ? 120 : 350);
    } catch {}
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CSS_TEXT = `
    :host { all: initial; }
    .p { position: fixed; width: 300px; box-sizing: border-box; z-index: 2147483647; background: #10261f; color: #efe7d4;
         border: 1px solid #2f5348; font: 13px system-ui, "Segoe UI", sans-serif; overflow: auto; }
    .p.dock { top: 0; bottom: 0; border-radius: 0; box-shadow: none; }
    .p.dock.right { right: 0; border-width: 0 0 0 2px; } .p.dock.left { left: 0; border-width: 0 2px 0 0; }
    .p.float { border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.35); max-height: calc(100vh - 16px); }
    .hd { display: flex; align-items: center; gap: 4px; padding: 8px 10px; border-bottom: 1px solid #2f5348; }
    .p.float .hd { cursor: move; }
    .cmr { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .chip { font: 800 13px system-ui; padding: 3px 10px; border-radius: 5px; letter-spacing: .03em; }
    .chip.rej { background: #d62a1e; color: #fff; } .chip.acc { background: #1e8a2e; color: #fff; } .chip.miss { background: #efe7d4; color: #10261f; }
    .ttl { margin-top: 4px; font-weight: 600; }
    .banner { margin: 8px -10px 0; height: 72px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 8px;
              font-weight: 800; letter-spacing: .05em; line-height: 1.05; }
    .btop { font: 700 11px system-ui; letter-spacing: .18em; opacity: .85; }
    .btag { font: 800 13px system-ui; letter-spacing: .08em; padding: 2px 10px; border-radius: 4px; border: 2px solid currentColor; }
    .bsub { font: 600 11px system-ui; letter-spacing: .02em; opacity: .9; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; box-shadow: 0 0 0 1px #2f5348; }
    .hd b { color: #d2a54a; font-size: 13px; flex: 1; }
    .bd { padding: 10px; display: grid; gap: 10px; }
    .lbl { font: 600 10px system-ui; letter-spacing: .07em; text-transform: uppercase; color: #b9b29f; }
    .dim { color: #b9b29f; } .ok { color: #8fc27a; } .bad { color: #ef8a6f; } .warn { color: #e8c062; }
    button { font: 600 12px system-ui; background: #173329; color: #efe7d4; border: 1px solid #2f5348; border-radius: 6px; padding: 5px 8px; cursor: pointer; }
    button:hover { border-color: #d2a54a; }
    .x { padding: 2px 7px; }
    .fe { width: 100%; padding: 16px 8px; font: 800 20px system-ui; letter-spacing: .04em; background: #d2a54a; color: #10261f; border: 0; border-radius: 8px; }
    .dna { width: 100%; padding: 12px 8px; font: 800 20px system-ui; letter-spacing: .04em; background: transparent; color: #ef8a6f; border: 3px solid #ef8a6f; border-radius: 8px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .dna small { font: 600 11px system-ui; letter-spacing: 0; color: #b9b29f; }
    .dna:hover { background: #3a1f1a; border-color: #ef8a6f; }
    .mini .dna { padding: 8px; font-size: 14px; flex: 1; border-width: 2px; }
    .added { font: 800 15px system-ui; color: #8fc27a; } .added.no { color: #ef8a6f; }
    .pool { font: 700 9px system-ui; letter-spacing: .06em; padding: 1px 4px; border-radius: 3px; background: #1e8a2e; color: #fff; }
    .fe:disabled { background: #3a4f47; color: #9aa59f; cursor: default; }
    .isbn { font: 700 20px ui-monospace, Consolas, monospace; letter-spacing: .02em; }
    input, select { width: 100%; box-sizing: border-box; background: #0b1c16; color: #efe7d4; border: 1px solid #2f5348; border-radius: 6px; padding: 6px; font: 13px system-ui; }
    .row { display: flex; gap: 6px; align-items: center; } .row > .grow { flex: 1; }
    .rec { display: grid; grid-template-columns: 1fr auto; gap: 3px 6px; align-items: center; max-height: 170px; overflow: auto; }
    .rec .i { font: 12px ui-monospace, Consolas, monospace; } .rec small { display: block; font: 11px system-ui; }
    .cnt { display: grid; grid-template-columns: auto 1fr 1fr 1fr; gap: 2px 8px; font-size: 12px; } .cnt b { text-align: right; }
    .flash { padding: 6px 8px; border-radius: 6px; background: #173329; }
    .flash.ok { background: #24452e; color: #cfe8c2; } .flash.bad { background: #4a2219; color: #ffd2c6; } .flash.warn { background: #4a3d16; color: #ffe9a8; }
    .put { display: flex; align-items: baseline; gap: 10px; padding: 10px; border: 2px solid #d2a54a; border-radius: 8px; }
    .put span { font: 700 11px system-ui; letter-spacing: .08em; color: #b9b29f; } .put b { font: 800 26px system-ui; color: #d2a54a; flex: 1; }
    .put small { font: 600 12px system-ui; color: #b9b29f; }
    .mini { display: flex; gap: 6px; align-items: center; padding: 6px; }
    .mini .fe { padding: 8px; font-size: 14px; flex: 1; }
  `;
  function mount() {
    if (host || !TOP || !document.body) return;
    host = document.createElement("reliant-scan-helper");
    root = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    // Buttons never take focus away from CashMonkey's scan box, so the next scan still lands there.
    root.addEventListener("mousedown", (e) => {
      const b = e.target.closest("button"); if (b) { e.preventDefault(); return; }
      const hd = e.target.closest(".hd"); const pnl = root.querySelector(".p");
      if (!hd || !pnl || !pnl.classList.contains("float")) return;
      e.preventDefault();   // dragging doesn't take focus from CashMonkey either
      const r = pnl.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { ui.x = ev.clientX - dx; ui.y = ev.clientY - dy; pnl.style.left = Math.max(0, ui.x) + "px"; pnl.style.top = Math.max(0, ui.y) + "px"; };
      const up = () => { window.removeEventListener("mousemove", move, true); window.removeEventListener("mouseup", up, true); ui.x = Math.max(0, ui.x); ui.y = Math.max(0, ui.y); saveUi(); };
      window.addEventListener("mousemove", move, true); window.addEventListener("mouseup", up, true);
    });
    window.addEventListener("resize", () => render());
    root.addEventListener("click", onClick);
    // Clicks and focus changes inside the panel stay inside it, so CashMonkey's "jump back to the
    // ISBN box" doesn't fire while someone is typing a name or picking a load. Nothing is sent to CashMonkey.
    for (const t of ["mousedown", "mouseup", "click", "pointerdown", "pointerup", "focusin", "focusout", "keydown", "keyup", "keypress", "input"]) {
      host.addEventListener(t, (e) => e.stopPropagation());
    }
    const intoPanel = (e) => e.relatedTarget === host || (e.relatedTarget && host.contains(e.relatedTarget));
    for (const t of ["blur", "focusout"]) {
      window.addEventListener(t, (e) => { if (e.target !== host && intoPanel(e)) e.stopImmediatePropagation(); }, true);
    }
    // If CashMonkey still grabs the cursor back within a moment of a click in a panel box, put it back.
    root.addEventListener("focusin", (e) => { if (/^(INPUT|SELECT)$/.test(e.target.tagName)) { lastPanelBox = e.target; lastPanelAt = Date.now(); } });
    root.addEventListener("keydown", () => { if (lastPanelBox && root.activeElement === lastPanelBox) lastPanelAt = Date.now(); });
    document.addEventListener("focusin", (e) => {
      if (e.target === host || !lastPanelBox || !lastPanelBox.isConnected || Date.now() - lastPanelAt > 1500) return;
      setTimeout(() => { if (lastPanelBox && lastPanelBox.isConnected && document.activeElement !== host) lastPanelBox.focus({ preventScroll: true }); }, 0);
    }, true);
    root.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") lastPanelAt = 0; });
    // Remember CashMonkey's own box, so the cursor can go back there once the shift is started.
    document.addEventListener("focusin", (e) => { if (e.target !== host && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) lastOutside = e.target; }, true);
    // A real click somewhere else (like back into CashMonkey's ISBN box) always wins.
    window.addEventListener("mousedown", (e) => { if (!(e.composedPath && e.composedPath().includes(host))) lastPanelBox = null; }, true);
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "staff") start(); });
    render();
  }
  async function start() {
    const staff = root.getElementById("staff").value.trim(), load_id = +root.getElementById("load").value;
    const out = root.getElementById("startMsg");
    if (!staff) return (out.textContent = "Type who's scanning.");
    if (!load_id) return (out.textContent = "Pick the load.");
    out.textContent = "Starting…";
    const r = await send({ type: "start", staff, load_id });
    if (!r || !r.ok) out.textContent = (r && r.error) || "Couldn't reach the Reliant App.";
    else { ui.change = false; render(); backToCashMonkey(); }
  }
  let lastOutside = null, lastPanelBox = null, lastPanelAt = 0;
  const backToCashMonkey = () => { lastPanelBox = null; if (lastOutside && lastOutside.isConnected) setTimeout(() => lastOutside.focus({ preventScroll: true }), 0); };
  const ui = { min: false, hidden: false, mode: "right", x: null, y: 80, change: false };
  try { chrome.storage.local.get("ui").then(({ ui: u }) => { if (u) Object.assign(ui, u, { change: false }); render(); }); } catch {}
  const saveUi = () => { try { chrome.storage.local.set({ ui: { min: ui.min, hidden: ui.hidden, mode: ui.mode, x: ui.x, y: ui.y } }); } catch {} };
  // Docked: the CashMonkey page narrows to make room, so the panel covers nothing.
  function pushPage() {
    const h = document.documentElement.style;
    h.removeProperty("margin-left"); h.removeProperty("margin-right"); h.removeProperty("position");
    if (!ui.min && !ui.hidden && ui.mode !== "float") {
      h.setProperty(ui.mode === "left" ? "margin-left" : "margin-right", "300px", "important");
      h.setProperty("position", "relative", "important");   // so CashMonkey's side column moves over too
    }
  }
  async function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    const a = b.dataset.a;
    if (a === "fe") { send({ type: "front" }); beep(true); }
    else if (a === "copy") { send({ type: "front", copy: true }); beep(true); }
    else if (a === "skip") { send({ type: "skip" }); beep(false); }
    else if (a === "undo") send({ type: "undo", ref: b.dataset.ref });
    else if (a === "min") { ui.min = !ui.min; saveUi(); render(); }
    else if (a === "hide") { ui.hidden = true; saveUi(); render(); }
    else if (a === "dockL" || a === "dockR" || a === "float") { ui.mode = a === "dockL" ? "left" : a === "dockR" ? "right" : "float"; ui.min = false; saveUi(); render(); }
    else if (a === "change") { ui.change = true; send({ type: "hello" }); render(); }
    else if (a === "cancel") { ui.change = false; render(); }
    else if (a === "start") start();
    else if (a === "end") { if (b.dataset.sure) send({ type: "end" }); else { b.dataset.sure = 1; b.textContent = "Sure? End"; } }
    else if (a === "retry") send({ type: "refresh" });
  }
  const pageNote = (c) => !c ? "" : !c.isbn ? (c.cmAt ? `<span class="bad">✕ “${esc(c.raw)}” — CashMonkey gave no ISBN for this code</span>` : `<span class="dim">Sticker code “${esc(c.raw)}” — getting the ISBN from CashMonkey…</span>`)
    : c.page === "confirmed" ? `<span class="ok">✓ matches the CashMonkey screen</span>`
    : c.page === "checking" ? `<span class="dim">… looking for it on the CashMonkey screen</span>`
    : `<span class="warn">⚠ not seen on the CashMonkey screen — check before sending</span>`;
  const statusOf = (r) => r.status === "saved" ? `<small class="ok">saved${r.title ? " · " + esc(r.title) : ""}${r.copies > 1 ? ` · ${r.copies} copies this shift` : ""}</small>`
    : r.status === "problem" ? `<small class="bad">${esc(r.msg || "problem")}</small>`
    : `<small class="warn">${r.status === "waiting" ? "waiting for internet…" : "sending…"}</small>`;
  // The big colored banner. rt: { label, bg, fg, pattern, top, tag, sub }.
  const RAINBOW = "linear-gradient(90deg,#e8559b,#f28c28,#ffd60a,#1e8a2e,#6ec6f0,#1f3a93,#6b3fa0)";
  function bannerHtml(rt, mini) {
    const hex = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(v || "") ? v : d);
    const bg = rt.pattern === "rainbow" ? RAINBOW : hex(rt.bg, "#3a4f47");
    const fg = rt.pattern === "rainbow" ? "#FFFFFF" : hex(rt.fg, "#ffffff");
    const shadow = rt.pattern === "rainbow" ? "text-shadow:0 0 4px #000,0 0 2px #000;" : "";
    const edge = /^#(0{3}|0{6}|f{3}|f{6})$/i.test(rt.bg || "") && rt.pattern !== "rainbow" ? "box-shadow: inset 0 0 0 2px #b9b29f;" : "";
    const n = String(rt.label || "").length;
    const size = mini ? (n > 14 ? 15 : 20) : n > 17 ? 20 : n > 12 ? 24 : 32;
    const tag = rt.tag ? `<span class="btag" style="${shadow}">${esc(rt.tag)}</span>` : "";
    if (mini) return `<div class="banner" style="margin:0;height:${rt.tag ? 58 : 46}px;flex-direction:column;background:${bg};color:${fg};${edge}${shadow}"><span style="font-size:${size}px">${esc(rt.label)}</span>${tag}</div>`;
    return `<div class="banner" style="height:${rt.top || rt.tag || rt.sub ? 92 : 72}px;flex-direction:column;gap:3px;background:${bg};color:${fg};${edge}${shadow}">
        ${rt.top ? `<span class="btop">${esc(rt.top)}</span>` : ""}<span style="font-size:${size}px">${esc(rt.label)}</span>${tag}${rt.sub ? `<span class="bsub">${esc(rt.sub)}</span>` : ""}</div>`;
  }
  function cmBlock(c) {
    if (!c.isbn) return "";
    const m = c.cm;
    if (m === undefined) return `<div class="dim" style="font-size:12px;margin-top:6px">Reading CashMonkey…</div>`;
    if (!m) return `<div class="warn" style="font-size:12px;margin-top:6px">Couldn't read CashMonkey's details for this one.</div>`;
    const rt = c.route;
    const hex = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(v || "") ? v : d);
    const banner = rt ? `${bannerHtml(rt, false)}
      <div class="dim" style="font-size:12px;margin-top:6px">${esc(rt.reason || "")}</div>` : "";
    const pf = m.profit_mf;
    const cmCol = hex(m.cm_color, null);
    return `${banner}
      <div style="margin-top:4px">CashMonkey <b style="${cmCol ? `color:${cmCol === "#FFF" || cmCol === "#FFFFFF" ? "#efe7d4" : cmCol};` : ""}filter:brightness(1.4)">${esc(m.result || "?")}</b>${pf === null || pf === undefined ? "" : ` · Profit <b class="${pf < 0 ? "bad" : "ok"}">${pf < 0 ? "−" : ""}$${Math.abs(pf).toFixed(2)}</b> <span class="dim">(merchant)</span>`}</div>
      ${m.title ? `<div class="ttl">${esc(m.title)}</div><div class="dim" style="font-size:12px">${esc([m.author, m.binding, (m.published || "").slice(0, 4)].filter(Boolean).join(" · "))}</div>` : ""}
      ${m.category ? `<div class="dim" style="font-size:12px">${m.cm_number ? esc(m.cm_number) + " · " : ""}${esc(m.category)}</div>` : ""}`;
  }
  function render() {
    if (!root) return;
    const keep = {}; for (const id of ["staff", "load"]) { const el = root.getElementById(id); if (el) keep[id] = el.value; }
    const act = root.activeElement, fid = act && act.id, sel = act && typeof act.selectionStart === "number" ? [act.selectionStart, act.selectionEnd] : null;
    draw();
    for (const id in keep) { const el = root.getElementById(id); if (el && keep[id]) el.value = keep[id]; }
    if (fid) { const el = root.getElementById(fid); if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch {} } }
  }
  // What the big button area shows for the current book.
  function actionArea(c, sh, mini) {
    if (!sh || !c || !c.isbn) return mini ? `<button class="fe" disabled>—</button>` : `<button class="fe" disabled>ADD TO INVENTORY</button>`;
    const auto = (S.rules && S.rules.auto_add) || { stream: 1, ebay: 1, tt_then_back: 1, sbyb: 1, accept: 1 };
    const pool = c.pool === "accept" ? "ACCEPT inventory" : "STREAM inventory";
    if (mini) {
      if (c.sent) return `<button class="dna" data-a="skip">DO NOT ADD</button>`;
      if (c.notAdded) return `<button class="fe" disabled>NOT ADDED</button>`;
      return `<button class="fe" data-a="fe">ADD</button>`;
    }
    if (c.notAdded) return `<div class="added no">✕ Not added — poor condition</div>
      <div class="row"><button class="grow" data-a="fe">Add it after all</button></div>`;
    if (c.sent) return `<div class="added">✓ Added to ${pool}</div>
      <button class="dna" data-a="skip">DO NOT ADD<small>poor condition · F8 · DO NOT ADD card</small></button>
      <div class="row"><button class="grow" data-a="copy">+ Add another copy</button></div>`;
    if (c.cm === undefined) return `<button class="dna" data-a="skip">DO NOT ADD<small>poor condition · F8 · DO NOT ADD card</small></button>`;
    if (c.dup) return `<div class="added no">Same ISBN as the last book — not added twice</div>
      <button class="fe" data-a="copy">ADD ANOTHER COPY</button>`;
    const rk = c.route && c.route.key;
    if (rk && rk !== "hand_search" && !auto[rk]) return `<div class="dim" style="font-size:12px">Not kept in inventory.</div>`;
    return `<button class="fe" data-a="fe">ADD TO INVENTORY</button>
      <div class="dim" style="font-size:11px;margin-top:-6px">or scan the ADD TO INVENTORY card · F9 · Alt+Shift+F</div>`;
  }
  function draw() {
    const st = S.st || {}, sh = st.shift, c = st.current, fl = st.flash && Date.now() - st.flash.at < 6000 ? st.flash : null;
    const canSend = !!(sh && c && c.isbn);
    const feLabel = c && c.sent && !c.again ? "ADDED ✓" : "ADD TO INVENTORY";
    pushPage();
    if (ui.hidden) { root.innerHTML = ""; return; }   // hidden: nothing on screen; scans, F9 and cards still work
    const floating = ui.min || ui.mode === "float";
    const W = window.innerWidth, Hh = window.innerHeight;
    const x = Math.min(Math.max(ui.x == null ? W - 312 : ui.x, 0), Math.max(W - 120, 0)), y = Math.min(Math.max(ui.y || 0, 0), Math.max(Hh - 60, 0));
    const pos = floating ? `left:${x}px;top:${y}px;` : "";
    let h = `<style>${CSS_TEXT}</style><div class="p ${floating ? "float" : "dock " + ui.mode}" style="${pos}">`;
    if (ui.min) {
      h += `<div class="mini hd" style="padding:6px">${actionArea(c, sh, true)}<button class="x" data-a="min" title="Open">▢</button><button class="x" data-a="hide" title="Hide (bring it back with the Reliant icon or Alt+Shift+R)">×</button></div>`;
      if (c && c.route) h += bannerHtml(c.route, true);
      if (S.rules && S.rules.totes_on && c && c.sent && c.tote && !c.tote.none) h += `<div class="bd" style="padding-top:0"><div class="put"><span>PUT IN</span><b>${esc(c.tote.label)}</b></div></div>`;
      if (fl) h += `<div class="bd" style="padding-top:0"><div class="flash ${fl.kind}">${esc(fl.msg)}</div></div>`;
      root.innerHTML = h + `</div>`; return;
    }
    h += `<div class="hd"><b>Reliant</b><span class="dim" style="font-size:11px;flex:1">${esc(S.station || "")}</span>
          <button class="x" data-a="dockL" title="Dock on the left">⇤</button><button class="x" data-a="float" title="Float (drag by this bar)">❐</button><button class="x" data-a="dockR" title="Dock on the right">⇥</button><button class="x" data-a="min" title="Shrink">–</button><button class="x" data-a="hide" title="Hide (bring it back with the Reliant icon or Alt+Shift+R)">×</button></div><div class="bd">`;
    if (fl) h += `<div class="flash ${fl.kind}">${esc(fl.msg)}</div>`;
    if (!S.code) {
      h += `<div class="bad">Not connected. Click the Reliant icon in Chrome's toolbar and paste this computer's station code.</div>`;
    } else if (!sh || ui.change) {
      const loads = S.loads || [];
      const groups = {};
      for (const l of loads) (groups[l.source_name || l.source] ||= []).push(l);
      const cur = sh && sh.load && sh.load.id;
      h += `<div class="lbl">Start of shift</div>
        <input id="staff" placeholder="Who's scanning?" value="${esc((sh && sh.staff) || S.lastStaff || "")}" autocomplete="off">
        <select id="load"><option value="">Load / source…</option>${Object.entries(groups).map(([g, ls]) =>
          `<optgroup label="${esc(g)}">${ls.map((l) => `<option value="${l.id}" ${l.id === cur ? "selected" : ""}>${esc(l.name)} (${esc(l.source)})</option>`).join("")}</optgroup>`).join("")}</select>
        <div class="row"><button class="grow" data-a="start">Start shift</button>${sh ? `<button data-a="cancel">Cancel</button>` : ""}</div>
        <div id="startMsg" class="dim">${loads.length ? "" : "Loading the list of loads…"}</div>
        <div class="dim" style="font-size:11px">Cursor jumping back to CashMonkey? Start the shift from the Reliant icon in Chrome's toolbar instead.</div>`;
    } else {
      const sv = st.server || {}, ss = sv.shift || { sent: 0 }, td = sv.today || { scanned: 0, sent: 0 };
      const qS = (st.queue || []).filter((q) => (q.pool || "stream") === "stream").length, qA = (st.queue || []).length - qS;
      const sentShift = (ss.sent || 0) + qS, accShift = (ss.accepts || 0) + qA;
      const unsynced = Math.max(0, (st.scanned || 0) - (sh.syncedScanned || 0));
      const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
      const shDay = sh.started_at ? new Date(sh.started_at) : null;
      const oldShift = shDay && shDay.toDateString() !== new Date().toDateString();
      h += `<div class="row"><div class="grow"><div class="lbl">Shift</div>${esc(sh.staff)} · <b>${esc(sh.load.source_code)}</b> <span class="dim">${esc(sh.load.name)}</span></div>
              <button data-a="change">Change</button><button data-a="end">End</button></div>
        ${oldShift ? `<div class="added no" style="font-size:12px">This shift started ${esc(shDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}. Press End, then start today's shift.</div>` : ""}
        <div><div class="lbl">Current book</div>
          ${c ? `<div class="isbn">${esc(c.isbn || c.raw)}</div><div>${pageNote(c)}</div>${cmBlock(c)}` : `<div class="dim">Scan a book into CashMonkey.</div>`}</div>
        ${actionArea(c, sh, false)}`;
      const totesOn = !!(S.rules && S.rules.totes_on);
      if (!totesOn) {}
      else if (c && c.sent && c.tote) h += c.tote.none ? `<div class="put bad">No open tote — set it aside</div>`
        : `<div class="put"><span>PUT IN</span><b>${esc(c.tote.label)}</b><small>${c.tote.books_in}/${c.tote.capacity}</small></div>`;
      else if (c && c.sent) h += `<div class="put dim"><span>Finding a tote…</span></div>`;
      const rec = st.recent || [];
      if (rec.length) h += `<div><div class="lbl">Added to inventory</div><div class="rec">${rec.slice(0, 5).map((r) =>
          `<div>${r.route ? `<span class="dot" style="background:${r.route.pattern === "rainbow" ? RAINBOW : /^#[0-9a-f]{3,8}$/i.test(r.route.bg || "") ? r.route.bg : "#3a4f47"}" title="${esc(r.route.label + (r.route.tag ? " · " + r.route.tag : ""))}"></span>` : ""}<span class="i">${esc(r.isbn)}</span>${r.pool === "accept" ? ` <b class="pool">ACCEPT</b>` : ""}${r.tote ? ` <b style="font-size:11px">→ ${esc(r.tote)}</b>` : ""}${statusOf(r)}</div><button class="x" data-a="undo" data-ref="${esc(r.ref)}">Undo</button>`).join("")}</div></div>`;
      h += `<div class="cnt"><span></span><span class="dim">Scanned</span><span class="dim">Stream</span><span class="dim">Accepts</span>
              <span class="dim">This shift</span><b>${st.scanned || 0}</b><b>${sentShift} <span class="dim">(${pct(sentShift, st.scanned)})</span></b><b>${accShift}</b>
              <span class="dim">Today</span><b>${(td.scanned || 0) + unsynced}</b><b>${Math.max(td.sent || 0, sentShift)}</b><b>${Math.max(td.accepts || 0, accShift)}</b></div>`;
      const fill = sv.filling;
      if (totesOn) h += `<div class="dim" style="font-size:12px">${fill ? `Filling <b style="color:#efe7d4">${esc(fill.label)}</b> · ${fill.books_in}/${fill.capacity}` : `<span class="bad">No open totes set up</span>`}</div>`;
      const lp = (st.learn || {})[KEY];
      h += `<div class="dim" style="font-size:11px">${lp ? "✓ Learned where CashMonkey shows the ISBN" + (lp.relearned ? " (re-learned)" : "") : "Learning where CashMonkey shows the ISBN — just keep scanning."}</div>`;
    }
    root.innerHTML = h + `</div></div>`;
  }

  // ---------- 4. stay in step with the background ----------
  async function load() {
    S = await chrome.storage.local.get(["st", "code", "station", "loads", "lastStaff", "connected", "rules"]);
    if (TOP) render();
    lookFor(S.st && S.st.current); captureCM(S.st && S.st.current);
  }
  let lastFlashAt = 0;
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    for (const k in ch) S[k] = ch[k].newValue;
    if (ch.ui && ch.ui.newValue) { Object.assign(ui, ch.ui.newValue); if (TOP) render(); }
    if (ch.st) {
      lookFor(S.st && S.st.current); captureCM(S.st && S.st.current);
      const f = S.st && S.st.flash;
      if (TOP && f && f.at !== lastFlashAt) { lastFlashAt = f.at; if (f.kind === "bad") beep(false); setTimeout(render, 6100); }
    }
    if (TOP) {
      // keep the shift form's typing intact while someone is filling it in
      const typing = root && root.activeElement && /^(INPUT|SELECT)$/.test(root.activeElement.tagName);
      if (!typing || ch.loads || ch.code) render();
    }
  });
  if (TOP) {
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  }
  load();
  if (TOP) send({ type: "hello" });
})();
