// Reliant Scan Helper — background.
// Holds the shift, the current book, the recent list and the send queue, and talks to the
// Reliant App (Supabase function "used-scan") with this computer's station code.
// Nothing here ever talks to CashMonkey.
importScripts("isbn.js", "rules.js");
const { isbn13 } = self.RSH_ISBN;
const URL_IN = "https://vmpysxfmfyvwheqbuicj.supabase.co/functions/v1/used-scan";
const SCRIPT_ID = "rsh-page";
const RECENT_MAX = 8;

const blank = () => ({ shift: null, current: null, recent: [], queue: [], scanned: 0, server: null, learn: {}, flash: null, lastBurst: null });
let chain = Promise.resolve();
function locked(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }
async function getSt() { const { st } = await chrome.storage.local.get("st"); return Object.assign(blank(), st || {}); }
async function putSt(st) { await chrome.storage.local.set({ st }); }
const flash = (st, msg, kind = "info") => { st.flash = { msg, kind, at: Date.now() }; };
// Which banners add the book to inventory by themselves, and to which inventory. Comes from the App's
// scan rules ("auto_add"); this is only the fallback. Books not listed (Religious, Reject, SBYB gaylord,
// hand search) are not added unless staff press ADD.
const AUTO_DEFAULT = { stream: "stream", ebay: "stream", tt_then_back: "stream", sbyb: "stream", accept: "accept" };
const POOL_NAME = { stream: "stream inventory", accept: "accept inventory" };
const routeLite = (r) => (r ? { label: r.label, bg: r.bg, fg: r.fg, pattern: r.pattern || null, tag: r.tag || null } : null);
// Queue one book to be saved (inside a locked section). Returns the ref.
function queueAdd(st, c, pool, bin) {
  const ref = newRef(st.shift.session_id);
  st.queue.push({ ref, session_id: st.shift.session_id, isbn: c.isbn, at: new Date().toISOString(), bin: bin || null, cm: c.cm || null, pool });
  st.recent.unshift({ ref, isbn: c.isbn, at: Date.now(), status: "sending", page: c.page, bin: bin || null, pool, route: routeLite(c.route) });
  st.recent = st.recent.slice(0, RECENT_MAX);
  c.sent = true; c.again = false; c.ref = ref; c.pool = pool; c.tote = null; c.notAdded = false;
  return ref;
}
// What to tell staff when CashMonkey can't give an ISBN for a scanned code.
// X00… codes are Amazon warehouse labels (FNSKU): one seller's copy, which CashMonkey can't look up.
const noIsbnMsg = (raw) => `CashMonkey gave no ISBN for sticker “${raw}”. Scan the ISBN barcode on the book, or hand search.`;
const newRef = (sid) => `${sid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function post(body) {
  const { code, endpoint } = await chrome.storage.local.get(["code", "endpoint"]);   // "endpoint" only set when testing
  if (!code) throw Object.assign(new Error("This computer isn't connected yet. Click the Reliant icon and paste the station code."), { fatal: true });
  let r;
  try {
    r = await fetch(endpoint || URL_IN, { method: "POST", headers: { "content-type": "application/json", "x-station-code": code }, body: JSON.stringify(body) });
  } catch { throw Object.assign(new Error("No internet connection — will keep trying."), { offline: true }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `The Reliant App didn't answer (${r.status})`), { fatal: r.status < 500, offline: r.status >= 500 });
  return j;
}
function takeCounts(st, j) { if (j && j.shift) st.server = { shift: j.shift, today: j.today, filling: j.filling || null, at: Date.now() }; }

// ---- sending -------------------------------------------------------------
async function flush() {
  return locked(async () => {
    const st = await getSt();
    if (!st.queue.length) return;
    const left = [];
    for (const job of st.queue) {
      const rec = st.recent.find((r) => r.ref === job.ref);
      try {
        const j = await post({ type: "send", session_id: job.session_id, isbn: job.isbn, ref: job.ref, at: job.at, bin: job.bin || null, cm: job.cm || null, pool: job.pool || "stream" });
        takeCounts(st, j);
        const tote = j.tote && j.tote.ok ? j.tote : null;
        if (rec) Object.assign(rec, { status: "saved", id: j.id, title: j.title || null, copies: j.copies_this_shift || 1, msg: null, tote: tote && tote.label });
        if (st.current && st.current.ref === job.ref) st.current.tote = tote ? { label: tote.label, books_in: tote.books_in, capacity: tote.capacity } : { none: true };
        const { rules } = await chrome.storage.local.get("rules");
        const totesOn = !!(rules && rules.totes_on);   // totes are switched on in the App's scan rules
        if (totesOn && !tote && !j.repeat) flash(st, "Saved, but there's no open tote — set this book aside and ask a manager to add totes.", "bad");
        else if (totesOn && tote && tote.now_full) flash(st, `${tote.label} is now full.` + (tote.next_label ? ` Next books go in ${tote.next_label}.` : " No more open totes — ask a manager to add more."), "warn");
      } catch (e) {
        if (e.offline) { left.push(job); if (rec) Object.assign(rec, { status: "waiting", msg: e.message }); }
        else { if (rec) Object.assign(rec, { status: "problem", msg: e.message }); flash(st, e.message, "bad"); }
      }
    }
    st.queue = left;
    await putSt(st);
  });
}
async function syncCount() {
  const st = await getSt();
  if (!st.shift || st.shift.syncedScanned === st.scanned) return;
  try {
    const j = await post({ type: "count", session_id: st.shift.session_id, scanned: st.scanned });
    await locked(async () => { const s2 = await getSt(); takeCounts(s2, j); if (s2.shift) s2.shift.syncedScanned = st.scanned; await putSt(s2); });
  } catch {}
}
let countTimer = null;
function soonCount() { clearTimeout(countTimer); countTimer = setTimeout(syncCount, 10000); }
chrome.alarms.create("rsh-tick", { periodInMinutes: 1 });
chrome.alarms.create("rsh-rules", { periodInMinutes: 20 });
async function refreshRules() { try { const j = await post({ type: "rules" }); if (j.rules) await chrome.storage.local.set({ rules: j.rules }); } catch {} }
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "rsh-rules") return refreshRules(); flush(); syncCount(); });

// ---- the page script on the sites staff turned on -----------------------
let siteChain = Promise.resolve();
function registerSites() {   // one at a time, so two calls can't register the script twice
  siteChain = siteChain.then(doRegisterSites, doRegisterSites);
  return siteChain;
}
async function doRegisterSites() {
  const { sites = [] } = await chrome.storage.local.get("sites");
  const granted = [];
  for (const s of sites) if (await chrome.permissions.contains({ origins: [s + "/*"] })) granted.push(s + "/*");
  const had = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
  if (had.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  if (granted.length) await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: granted, js: ["isbn.js", "page.js"], runAt: "document_start", allFrames: true }]);
}
chrome.runtime.onInstalled.addListener(registerSites);
chrome.runtime.onStartup.addListener(registerSites);

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "front-end") handle({ type: "front" });
  if (cmd === "toggle-panel") { const { ui = {} } = await chrome.storage.local.get("ui"); await chrome.storage.local.set({ ui: { ...ui, hidden: !ui.hidden, min: false } }); }
});

// ---- actions --------------------------------------------------------------
async function handle(msg) {
  switch (msg.type) {
    case "scan": return locked(async () => {
      // a barcode was scanned into CashMonkey (any code; only ISBNs can be sent)
      const st = await getSt();
      const isbn = isbn13(msg.raw);
      st.scanned += 1;
      st.lastBurst = { raw: msg.raw, isbn, at: Date.now() };
      st.prev = st.current ? { isbn: st.current.isbn, at: Date.parse(st.current.at) } : null;
      if (st.flash && st.flash.kind !== "bad") st.flash = null;
      st.current = { raw: msg.raw, isbn, at: new Date().toISOString(), from: "scan", page: isbn ? "checking" : "n/a", sent: false, again: false };
      if (!st.shift) flash(st, "Start a shift first (pick who's scanning and the load).", "bad");
      await putSt(st); soonCount();
    });
    case "cm": {
      // what CashMonkey showed for the current book
      const full = msg.cm;
      let sample = null, autoSend = false, stickerSample = null;
      await locked(async () => {
        const st = await getSt();
        if (st.current && st.current.at === msg.at) {
          const c0 = st.current;
          if (full && !c0.isbn) {
            // the scanned code wasn't an ISBN (Amazon ASIN / FNSKU sticker): use the ISBN CashMonkey found for it
            const found = isbn13(full.isbn_found || "");
            if (found) { c0.isbn = found; c0.page = "confirmed"; c0.from = "CashMonkey (sticker " + c0.raw + ")"; if (st.lastBurst && st.lastBurst.at && !st.lastBurst.isbn) st.lastBurst.isbn = found; }
            else flash(st, noIsbnMsg(c0.raw), "bad");
          }
          if (full) {
            const { rules } = await chrome.storage.local.get("rules");
            const route = self.RSH_RULES.decide(full, rules);
            const { data, ...small } = full;
            if (route) { small.route_key = route.key; small.route_reason = route.reason; small.group = route.group; small.box = route.box || null; small.inventory_tag = route.tag || null; }
            st.current.cm = small; st.current.route = route;
            const c = st.current;
            const pool = route ? ((rules && rules.auto_add) || AUTO_DEFAULT)[route.key] : null;
            if (pool && st.shift && c.isbn && !c.sent && !c.skip && !c.notAdded) {
              const prev = st.prev;   // the book scanned just before this one
              if (prev && prev.isbn === c.isbn && Date.now() - prev.at < 90000) {
                c.dup = true;
                flash(st, "Same ISBN as the last book — not added twice. If this is another copy, press ADD ANOTHER COPY.", "warn");
              } else {
                queueAdd(st, c, pool);
                autoSend = true;
              }
            }
          } else { st.current.cm = null; st.current.route = null; if (!c0.isbn) { flash(st, noIsbnMsg(c0.raw), "bad"); if (msg.sample) stickerSample = { raw: c0.raw, sample: msg.sample }; } }
          st.current.cmAt = msg.at;
        }
        if (msg.sample && full && (st.sampled || 0) < 5) { st.sampled = (st.sampled || 0) + 1; sample = msg.sample; }
        await putSt(st);
      });
      if (autoSend) flush();
      // a sticker CashMonkey didn't turn into an ISBN: keep a copy of the page so it can be checked
      if (stickerSample) post({ type: "capture", isbn: stickerSample.raw, cm: {}, sample: stickerSample.sample }).catch(() => {});
      const capIsbn = msg.isbn || (full && isbn13(full.isbn_found || ""));
      if (full && capIsbn) post({ type: "capture", isbn: capIsbn, cm: full, sample }).catch(() => {});
      return;
    }
    case "pageBook": return locked(async () => {
      // the learned spot on the page now shows a different ISBN (typed in by hand, or CashMonkey
      // turned a UPC/price barcode into the book's ISBN)
      const st = await getSt();
      const isbn = isbn13(msg.isbn); if (!isbn) return;
      if (st.current && st.current.isbn === isbn) return;
      const lb = st.lastBurst;
      const fromBadScan = lb && !lb.isbn && Date.now() - lb.at < 30000;
      // CashMonkey hasn't caught up to the last scan yet (the spot still shows the book before it)
      if (lb && lb.isbn && Date.now() - lb.at < 10000 && st.current && st.current.page !== "confirmed") return;
      if (!fromBadScan) st.scanned += 1;
      if (!fromBadScan) st.prev = st.current ? { isbn: st.current.isbn, at: Date.parse(st.current.at) } : null;
      st.current = { raw: fromBadScan ? lb.raw : isbn, isbn, at: new Date().toISOString(), from: fromBadScan ? "page (from " + lb.raw + ")" : "page", page: "confirmed", sent: false, again: false };
      await putSt(st); soonCount();
    });
    case "page": return locked(async () => {
      // result of looking for the current ISBN on the page
      const st = await getSt();
      if (msg.path && msg.key) st.learn[msg.key] = { path: msg.path, at: Date.now(), relearned: !!msg.relearned };
      if (st.current && st.current.isbn === msg.isbn) {
        if (msg.status === "confirmed" || st.current.page !== "confirmed") st.current.page = msg.status;
      }
      await putSt(st);
    });
    case "front": {
      const r = await locked(async () => {
        const st = await getSt();
        const c = st.current;
        if (!st.shift) { flash(st, "Start a shift first.", "bad"); await putSt(st); return false; }
        if (!c) { flash(st, "Scan a book into CashMonkey first.", "bad"); await putSt(st); return false; }
        if (!c.isbn) { flash(st, c.cmAt ? `CashMonkey found no ISBN for “${c.raw}” — can't add it. Scan the ISBN on the book instead.` : `Still getting the ISBN for “${c.raw}” from CashMonkey — try again in a second.`, "bad"); await putSt(st); return false; }
        const { rules } = await chrome.storage.local.get("rules");
        const auto = (rules && rules.auto_add) || AUTO_DEFAULT;
        const pool = (c.route && auto[c.route.key]) || "stream";
        if (msg.copy || c.dup) c.again = true;
        if (c.sent && !c.again) { c.again = true; flash(st, "Already added. Press again only if this is another copy.", "warn"); await putSt(st); return false; }
        const untracked = c.route && !auto[c.route.key] && c.route.key !== "hand_search";
        if (untracked && !c.sent && !c.again) { c.again = true; flash(st, `${c.route.label} books aren't kept in inventory. Press again to add it anyway.`, "warn"); await putSt(st); return false; }
        queueAdd(st, c, pool, msg.bin);
        c.dup = false;
        flash(st, `Added to ${POOL_NAME[pool]} ✓  ` + c.isbn, "ok");
        await putSt(st);
        return true;
      });
      if (r) await flush();
      return;
    }
    case "undo": {
      const st0 = await getSt();
      const rec = st0.recent.find((r) => r.ref === msg.ref);
      if (!rec) return;
      if (!rec.id) {   // never reached the App: just drop it
        return locked(async () => {
          const st = await getSt();
          st.queue = st.queue.filter((q) => q.ref !== msg.ref);
          st.recent = st.recent.filter((r) => r.ref !== msg.ref);
          if (st.current && st.current.isbn === rec.isbn) st.current.sent = false;
          flash(st, "Undone: " + rec.isbn, "info"); await putSt(st);
        });
      }
      try {
        const j = await post({ type: "undo", id: rec.id, pool: rec.pool || "stream" });
        return locked(async () => {
          const st = await getSt(); takeCounts(st, j);
          st.recent = st.recent.filter((r) => r.ref !== msg.ref);
          if (st.current && st.current.isbn === rec.isbn) st.current.sent = false;
          flash(st, "Undone: " + rec.isbn, "info"); await putSt(st);
        });
      } catch (e) { return locked(async () => { const st = await getSt(); flash(st, e.message, "bad"); await putSt(st); }); }
    }
    case "skip": {
      // DO NOT ADD: the book is in poor condition. Take it back out (or stop it going in) and note why.
      const plan = await locked(async () => {
        const st = await getSt();
        const c = st.current;
        if (!c || !c.isbn) { flash(st, "Scan a book first.", "bad"); await putSt(st); return null; }
        if (c.notAdded) { flash(st, "Already marked DO NOT ADD.", "info"); await putSt(st); return null; }
        const out = { isbn: c.isbn, cm: c.cm || null, session_id: st.shift && st.shift.session_id, ref: c.ref || null, id: null, pool: c.pool || "stream", queued: false };
        if (c.sent && c.ref) {
          const rec = st.recent.find((r) => r.ref === c.ref);
          out.id = rec && rec.id || null;
          if (!out.id) { st.queue = st.queue.filter((q) => q.ref !== c.ref); st.recent = st.recent.filter((r) => r.ref !== c.ref); out.queued = true; }
        }
        c.skip = true; c.notAdded = true; c.sent = false; c.again = false;
        flash(st, "Not added — poor condition.", "info");
        await putSt(st);
        return out;
      });
      if (!plan) return;
      try {
        if (plan.id) {
          const j = await post({ type: "undo", id: plan.id, pool: plan.pool, reason: "condition" });
          await locked(async () => { const st = await getSt(); takeCounts(st, j); st.recent = st.recent.filter((r) => r.id !== plan.id || (r.pool || "stream") !== plan.pool); await putSt(st); });
        } else if (plan.session_id) {
          await post({ type: "notadded", session_id: plan.session_id, isbn: plan.isbn, cm: plan.cm, reason: "condition", ref: newRef(plan.session_id) });
        }
      } catch (e) { await locked(async () => { const st = await getSt(); flash(st, "Couldn't take it out: " + e.message, "bad"); await putSt(st); }); }
      return;
    }
    case "hello": {
      const j = await post({ type: "hello" });
      await chrome.storage.local.set({ connected: true, station: j.station, loads: j.loads, ...(j.rules ? { rules: j.rules } : {}) });
      return j;
    }
    case "start": {
      const st0 = await getSt();
      if (st0.shift) { try { await post({ type: "count", session_id: st0.shift.session_id, scanned: st0.scanned }); } catch {} }
      const j = await post({ type: "start", staff: msg.staff, load_id: msg.load_id });
      return locked(async () => {
        const st = await getSt();
        st.shift = { session_id: j.session_id, staff: msg.staff, load: j.load, started_at: j.started_at, syncedScanned: 0 };
        st.scanned = 0; st.sampled = 0; st.current = null; st.recent = st.recent.filter((r) => r.status !== "saved"); takeCounts(st, j);
        flash(st, `Shift started: ${msg.staff} · ${j.load.name}`, "ok");
        await chrome.storage.local.set({ lastStaff: msg.staff });
        await putSt(st); return { ok: true };
      });
    }
    case "end": {
      await flush(); await syncCount();
      const st0 = await getSt();
      if (st0.queue.length) return locked(async () => { const st = await getSt(); flash(st, "Some books are still waiting to send — check the internet, then end the shift.", "bad"); await putSt(st); });
      let j = {};
      if (st0.shift) { try { j = await post({ type: "end", session_id: st0.shift.session_id }); } catch {} }
      return locked(async () => {
        const st = await getSt(); takeCounts(st, j);
        st.shift = null; st.current = null; st.recent = []; st.scanned = 0;
        flash(st, "Shift ended.", "info"); await putSt(st);
      });
    }
    case "refresh": {
      const st0 = await getSt();
      try { const j = await post({ type: "counts", session_id: st0.shift && st0.shift.session_id }); await locked(async () => { const st = await getSt(); takeCounts(st, j); await putSt(st); }); } catch {}
      flush(); return;
    }
    case "sitesChanged": return registerSites();
    case "clearFlash": return locked(async () => { const st = await getSt(); st.flash = null; await putSt(st); });
  }
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then((r) => reply({ ok: true, ...(r || {}) }), (e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});
