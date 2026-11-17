// Runs beside the live page. In Learning mode it records what sale-related page data looks like,
// so a reader can be built for that app. In Reading mode it turns sales into Ticket System tickets,
// and also records Learning samples for the first 10 minutes, so fresh page data is on hand if the app changes.
(() => {
  const host = location.hostname;
  const P = /whatnot\.com$/.test(host) ? "WN" : /tiktok\.com$/.test(host) ? "TT" : /ebay\.com$/.test(host) ? "EB" : null;
  if (!P) return;
  const R = () => (window.RPR_READERS || {})[P];
  let mode = "off";
  let shows = {};                             // which show each app's sales go to (see showKey)
  const HINT = /sold|purchas|order|winner|won\b|bought|buyer|checkout|auction|giveaway|claim/i;
  const LOADED = Date.now();
  const LEARN_WHILE_READING_MS = 10 * 60 * 1000;
  const HOLD_UNNAMED_MS = 15 * 1000;        // a new sale with a blank buyer waits this long for the buyer to show up
  const SHOW_GAP_MS = 45 * 60 * 1000;       // a new LIVE within 45 min of the last sale continues the same show (stream restart)
  const HEARTBEAT_MS = 20 * 1000;

  function tellPage() { window.postMessage({ __rprMode: mode }, "*"); }
  chrome.storage.local.get(["mode", "shows"], v => { mode = v.mode || "off"; shows = v.shows || {}; tellPage(); startObserver(); });
  chrome.storage.onChanged.addListener(ch => {
    if (ch.mode) { mode = ch.mode.newValue || "off"; tellPage(); startObserver(); }
    if (ch.shows) shows = ch.shows.newValue || {};
  });
  // the page script may load after us; repeat the mode a few times early on
  [300, 1500, 4000].forEach(ms => setTimeout(tellPage, ms));
  const learning = () => mode === "learn" || (mode === "read" && Date.now() - LOADED < LEARN_WHILE_READING_MS);

  // ---- Learning: batch samples, skip repeats, cap the rate ----
  let batch = [], seen = new Set(), sentThisMin = 0;
  setInterval(() => { sentThisMin = 0; if (seen.size > 5000) seen = new Set(); }, 60000);
  function learn(kind, sample) {
    if (!learning() || !sample) return;
    const key = kind + ":" + sample.slice(0, 400);
    if (seen.has(key) || sentThisMin > 240) return;
    seen.add(key); sentThisMin++;
    batch.push({ kind, sample: sample.slice(0, 8000) });
  }
  setInterval(() => {
    if (!batch.length) return;
    const items = batch.splice(0, 60);
    chrome.runtime.sendMessage({ type: "capture", platform: P, url: location.href, items }).catch(() => {});
  }, 2000);

  // ---- Which show these sales belong to (buyer numbers restart for each show) ----
  // Kept per app on this computer. A stream restart starts a new LIVE on the app; if the last sale was less
  // than 45 minutes ago the sales carry on in the same show, so buyer numbers don't start over mid-show.
  // "Start a new show" in the extension menu forces a fresh show.
  function showKey() {
    const r = R(), base = r.showKey(), sess = r.session ? r.session() : base;
    const cur = shows[P];
    if (cur && !cur.forceNew) {
      if (cur.session === sess) return cur.key;
      if (cur.lastSaleAt && Date.now() - cur.lastSaleAt < SHOW_GAP_MS) {
        shows[P] = { ...cur, session: sess };
        chrome.storage.local.set({ shows });
        return cur.key;
      }
    }
    const key = cur && cur.forceNew ? base + "-" + new Date().toTimeString().slice(0, 5).replace(":", "") : base;
    shows[P] = { key, session: sess, lastSaleAt: null };
    chrome.storage.local.set({ shows });
    return key;
  }
  function touchShow() { if (shows[P]) { shows[P].lastSaleAt = Date.now(); chrome.storage.local.set({ shows }); } }

  // ---- Reading: send each sale, and again when its payment status changes ----
  // What was already sent is kept for this tab, so a page reload doesn't send everything again.
  const RANK = { awaiting_payment: 1, page_reader: 1, paid: 2, cancelled: 3 };
  const memKey = "__rpr_sent_" + P;
  let sent = {};
  try { sent = JSON.parse(sessionStorage.getItem(memKey) || "{}") || {}; } catch { sent = {}; }
  const saveSent = () => { try { sessionStorage.setItem(memKey, JSON.stringify(sent)); } catch {} };
  const pending = new Map();                 // event_id -> { sale, since }
  const latest = new Map();                  // event_id -> the newest version seen (for resending)
  const resentAt = new Map();                // event_id -> when it was last resent (at most once per 15 s)
  let feedSeenAt = null, feedTotal = null, feedIds = [];
  const sentCount = () => Object.keys(sent).length;

  function send(s) {
    const st = s.status || "page_reader", named = !!(s.buyer && (s.buyer.id || s.buyer.username));
    const prev = sent[s.event_id];
    sent[s.event_id] = { st: prev && RANK[prev.st] > RANK[st] ? prev.st : st, named: named || !!(prev && prev.named) };
    saveSent();
    touchShow();
    chrome.runtime.sendMessage({ type: "sale", platform: P, url: location.href, show_key: showKey(), at: new Date().toISOString(), ...s, update: !!prev || resentAt.has(s.event_id) }).catch(() => {});
  }
  function sales(out) {
    if (mode !== "read" || !out) return;
    const list = Array.isArray(out) ? out : (out.sales || []);
    if (!Array.isArray(out) && out.feed) {
      feedSeenAt = Date.now();
      feedTotal = out.feed.total;
      feedIds = list.map(s => s.event_id);
    }
    for (const s of list) {
      if (!s || !s.event_id) continue;
      const id = s.event_id, st = s.status || "page_reader";
      const named = !!(s.buyer && (s.buyer.id || s.buyer.username));
      const prev = sent[id];
      const keep = latest.get(id);
      latest.set(id, named || !keep ? s : { ...s, buyer: keep.buyer });
      if (prev) {
        // already sent: only a newer payment status, or a buyer we didn't have, is worth sending again
        const newer = RANK[st] > RANK[prev.st];
        const gotBuyer = named && !prev.named;
        if (newer || gotBuyer) send(named || !prev.named ? s : { ...s, buyer: null });
        continue;
      }
      if (!named) {                          // new sale with a blank buyer: give it a moment
        const p = pending.get(id);
        if (!p) pending.set(id, { sale: s, since: Date.now() }); else p.sale = s;
        continue;
      }
      pending.delete(id);
      send(s);
    }
  }
  setInterval(() => {                        // blank buyer still blank after 15 s: send it anyway (flagged "buyer missing")
    for (const [id, p] of pending) {
      if (sent[id]) { pending.delete(id); continue; }
      if (Date.now() - p.since >= HOLD_UNNAMED_MS) { pending.delete(id); send(p.sale); }
    }
  }, 2000);

  // ---- Check-in: tells the Ticket System the reader is still hearing the app ----
  function heartbeat() {
    const r = R();
    if (mode !== "read" || !r || !r.feedBased || (r.onFeedPage && !r.onFeedPage())) return;
    const holding = new Set(pending.keys());
    chrome.runtime.sendMessage({
      type: "heartbeat", platform: P, url: location.href, show_key: showKey(),
      feed_seen_at: feedSeenAt ? new Date(feedSeenAt).toISOString() : null, feed_total: feedTotal,
      feed_ids: feedIds.filter(id => !holding.has(id)), sent_count: sentCount(),
      visible: document.visibilityState === "visible",
    }).then(res => {
      // anything on the app's list that the Ticket System doesn't have gets sent again now
      const missing = (res && res.missing) || [];
      for (const id of missing) {
        const s = latest.get(id);
        if (!s || pending.has(id) || Date.now() - (resentAt.get(id) || 0) < 15000) continue;
        resentAt.set(id, Date.now());
        delete sent[id];
        send(s);
      }
      if (missing.length) saveSent();
    }).catch(() => {});
  }
  setInterval(heartbeat, HEARTBEAT_MS);
  document.addEventListener("visibilitychange", heartbeat);

  // feed messages from the page
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || !e.data.__rprData) return;
    const d = e.data;
    if (learning()) learn(d.kind, `[${d.url}] ${d.text}`);
    if (mode === "read") { try { sales(R().fromData(d.kind, d.text, d.url)); } catch (err) { report(err); } }
  });

  // new elements on the page (pop-ups like "username won ...", order lists)
  let obs = null;
  function startObserver() {
    if (mode === "off") { if (obs) { obs.disconnect(); obs = null; } return; }
    if (obs) return;
    const go = () => {
      if (!document.body) return setTimeout(go, 200);
      obs = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const text = (n.innerText || n.textContent || "").trim();
          if (!text || text.length > 4000) continue;
          if (learning() && (HINT.test(text) || /\$\s?\d/.test(text))) learn("dom", text.slice(0, 1500) + "\n---\n" + n.outerHTML.slice(0, 5000));
          if (mode === "read") { try { sales(R().fromNode(n)); } catch (err) { report(err); } }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    };
    go();
  }
  let lastErr = 0;
  function report(err) { if (Date.now() - lastErr < 30000) return; lastErr = Date.now(); chrome.runtime.sendMessage({ type: "error", platform: P, message: String(err && err.message || err) }).catch(() => {}); }

  // the popup asks which app this tab is, and can start a new show
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === "whoami") {
      const r = R();
      reply({ platform: P, name: r && r.name, ready: !!(r && r.ready), feedBased: !!(r && r.feedBased),
              hearing: feedSeenAt ? Math.round((Date.now() - feedSeenAt) / 1000) : null, sent: sentCount() });
    }
    if (msg && msg.type === "newShow" && msg.platform === P) {
      shows[P] = { ...(shows[P] || {}), forceNew: true };
      showKey();                             // makes the new key now
      if (shows[P]) delete shows[P].forceNew;
      chrome.storage.local.set({ shows });
      reply({ ok: true, key: shows[P] && shows[P].key });
    }
  });
})();
