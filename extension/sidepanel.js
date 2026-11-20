// Reliant Tickets sidebar: the current show for one app, next to the live page.
// Sales and buyer numbers, payment status (waiting / paid / failed), Print another chit, and each buyer's history
// on the same app (usernames differ between apps, so history never mixes apps).
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = v => v == null || v === "" ? "—" : "$" + Number(v).toFixed(2);
const APP = { TT: "TikTok", WN: "Whatnot", EB: "eBay" };
const POLL_MS = 3000, QUIET_S = 90, CHECKIN_LATE_S = 75, PAY_WINDOW_S = 300, ALERT_KEEP_MS = 30 * 60 * 1000;

let plat = "TT", soundOn = false, data = null, buyerView = null, dismissed = {}, failedSeen = null, readerWasBad = false, busy = false;

const api = msg => chrome.runtime.sendMessage({ ...msg, platform: plat }).then(r => {
  if (!r || r.ok === false) throw new Error((r && r.error) || "The Ticket System didn't answer.");
  return r;
});

// ---- payment status, in plain words ----
function payState(s) {
  const st = (s.status || "").toLowerCase();
  if (st === "cancelled" || st === "canceled") return { cls: "fail", text: plat === "TT" ? "Payment failed" : "Cancelled", failed: true };
  if (st === "awaiting_payment") return { cls: "wait", text: "Waiting", waiting: true };
  if (st === "paid" || st === "completed" || st === "pending_fulfillment" || st === "shipped") return { cls: "paid", text: "Paid" };
  return { cls: "none", text: "Sold" };
}
const since = iso => (Date.now() - Date.parse(iso)) / 1000;
const clock = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const ago = s => s < 60 ? Math.max(0, Math.round(s)) + "s" : Math.round(s / 60) + " min";
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// a plain date (2026-12-04) is a calendar day, not a moment, so it isn't shifted by the time zone
const dateOf = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso); return d.toLocaleDateString([], { month: "short", day: "numeric" }); };

// ---- sound (off unless turned on) ----
let ac = null;
function beep() {
  if (!soundOn) return;
  try {
    ac = ac || new AudioContext();
    [0, .45, .9].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = 220;
      g.gain.setValueAtTime(.07, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + t + .3);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .3);
    });
  } catch {}
}

// ---- drawing ----
function drawStatus() {
  const box = $("status");
  if (!data) { box.className = "status"; box.textContent = "Connecting…"; return; }
  const app = APP[plat], show = data.show, sales = data.sales || [];
  const live = sales.filter(s => !payState(s).failed);
  const showLine = show ? `${app} show started ${timeOf(show.started)} · ${data.buyers} buyers · ${live.length} sales` : `No ${app} show in the last 8 hours`;
  let cls = "ok", head;
  if (data.source === "page") {
    const r = data.reader;
    const hb = r ? since(r.updated_at) : null, heard = r && r.feed_seen_at ? since(r.feed_seen_at) : null;
    if (!r || hb > 30 * 60) { cls = show ? "warn" : ""; head = `${app} page reader isn't running`; }
    else if (hb > CHECKIN_LATE_S) { cls = "bad"; head = `${app} page reader stopped checking in ${ago(hb)} ago`; }
    else if (heard == null || heard > QUIET_S) { cls = "bad"; head = heard == null ? `Can't hear ${app}'s sales list` : `Haven't heard ${app}'s sales list for ${ago(heard)}`; }
    else if (r.feed_missing > 0) { cls = "warn"; head = `${r.feed_missing} sale${r.feed_missing === 1 ? "" : "s"} still on the way (resending)`; }
    else if (r.page_visible === false) { cls = "warn"; head = `The ${app} tab is hidden, so Chrome may slow it down`; }
    else head = `Hearing ${app} (${ago(heard)} ago)`;
    if (cls === "bad") head += " — use one lot per purchase until this turns green";
    const bad = cls === "bad";
    if (bad && !readerWasBad) beep();
    readerWasBad = bad;
  } else {
    head = `${app} sales come from ${app}'s own connection`;
  }
  box.className = "status " + cls;
  box.innerHTML = `${esc(head)}<span class="sub">${esc(showLine)}</span>`;
}

function drawAlerts() {
  const sales = (data && data.sales) || [];
  const out = [];
  for (const s of sales) {
    const p = payState(s);
    if (dismissed[s.id]) continue;
    if (p.failed && since(s.at) * 1000 < ALERT_KEEP_MS)
      out.push(`<div class="alert bad"><span class="t"><b>#${esc(s.num ?? "?")} ${esc(s.user || "buyer")}</b> · ${money(s.price)} · payment didn't go through${plat === "TT" ? ". Put the book back or offer it again." : "."}</span><button class="small" data-ok="${s.id}">Got it</button></div>`);
    else if (p.waiting) {
      const w = since(s.at), over = w > PAY_WINDOW_S;
      out.push(`<div class="alert warn"><span class="t"><b>#${esc(s.num ?? "?")} ${esc(s.user || "buyer")}</b> · ${money(s.price)} · ${over ? `still waiting after ${clock(w)}` : `waiting ${clock(w)} of about 5:00`}</span></div>`);
    }
  }
  $("alertsBox").hidden = !out.length;
  $("alerts").innerHTML = out.join("");
}

function drawSales() {
  const sales = (data && data.sales) || [];
  $("listLbl").textContent = sales.length ? `Sales (newest first)` : "Sales";
  $("sales").innerHTML = sales.length ? sales.map(s => {
    const p = payState(s);
    const who = s.user ? esc(s.user) : `<span class="bad">Buyer not shown yet</span>`;
    const books = s.books ? esc(s.books) : `<span class="dim">no book scanned yet</span>`;
    return `<li class="${p.failed ? "cancel" : ""}" data-buyer="${s.buyer_id ?? ""}" title="Show this buyer's history">
      <span class="num ${s.num ? "" : "q"}">${s.num ? "#" + esc(s.num) : "?"}</span>
      <span class="u">${who}</span>
      <span class="right"><span class="price">${money(s.price)}</span><span class="chip ${p.cls}">${p.text}</span></span>
      <span class="meta">${timeOf(s.at)} · ${books}</span>
      <span style="grid-column:2/4" class="row"><button class="small" data-print="${s.id}" ${s.reprint ? "disabled" : ""}>${s.reprint ? "Sent to printer…" : "Print another chit"}</button></span>
    </li>`;
  }).join("") : `<li class="empty" style="display:block;cursor:default">No sales yet for this show.</li>`;
}

function drawBuyer() {
  const box = $("buyerBox");
  if (!buyerView) { box.hidden = true; $("listBox").hidden = false; return; }
  $("listBox").hidden = true; box.hidden = false;
  const b = buyerView;
  if (b.loading) { box.innerHTML = `<button id="back">← Back to sales</button><p class="empty">Loading…</p>`; return; }
  if (b.error) { box.innerHTML = `<button id="back">← Back to sales</button><p class="empty bad">${esc(b.error)}</p>`; return; }
  const live = b.this_show.filter(s => !payState(s).failed);
  const spent = live.reduce((t, s) => t + Number(s.price || 0), 0);
  const pastBooks = b.past.reduce((t, p) => t + Number(p.books), 0), pastSpent = b.past.reduce((t, p) => t + Number(p.spent), 0);
  box.innerHTML = `<button id="back">← Back to sales</button>
    <div class="card" style="margin-top:8px">
      <div class="buyerhead"><span class="num">#${esc(b.buyer.num)}</span><span><span class="u">${esc(b.buyer.user || "")}</span><br><span class="dim">${esc(b.buyer.display || "")} · ${APP[plat]}</span></span></div>
      <div class="lbl">This show: ${live.length} book${live.length === 1 ? "" : "s"} · ${money(spent)}</div>
      <table>${b.this_show.map(s => { const p = payState(s); return `<tr><td class="dim">${timeOf(s.at)}</td><td>${s.books ? esc(s.books) : '<span class="dim">no book scanned yet</span>'}</td><td class="r">${money(s.price)}<br><span class="chip ${p.cls}">${p.text}</span></td></tr>`; }).join("")}</table>
    </div>
    <div class="card">
      <div class="lbl">Earlier ${APP[plat]} shows${b.past.length ? `: ${b.past.length} show${b.past.length === 1 ? "" : "s"} · ${pastBooks} books · ${money(pastSpent)}` : ""}</div>
      ${b.past.length ? `<table>${b.past.map(p => `<tr><td>${dateOf(p.date)}</td><td class="r">${p.books} book${Number(p.books) === 1 ? "" : "s"}</td><td class="r">${money(p.spent)}</td></tr>`).join("")}</table>`
        : `<span class="dim">None yet. History builds from Ticket System shows, on ${APP[plat]} only.</span>`}
    </div>
    ${b.requests.length ? `<div class="card"><div class="lbl">Open requests</div>${b.requests.map(r => `<div>${esc(r.title || r.genre || "Request")}${r.author ? ` <span class="dim">by ${esc(r.author)}</span>` : ""}${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</div>`).join("")}</div>` : ""}
    ${b.events.length ? `<div class="card"><div class="lbl">Life events</div>${b.events.map(e => `<div>${esc(dateOf(e.date))} · ${esc(e.type || "")}${e.yearly ? " (every year)" : ""}${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}</div>`).join("")}</div>` : ""}
    ${b.notes ? `<div class="card"><div class="lbl">Notes</div><div>${esc(b.notes)}</div></div>` : ""}`;
}

function drawAll() { drawStatus(); drawAlerts(); if (!buyerView) drawSales(); drawBuyer(); }

// ---- data ----
async function showKey() {
  const { shows = {} } = await chrome.storage.local.get("shows");
  return shows[plat] && shows[plat].key || null;
}
async function poll() {
  if (busy || document.visibilityState !== "visible") return;
  busy = true;
  try {
    const r = await api({ type: "panel", show_key: await showKey() });
    // a payment that just failed gets the sound once
    const failedNow = new Set((r.sales || []).filter(s => payState(s).failed).map(s => s.id));
    if (failedSeen && [...failedNow].some(id => !failedSeen.has(id))) beep();
    failedSeen = failedNow;
    data = r;
    drawAll();
  } catch (e) {
    $("status").className = "status bad";
    $("status").textContent = String(e.message || e);
  } finally { busy = false; }
}
async function openBuyer(id) {
  if (!id) return;
  buyerView = { loading: true }; drawBuyer();
  try { buyerView = await api({ type: "buyer", buyer_id: +id }); if (buyerView.error) buyerView = { error: buyerView.error }; }
  catch (e) { buyerView = { error: String(e.message || e) }; }
  drawBuyer();
}

// ---- actions ----
$("sales").addEventListener("click", async e => {
  const pb = e.target.closest("button[data-print]");
  if (pb) {
    e.stopPropagation();
    pb.disabled = true; pb.textContent = "Sending…";
    try { await api({ type: "reprint", sale_id: +pb.dataset.print }); pb.textContent = "Sent to printer…"; setTimeout(poll, 500); }
    catch (err) { pb.disabled = false; pb.textContent = "Didn't send — try again"; }
    return;
  }
  const li = e.target.closest("li[data-buyer]");
  if (li && li.dataset.buyer) openBuyer(li.dataset.buyer);
});
$("buyerBox").addEventListener("click", e => { if (e.target.id === "back") { buyerView = null; drawAll(); } });
$("alerts").addEventListener("click", async e => {
  const b = e.target.closest("button[data-ok]"); if (!b) return;
  dismissed[b.dataset.ok] = Date.now();
  await chrome.storage.session.set({ dismissed }).catch(() => {});
  drawAlerts();
});
$("plat").onchange = async () => {
  plat = $("plat").value; data = null; buyerView = null; failedSeen = null; readerWasBad = false;
  await chrome.storage.local.set({ panelPlat: plat }); drawAll(); poll();
};
$("sound").onclick = async () => { soundOn = !soundOn; await chrome.storage.local.set({ panelSound: soundOn }); drawSound(); if (soundOn) beep(); };
function drawSound() { $("sound").textContent = soundOn ? "Sound on" : "Sound off"; $("sound").classList.toggle("on", soundOn); }

const MODE_NOTE = { off: "The reader does nothing.", learn: "Records what the live page sends, so a reader can be built or fixed. Makes no tickets.", read: "Makes a ticket for each sale on the live page (TikTok). Keep the LIVE dashboard showing on the Auction tab." };
async function drawMode() {
  const { mode = "off" } = await chrome.storage.local.get("mode");
  document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
  $("modeNote").textContent = MODE_NOTE[mode];
}
document.querySelectorAll("[data-mode]").forEach(b => b.onclick = async () => { await chrome.storage.local.set({ mode: b.dataset.mode }); drawMode(); });
$("newShow").onclick = async () => {
  if (!confirm(`Start a new ${APP[plat]} show? Buyer numbers start again at 1.`)) return;
  const tabs = await chrome.tabs.query({ url: plat === "TT" ? "https://*.tiktok.com/*" : plat === "WN" ? "https://*.whatnot.com/*" : "https://*.ebay.com/*" });
  let done = false;
  for (const t of tabs) { const r = await chrome.tabs.sendMessage(t.id, { type: "newShow", platform: plat }).catch(() => null); if (r && r.ok) done = true; }
  alert(done ? "New show started. The next sale gets buyer #1." : `Open the ${APP[plat]} live page first, then try again.`);
};
chrome.storage.onChanged.addListener(ch => { if (ch.mode) drawMode(); });

// ---- start ----
(async () => {
  const st = await chrome.storage.local.get(["panelPlat", "panelSound"]);
  dismissed = (await chrome.storage.session.get("dismissed").catch(() => ({}))).dismissed || {};
  soundOn = st.panelSound === true;                    // off unless turned on
  // follow the app of the tab that's showing, if it's one of ours
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const u = (tab && tab.url) || "";
  plat = /tiktok\.com/.test(u) ? "TT" : /whatnot\.com/.test(u) ? "WN" : /ebay\.com/.test(u) ? "EB" : (st.panelPlat || "TT");
  $("plat").value = plat;
  drawSound(); drawMode(); drawAll();
  poll();
  setInterval(poll, POLL_MS);
  setInterval(() => { if (data) { drawStatus(); drawAlerts(); } }, 1000);   // keeps the countdowns moving
  document.addEventListener("visibilitychange", poll);
})();
