const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let tab = null;
async function draw() {
  const { code, connected, station, sites = [] } = await chrome.storage.local.get(["code", "connected", "station", "sites"]);
  $("conn").textContent = code ? (connected ? `Connected as “${station || "station"}”` : "Code saved, not checked yet") : "Not connected";
  $("conn").className = code && connected ? "ok" : "dim";
  $("showRow").style.display = code ? "" : "none";
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null; try { const u = new URL(tab.url); origin = u.protocol + "//" + u.hostname; } catch {}
  const web = origin && /^https?:/.test(origin);
  $("here").textContent = !web ? "Open the CashMonkey scan screen in this tab first." : sites.includes(origin) ? `On for ${origin}` : `This tab: ${origin}`;
  $("here").className = web && sites.includes(origin) ? "ok" : "dim";
  $("enable").disabled = !web || sites.includes(origin);
  $("sites").innerHTML = sites.map((s) => `<li>${esc(s)}<button data-s="${esc(s)}">Remove</button></li>`).join("");
}
async function drawPanelBtn() {
  const { ui = {} } = await chrome.storage.local.get("ui");
  $("panel").textContent = ui.hidden ? "Show panel" : "Hide panel";
}
$("panel").onclick = async () => {
  const { ui = {} } = await chrome.storage.local.get("ui");
  await chrome.storage.local.set({ ui: { ...ui, hidden: !ui.hidden, min: false } });
  drawPanelBtn();
};
$("show").onclick = async () => {
  const { code } = await chrome.storage.local.get("code");
  const el = $("shown");
  if (el.style.display === "none" && code) { el.textContent = code; el.style.display = ""; $("show").textContent = "Hide code"; }
  else { el.textContent = ""; el.style.display = "none"; $("show").textContent = "Show this computer's code"; }
};
$("connect").onclick = async () => {
  const code = $("code").value.trim();
  if (!/^rss_[0-9a-f]{36}$/.test(code)) { $("conn").textContent = "That doesn't look like a station code."; $("conn").className = "bad"; return; }
  await chrome.storage.local.set({ code, connected: false });
  $("conn").textContent = "Checking…";
  const r = await chrome.runtime.sendMessage({ type: "hello" }).catch((e) => ({ ok: false, error: String(e) }));
  if (!(r && r.ok)) { await chrome.storage.local.set({ connected: false }); $("conn").textContent = (r && r.error) || "Couldn't reach the Reliant App."; $("conn").className = "bad"; return; }
  $("code").value = ""; draw();
};
$("enable").onclick = async () => {
  const u = new URL(tab.url), origin = u.protocol + "//" + u.hostname;
  const ok = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!ok) { $("here").textContent = "Chrome didn't allow it — click again and choose Allow."; $("here").className = "bad"; return; }
  const { sites = [] } = await chrome.storage.local.get("sites");
  if (!sites.includes(origin)) sites.push(origin);
  await chrome.storage.local.set({ sites });
  await chrome.runtime.sendMessage({ type: "sitesChanged" });
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["isbn.js", "page.js"] }); } catch {}
  draw();
};
$("sites").onclick = async (e) => {
  const s = e.target.dataset.s; if (!s) return;
  let { sites = [] } = await chrome.storage.local.get("sites");
  sites = sites.filter((x) => x !== s);
  await chrome.storage.local.set({ sites });
  try { await chrome.permissions.remove({ origins: [s + "/*"] }); } catch {}
  await chrome.runtime.sendMessage({ type: "sitesChanged" });
  draw();
};
async function drawShift() {
  const { st = {}, loads = [], lastStaff = "" } = await chrome.storage.local.get(["st", "loads", "lastStaff"]);
  const sh = st.shift;
  $("shiftNow").textContent = sh ? `${sh.staff} · ${sh.load && sh.load.name}` : "No shift started";
  $("shiftNow").className = sh ? "ok" : "dim";
  if (!$("pStaff").value) $("pStaff").value = (sh && sh.staff) || lastStaff || "";
  const cur = sh && sh.load && sh.load.id;
  $("pLoad").innerHTML = `<option value="">Load / source…</option>` + loads.map((l) => `<option value="${l.id}" ${l.id === cur ? "selected" : ""}>${esc(l.name)} (${esc(l.source)})</option>`).join("");
  $("pStart").textContent = sh ? "Change shift" : "Start shift";
  $("pEnd").disabled = !sh;
}
$("pStart").onclick = async () => {
  const staff = $("pStaff").value.trim(), load_id = +$("pLoad").value;
  if (!staff) return ($("pMsg").textContent = "Type who's scanning.");
  if (!load_id) return ($("pMsg").textContent = "Pick the load.");
  $("pMsg").textContent = "Starting…";
  const r = await chrome.runtime.sendMessage({ type: "start", staff, load_id }).catch((e) => ({ ok: false, error: String(e) }));
  $("pMsg").textContent = r && r.ok ? "Shift started." : (r && r.error) || "Couldn't reach the Reliant App.";
  drawShift();
};
$("pEnd").onclick = async () => { await chrome.runtime.sendMessage({ type: "end" }).catch(() => {}); $("pMsg").textContent = "Shift ended."; drawShift(); };
chrome.runtime.sendMessage({ type: "hello" }).then(drawShift, drawShift);
drawShift();
drawPanelBtn();
draw();
