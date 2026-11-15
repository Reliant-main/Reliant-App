// Runs beside the live page. In Learning mode it records what sale-related page data looks like,
// so a reader can be built for that app. In Reading mode it turns sales into Ticket System tickets.
(() => {
  const host = location.hostname;
  const P = /whatnot\.com$/.test(host) ? "WN" : /tiktok\.com$/.test(host) ? "TT" : /ebay\.com$/.test(host) ? "EB" : null;
  if (!P) return;
  const R = () => (window.RPR_READERS || {})[P];
  let mode = "off";
  const HINT = /sold|purchas|order|winner|won\b|bought|buyer|checkout|auction|giveaway|claim/i;

  function tellPage() { window.postMessage({ __rprMode: mode }, "*"); }
  chrome.storage.local.get(["mode"], v => { mode = v.mode || "off"; tellPage(); startObserver(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.mode) { mode = ch.mode.newValue || "off"; tellPage(); startObserver(); } });
  // the page script may load after us; repeat the mode a few times early on
  [300, 1500, 4000].forEach(ms => setTimeout(tellPage, ms));

  // ---- Learning: batch samples, skip repeats, cap the rate ----
  let batch = [], seen = new Set(), sentThisMin = 0;
  setInterval(() => { sentThisMin = 0; if (seen.size > 5000) seen = new Set(); }, 60000);
  function learn(kind, sample) {
    if (mode !== "learn" || !sample) return;
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

  // ---- Reading: send each sale once ----
  const sent = new Set();
  function sales(list) {
    if (mode !== "read" || !Array.isArray(list)) return;
    const r = R();
    for (const s of list) {
      if (!s || !s.event_id || sent.has(s.event_id)) continue;
      sent.add(s.event_id);
      chrome.runtime.sendMessage({ type: "sale", platform: P, url: location.href, show_key: r.showKey(), at: new Date().toISOString(), ...s }).catch(() => {});
    }
  }

  // feed messages from the page
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || !e.data.__rprData) return;
    const d = e.data;
    if (mode === "learn") learn(d.kind, `[${d.url}] ${d.text}`);
    else if (mode === "read") { try { sales(R().fromData(d.kind, d.text, d.url)); } catch (err) { report(err); } }
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
          if (mode === "learn") { if (HINT.test(text) || /\$\s?\d/.test(text)) learn("dom", text.slice(0, 1500) + "\n---\n" + n.outerHTML.slice(0, 5000)); }
          else if (mode === "read") { try { sales(R().fromNode(n)); } catch (err) { report(err); } }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    };
    go();
  }
  let lastErr = 0;
  function report(err) { if (Date.now() - lastErr < 30000) return; lastErr = Date.now(); chrome.runtime.sendMessage({ type: "error", platform: P, message: String(err && err.message || err) }).catch(() => {}); }

  // the popup asks which app this tab is
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg && msg.type === "whoami") { const r = R(); reply({ platform: P, name: r && r.name, ready: !!(r && r.ready) }); }
  });
})();
