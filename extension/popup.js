const $ = id => document.getElementById(id);
const HELP = {
  off: "The reader does nothing.",
  learn: "Records what sales look like on your live page, so a reader can be built for that app. Leave it on for a whole show. It doesn't make tickets.",
  read: "Turns each sale on your live page into a Ticket System ticket. Also records page data for the first 10 minutes, in case the app changed its page. TikTok: keep the LIVE dashboard tab open and showing on the Auction tab.",
};
async function draw() {
  const { code, mode = "off", stats = {}, connected } = await chrome.storage.local.get(["code", "mode", "stats", "connected"]);
  $("connState").textContent = code ? (connected ? "Connected to the Ticket System" : "Code saved, not checked yet") : "Not connected";
  $("connState").className = code && connected ? "ok" : "dim";
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
  $("modeHelp").textContent = HELP[mode];
  const rows = [["Learning samples sent", stats.captures || 0], ["Tickets made", stats.sales || 0], ["Payment updates sent", stats.updates || 0], ["Skipped (official feed in use)", stats.skipped || 0], ["Not in the Ticket System yet", stats.missing || 0], ["Problems", stats.errors || 0]];
  let html = rows.map(([a, b]) => `<span class="dim">${a}</span><b>${b}</b>`).join("");
  if (stats.lastSale) html += `<span class="dim" style="grid-column:1/-1">Last: ${esc(stats.lastSale)}</span>`;
  if (stats.lastSkip) html += `<span class="dim" style="grid-column:1/-1">${esc(stats.lastSkip)}</span>`;
  if (stats.lastError) html += `<span class="bad" style="grid-column:1/-1">${esc(stats.lastError)}</span>`;
  $("stats").innerHTML = html;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const who = tab && await chrome.tabs.sendMessage(tab.id, { type: "whoami" }).catch(() => null);
    if (!who) $("tab").textContent = "Open your Whatnot, TikTok or eBay live page (refresh it once after installing).";
    else {
      $("tab").innerHTML = `${esc(who.name)} page found. ${who.ready ? '<span class="ok">Reader ready.</span>' : '<span class="bad">No reader for this app yet — use Learning during a show.</span>'}`;
      $("newShow").hidden = !(who.ready && mode === "read");
      $("newShow").dataset.p = who.platform;
      $("hear").hidden = !(who.feedBased && mode === "read");
      if (who.feedBased && mode === "read") {
        const ok = who.hearing != null && who.hearing <= 60;
        $("hear").className = ok ? "ok" : "bad";
        $("hear").textContent = who.hearing == null ? `Not hearing ${who.name}'s sales list yet. Open the LIVE dashboard on the Auction tab.`
          : ok ? `Hearing ${who.name}'s sales list (${who.hearing}s ago) · ${who.sent} sales sent`
          : `${who.name}'s sales list went quiet ${Math.round(who.hearing / 60)} min ago. Keep the dashboard showing on the Auction tab.`;
      }
    }
  } catch {}
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
$("connect").onclick = async () => {
  const code = $("code").value.trim();
  if (!/^rpr_[0-9a-f]{36}$/.test(code)) { $("connState").textContent = "That doesn't look like a connection code."; $("connState").className = "bad"; return; }
  await chrome.storage.local.set({ code, connected: false });
  $("connState").textContent = "Checking…";
  const r = await chrome.runtime.sendMessage({ type: "hello" }).catch(e => ({ ok: false, error: String(e) }));
  await chrome.storage.local.set({ connected: !!(r && r.ok) });
  $("code").value = "";
  if (!(r && r.ok)) { $("connState").textContent = (r && r.error) || "Couldn't reach the Ticket System."; $("connState").className = "bad"; return; }
  draw();
};
document.querySelectorAll("[data-mode]").forEach(b => b.onclick = async () => { await chrome.storage.local.set({ mode: b.dataset.mode }); draw(); });
$("newShow").onclick = async () => {
  if (!confirm("Start a new show? Buyer numbers start again at 1.")) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = tab && await chrome.tabs.sendMessage(tab.id, { type: "newShow", platform: $("newShow").dataset.p }).catch(() => null);
  $("tab").textContent = r && r.ok ? "New show started. The next sale gets buyer #1." : "Couldn't start a new show on this tab.";
};
$("openPanel").onclick = async () => {
  try { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id }); window.close(); }
  catch (e) { $("tab").textContent = "Couldn't open the sidebar. Update Chrome, then try again."; }
};
$("reset").onclick = async () => { await chrome.storage.local.set({ stats: {} }); draw(); };
chrome.storage.onChanged.addListener(draw);
draw();
