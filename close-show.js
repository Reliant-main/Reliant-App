// Close show / Reopen show: one shared confirmation window, used by Shows, Fulfillment and Used Books.
// ReliantClose.open({ sb, show: { id, name }, onDone })    — shows the summary, then closes (owners and managers);
//   operators send it to a manager or owner for approval instead
// ReliantClose.reopen({ sb, show: { id, name }, onDone })  — owners only; asks why
(() => {
  "use strict";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const int = v => v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString("en-US");
  const money = v => v == null || !isFinite(v) ? "–" : (v < 0 ? "-$" : "$") + Math.abs(+v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const css = `
  .rc-back { position: fixed; inset: 0; background: rgba(5,12,10,.65); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 16px; }
  .rc-card { width: min(620px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 14px; font: 15px/1.45 var(--f-ui); }
  .rc-card h2 { margin: 0; font: 400 26px/1.15 var(--f-display); }
  .rc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .rc-grid div { background: var(--surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
  .rc-grid .k { font: 500 10.5px var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .rc-grid .v { font: 600 20px var(--f-ui); } .rc-grid .d { font-size: 12px; color: var(--ink-2); }
  .rc-checks { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .rc-checks li { border-radius: 8px; padding: 8px 12px; background: var(--warnbg); color: var(--warnfg); font-size: 14px; }
  .rc-checks li.ok { background: rgba(47,191,79,.12); color: var(--good); }
  .rc-checks .sm { display: block; font-size: 12.5px; opacity: .9; margin-top: 2px; }
  .rc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .rc-how { margin: 0; font-size: 13px; color: var(--muted); }
  .rc-msg { font-size: 13.5px; } .rc-msg.no { color: var(--bad); } .rc-msg.ok { color: var(--good); }
  .rc-card input { font: 14px var(--f-ui); color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; width: 100%; }
  .rc-card .btn.pri { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .rc-piles { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .rc-piles li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-size: 14px; }
  .rc-piles .n { font: 600 18px var(--f-ui); grid-row: 1 / span 2; align-self: center; min-width: 1.6em; text-align: right; }
  .rc-piles .w { font-weight: 600; }
  .rc-piles .sm { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .rc-piles li.keep { opacity: .75; }`;
  function ensureCss() { if (document.getElementById("rc-css")) return; const s = document.createElement("style"); s.id = "rc-css"; s.textContent = css; document.head.appendChild(s); }

  function modal(html) {
    ensureCss();
    const back = document.createElement("div"); back.className = "rc-back";
    back.innerHTML = `<div class="rc-card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("click", e => { if (e.target === back) close(); });
    return { el: back.firstElementChild, close };
  }

  async function open({ sb, show, onDone }) {
    const m = modal(`<p class="rc-how">Checking ${esc(show.name)}…</p>`);
    const { data: p, error } = await sb.rpc("close_preview", { p_show: show.id });
    let route = null;
    try { const r = await sb.rpc("used_route_preview", { p_show: show.id }); if (!r.error) route = r.data; } catch {}
    if (error) { m.el.innerHTML = `<p class="rc-msg no">${esc(error.message)}</p><div class="rc-row"><button class="btn" type="button" data-x>Back</button></div>`; m.el.querySelector("[data-x]").onclick = m.close; return; }
    const checks = [];
    if (p.no_cost.length) checks.push(`${int(p.no_cost.length)} sale${p.no_cost.length === 1 ? " has" : "s have"} no cost, so profit is overstated<span class="sm">${esc(p.no_cost.slice(0, 8).join(" · "))}${p.no_cost.length > 8 ? ` · and ${int(p.no_cost.length - 8)} more` : ""}</span>`);
    if (p.no_number) checks.push(`${int(p.no_number)} sale${p.no_number === 1 ? " has" : "s have"} no sale number<span class="sm">They can’t be matched to a platform order for a cancellation later.</span>`);
    if (p.no_time) checks.push(`${int(p.no_time)} sale${p.no_time === 1 ? " has" : "s have"} no time logged`);
    if (p.zero_price) checks.push(`${int(p.zero_price)} sale${p.zero_price === 1 ? " is" : "s are"} at $0.00`);
    if (!p.sold && !p.canceled) checks.push("This show has no sales at all");
    m.el.innerHTML = `
      <div><span class="eyebrow">Close show</span><h2>${esc(p.show)}</h2></div>
      <div class="rc-grid">
        <div><span class="k">Books sold</span><span class="v">${int(p.sold)}</span><span class="d">${money(p.revenue)} revenue</span></div>
        <div><span class="k">Canceled</span><span class="v">${int(p.canceled)}</span><span class="d">${p.canceled ? money(p.canrev) + " · back on the shelf" : "none"}</span></div>
        <div><span class="k">Given away</span><span class="v">${int(p.given)}</span><span class="d">${p.given ? (p.gcost != null ? money(p.gcost) + " cost" : "logged") : "none"}</span></div>
        <div><span class="k">R’s</span><span class="v">${int(p.rejects)}</span><span class="d">shown, didn’t sell</span></div>
        ${p.after != null ? `<div><span class="k">Profit</span><span class="v">${money(p.after)}</span><span class="d">after giveaways · ${money(p.profit)} before</span></div>` : ""}
      </div>
      <div><div class="rc-how" style="margin-bottom:6px">Check before closing</div>
        <ul class="rc-checks">${checks.length ? checks.map(c => `<li>${c}</li>`).join("") : `<li class="ok">Nothing looks off.</li>`}</ul></div>
      ${routeHtml(route)}
      <p class="rc-how">Closing makes the show final: no more cancellations, giveaways or changes unless an owner reopens it. This summary is saved with the show.</p>
      ${p.request && p.request.status === "pending" ? `<p class="rc-msg ok">${p.manager ? `${esc(p.request.by || "Staff")} asked for this show to be closed.` : `Sent for approval${p.request.by ? " by " + esc(p.request.by) : ""}. A manager or owner will review and close it.`}</p>` : ""}
      ${p.request && p.request.status === "sent back" ? `<p class="rc-msg no">Sent back: ${esc(p.request.answer)}</p>` : ""}
      ${p.can_close || !p.manager ? "" : `<p class="rc-msg no">${esc(p.why || "This show can’t be closed right now.")}</p>`}
      ${!p.manager && !(p.request && p.request.status === "pending") ? `<label class="rc-how" for="rcNote">Note for the manager (optional)</label><input id="rcNote" placeholder="e.g. all cancellations and giveaways are done">` : ""}
      <div class="rc-row">${p.can_close ? `<button class="btn pri" type="button" data-go>Close show</button>` : !p.manager && !(p.request && p.request.status === "pending") ? `<button class="btn pri" type="button" data-ask>Send for approval</button>` : ""}<button class="btn" type="button" data-x>Back</button><span class="rc-msg" data-msg></span></div>`;
    m.el.querySelector("[data-x]").onclick = m.close;
    const ask = m.el.querySelector("[data-ask]");
    if (ask) ask.onclick = async () => {
      ask.disabled = true;
      const msg = m.el.querySelector("[data-msg]");
      const { error: e3 } = await sb.rpc("ful_request_close", { p_show: show.id, p_note: (m.el.querySelector("#rcNote") || {}).value || "" });
      if (e3) { ask.disabled = false; msg.className = "rc-msg no"; msg.textContent = e3.message; return; }
      msg.className = "rc-msg ok"; msg.textContent = "Sent. A manager or owner will review and close it."; ask.remove();
      m.el.querySelector("[data-x]").textContent = "Done";
      if (onDone) onDone();
    };
    const go = m.el.querySelector("[data-go]");
    if (go) go.onclick = async () => {
      go.disabled = true; m.el.querySelector("[data-msg]").textContent = "Closing…";
      const { error: e2 } = await sb.rpc("close_show", { p_show: show.id });
      const msg = m.el.querySelector("[data-msg]");
      if (e2) { go.disabled = false; msg.className = "rc-msg no"; msg.textContent = e2.message; return; }
      msg.className = "rc-msg ok"; msg.textContent = "Closed." + routeDone(route); go.remove();
      m.el.querySelector("[data-x]").textContent = "Done";
      if (onDone) onDone();
    };
  }

  // Used shows: where the books that didn't sell go when the show is closed.
  const PILES = {
    back_end: { w: "Back-end tote", d: "BE ACCEPT · one full show on the stream" },
    sbyb: { w: "SBYB gaylord", d: "SBYB · marked as its last showing" },
    recycle: { w: "Recycling", d: "no tag · marked as its last showing" },
    keep: { w: "Stay in stream inventory", d: "not on their last showing yet" }
  };
  function routeHtml(route) {
    if (!route || !(route.books || []).length) return "";
    const by = {};
    route.books.forEach(b => { (by[b.route] = by[b.route] || []).push(b); });
    const line = (k) => {
      const list = by[k]; if (!list || !list.length) return "";
      const names = list.map(b => b.title || ("ISBN " + b.isbn));
      return `<li class="${k === "keep" ? "keep" : ""}"><span class="n">${int(list.length)}</span><span class="w">${esc(PILES[k].w)}</span>
        <span class="sm">${esc(PILES[k].d)} · ${esc(names.slice(0, 4).join(" · "))}${names.length > 4 ? ` · and ${int(names.length - 4)} more` : ""}</span></li>`;
    };
    const moving = ["back_end", "sbyb", "recycle"].reduce((n, k) => n + ((by[k] || []).length), 0);
    return `<div><div class="rc-how" style="margin-bottom:6px">Books that didn’t sell${route.last_chance_show ? " · last showing is on for the whole show" : ""}</div>
      <ul class="rc-piles">${["back_end", "sbyb", "recycle", "keep"].map(line).join("")}</ul>
      <p class="rc-how" style="margin-top:6px">${moving ? `Closing takes ${int(moving)} book${moving === 1 ? "" : "s"} out of stream inventory and marks where ${moving === 1 ? "it goes" : "they go"}. Sort the physical books the same way.` : "Nothing leaves stream inventory."}</p></div>`;
  }
  function routeDone(route) {
    if (!route) return "";
    const n = (route.books || []).filter(b => b.route !== "keep").length;
    return n ? ` ${int(n)} book${n === 1 ? "" : "s"} left stream inventory.` : "";
  }

  function reopen({ sb, show, onDone }) {
    const m = modal(`
      <div><span class="eyebrow">Reopen show</span><h2>${esc(show.name)}</h2></div>
      <p class="rc-how">Reopening lets cancellations, giveaways and changes happen again. Close it again when you’re done. The reopen and its reason are kept with the show.</p>
      <label class="rc-how" for="rcWhy">Why is it being reopened?</label><input id="rcWhy" placeholder="e.g. late cancellation from the buyer">
      <div class="rc-row"><button class="btn pri" type="button" data-go>Reopen show</button><button class="btn" type="button" data-x>Back</button><span class="rc-msg" data-msg></span></div>`);
    m.el.querySelector("#rcWhy").focus();
    m.el.querySelector("[data-x]").onclick = m.close;
    const go = m.el.querySelector("[data-go]");
    go.onclick = async () => {
      const why = m.el.querySelector("#rcWhy").value.trim(), msg = m.el.querySelector("[data-msg]");
      if (!why) { msg.className = "rc-msg no"; msg.textContent = "Say why first."; return; }
      go.disabled = true;
      const { error } = await sb.rpc("reopen_show", { p_show: show.id, p_reason: why });
      if (error) { go.disabled = false; msg.className = "rc-msg no"; msg.textContent = error.message; return; }
      m.close(); if (onDone) onDone();
    };
  }
  window.ReliantClose = { open, reopen };
})();
