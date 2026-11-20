// Sends what the pages find to the Reliant Ticket System, using this computer's connection code.
const URL_IN = "https://vmpysxfmfyvwheqbuicj.supabase.co/functions/v1/page-reader";

async function post(body) {
  const { code, endpoint } = await chrome.storage.local.get(["code", "endpoint"]);   // "endpoint" is only set when testing
  if (!code) throw new Error("Not connected yet. Paste a connection code.");
  const r = await fetch(endpoint || URL_IN, { method: "POST", headers: { "content-type": "application/json", "x-reader-code": code }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "The Ticket System didn't answer (" + r.status + ")");
  return j;
}
async function bump(field, n = 1, extra = {}) {
  const { stats = {} } = await chrome.storage.local.get("stats");
  stats[field] = (stats[field] || 0) + n;
  Object.assign(stats, extra, { at: Date.now() });
  await chrome.storage.local.set({ stats });
}
async function fail(msg) { await bump("errors", 1, { lastError: msg, lastErrorAt: Date.now() }); }

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === "panel" || msg.type === "buyer" || msg.type === "reprint") { reply({ ok: true, ...(await post(msg)) }); return; }
      if (msg.type === "hello") { reply({ ok: true, ...(await post({ type: "hello" })) }); return; }
      if (msg.type === "capture") { const j = await post(msg); await bump("captures", j.stored || 0, j.full ? { lastError: "Learning limit reached for this hour" } : {}); }
      else if (msg.type === "sale") {
        const j = await post(msg);
        if (j.skipped) await bump("skipped", 1, { lastSkip: j.skipped });
        else if (msg.update) await bump("updates", 1, msg.status === "cancelled" ? { lastSale: `Payment failed: ${msg.buyer && msg.buyer.username || "buyer"} · $${msg.price ?? "?"}` } : {});
        else await bump("sales", 1, { lastSale: `Buyer #${j.buyer_number ?? "?"} · ${msg.buyer && msg.buyer.username || "buyer not shown yet"} · $${msg.price ?? "?"}` });
      }
      else if (msg.type === "heartbeat") {
        const j = await post(msg);
        await bump("checkins", 1, { lastCheckin: Date.now(), missing: (j.missing || []).length });
        reply({ ok: true, missing: j.missing || [] });
        return;
      }
      else if (msg.type === "error") await fail(`${msg.platform} reader: ${msg.message}`);
      reply({ ok: true });
    } catch (e) { await fail(String(e.message || e)); reply({ ok: false, error: String(e.message || e) }); }
  })();
  return true;
});
