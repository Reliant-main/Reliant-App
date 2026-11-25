/* Reliant App colors and the clean sidebar-era look.
   Loaded in <head> of the shell (index.html) and every section page.
   - 10 color schemes: Clean light, Clean dark, and the 8 Book Spotlight schemes.
   - The chosen scheme is saved per person (their sign-in) by index.html and
     mirrored to this device in localStorage["reliant.theme"], so pages paint in
     the right colors straight away and switch live when it changes. */
(function () {
  "use strict";
  var KEY = "reliant.theme";
  // [name, light?, bg, surface, surface-2, ink, muted, accent, line, on-accent]
  var SPOT = {
    bookcloth: ["Bookcloth green", false, "#10261f", "#173329", "#21443a", "#efe7d4", "#b9b29f", "#d2a54a", "#2f5348", "#10261f"],
    blush:     ["Blush pink (light)", true, "#fbe8ee", "#fff6f9", "#f5d3de", "#3b2230", "#7d5a6a", "#b23468", "#e6bccb", "#ffffff"],
    paper:     ["Paper cream (light)", true, "#f5f0e4", "#fffbf2", "#ebe1cb", "#2b2925", "#6b665a", "#8a5a12", "#d9cdb3", "#ffffff"],
    midnight:  ["Midnight blue", false, "#0f1724", "#172235", "#22314a", "#e8edf5", "#9ba9be", "#e3b450", "#2d3f5b", "#0f1724"],
    plum:      ["Plum", false, "#22162a", "#2e1f37", "#3e2b49", "#f4eaf6", "#bfa9c6", "#f2a7c9", "#4b3658", "#22162a"],
    rose:      ["Dark rose", false, "#2a0f1d", "#3a1529", "#4d1d37", "#fbe9f1", "#d4a9bd", "#ff7eb6", "#5e2944", "#2a0f1d"],
    crimson:   ["Crimson", false, "#240a0c", "#341013", "#49171b", "#f8e9e6", "#cfa7a2", "#ff7a6b", "#5a2226", "#240a0c"],
    bordeaux:  ["Bordeaux & gold", false, "#2b1117", "#3a1820", "#4c222b", "#f3e6d8", "#c9ae9c", "#d9b77a", "#5c2c35", "#2b1117"]
  };
  var LIGHT_STATUS = { good: "#1f7a3a", bad: "#b42318", warnbg: "#fdf0d5", warnfg: "#7a5200", badbg: "#fbe4e1",
    s: "--s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #c98500; --s5: #e87ba4; --q1: #86b6ef; --q2: #5598e7; --q3: #2a78d6; --q4: #1c5cab; --q5: #104281;" };
  var DARK_STATUS = { good: "#8fd19e", bad: "#ef8b8b", warnbg: "rgba(242,195,90,.14)", warnfg: "#f2c35a", badbg: "rgba(239,107,107,.15)",
    s: "--s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --q1: #184f95; --q2: #1c5cab; --q3: #2a78d6; --q4: #5598e7; --q5: #9ec5f4;" };

  var T = {
    "clean-light": { name: "Clean light", light: true, v: { bg: "#f1f2f0", surface: "#ffffff", s2: "#f6f7f5", ink: "#1c2420", ink2: "#3f4a44", muted: "#5f6a63", line: "#dfe3dd", accent: "#1d5a45", wash: "rgba(29,90,69,.08)", gilt: "#8a6416", on: "#ffffff", side: "#e9ebe8", bar: "#10261f", barInk: "#eef0ea" } },
    "clean-dark":  { name: "Clean dark", light: false, v: { bg: "#0e1915", surface: "#15231e", s2: "#1b2c26", ink: "#eef0ea", ink2: "#c0c6bd", muted: "#9aa59d", line: "rgba(255,255,255,.10)", accent: "#7fc7a6", wash: "rgba(127,199,166,.10)", gilt: "#d2a54a", on: "#0e1915", side: "#111e19", bar: "#0a120f", barInk: "#eef0ea" } }
  };
  Object.keys(SPOT).forEach(function (id) {
    var a = SPOT[id];
    T[id] = { name: a[0], light: a[1], v: { bg: a[2], surface: a[3], s2: a[4], ink: a[5],
      ink2: "color-mix(in srgb, " + a[5] + " 72%, " + a[6] + ")", muted: a[6], line: a[8], accent: a[7],
      wash: "color-mix(in srgb, " + a[7] + " 12%, transparent)", gilt: a[7], on: a[9],
      side: a[1] ? a[4] : a[3], bar: a[1] ? a[5] : "color-mix(in srgb, " + a[2] + " 70%, #000)", barInk: a[1] ? a[2] : a[5] } };
  });
  var ORDER = ["clean-light", "clean-dark", "bookcloth", "blush", "paper", "midnight", "plum", "rose", "crimson", "bordeaux"];
  var DEFAULT = "clean-light";

  function vars(id) {
    var t = T[id], v = t.v, st = t.light ? LIGHT_STATUS : DARK_STATUS;
    return [
      "--bg:" + v.bg, "--surface:" + v.surface, "--surface-2:" + v.s2, "--ink:" + v.ink, "--ink-2:" + v.ink2,
      "--muted:" + v.muted, "--line:" + v.line, "--accent:" + v.accent, "--accent-wash:" + v.wash, "--gilt:" + v.gilt,
      "--on-accent:" + v.on, "--good:" + st.good, "--bad:" + st.bad, "--warnbg:" + st.warnbg, "--warnfg:" + st.warnfg, "--badbg:" + st.badbg,
      "--grid: color-mix(in srgb, " + v.line + " 70%, " + v.bg + ")", "--axis:" + v.line,
      "--side:" + v.side, "--bar:" + v.bar, "--bar-ink:" + v.barInk,
      // older names used by Settings and the sign-in screens
      "--cloth:" + v.bg, "--cloth-2:" + v.surface, "--cloth-3:" + v.s2, "--paper:" + v.ink, "--paper-dim:" + v.muted, "--rule:" + v.line,
      "color-scheme:" + (t.light ? "light" : "dark")
    ].join(";") + ";" + st.s;
  }

  var css = ORDER.map(function (id) { return "html:root[data-rtheme=\"" + id + "\"]{" + vars(id) + "}"; }).join("\n") + "\n" + [
    // one clean typeface throughout (Book Spotlight and the TV keep their own look)
    "html:root[data-rtheme]{--f-display:\"Inter\",system-ui,-apple-system,\"Segoe UI\",sans-serif;--f-ui:\"Inter\",system-ui,-apple-system,\"Segoe UI\",sans-serif;--f-text:\"Inter\",system-ui,sans-serif}",
    "html[data-rtheme] body{font-size:14px;-webkit-font-smoothing:antialiased}",
    "html[data-rtheme] h1,html[data-rtheme] h2,html[data-rtheme] h3{font-weight:700;letter-spacing:-.01em}",
    "html[data-rtheme] header.top h1{font-size:22px}",
    "html[data-rtheme] header.top .eyebrow{display:none}",
    "html[data-rtheme] .status{font-family:var(--f-ui)}",
    // number boxes become separate cards
    "html[data-rtheme] .kpis{gap:12px;background:transparent;border:0;border-radius:0;overflow:visible}",
    "html[data-rtheme] .kpis>.kpi{border:1px solid var(--line);border-radius:12px;box-shadow:var(--card-shadow,none)}",
    "html[data-rtheme] .kpi .k,html[data-rtheme] .tile .k{font:500 12px var(--f-ui);letter-spacing:0;text-transform:none;color:var(--muted)}",
    "html[data-rtheme] .kpi .v{font-weight:700;letter-spacing:-.02em}",
    // table headings and small labels: plain text instead of spaced capitals
    "html[data-rtheme] th,html[data-rtheme] th .sorth,html[data-rtheme] .fld label,html[data-rtheme] .lbl{font-family:var(--f-ui);letter-spacing:0;text-transform:none}",
    "html[data-rtheme] th,html[data-rtheme] th .sorth{font-size:12px;font-weight:600}",
    "html[data-rtheme] .fld label{font-size:12px;font-weight:600}",
    // buttons on the accent color use the scheme's matching text color
    "html[data-rtheme] .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}",
    "html[data-rtheme] .seg button[aria-pressed=\"true\"]{color:var(--on-accent)}",
    "html[data-rtheme] .btn.warn.armed{background:var(--badbg)}",
    // number boxes share the row evenly (Analytics has 7)
    "html[data-rtheme] .kpis{grid-template-columns:repeat(auto-fit,minmax(min(132px,100%),1fr))}",
    // small capitals labels become plain text; Settings gets the same page heading as the rest
    "html[data-rtheme] .eyebrow{font-family:var(--f-ui);letter-spacing:.06em}",
    "html[data-rtheme] label.f{font:600 12px var(--f-ui);letter-spacing:0;text-transform:none}",
    "html[data-rtheme] .wrap>header:first-child .eyebrow{display:none}",
    "html[data-rtheme] .wrap>header:first-child h1{font-size:22px}",
    "html[data-rtheme] .sech h2{font-size:18px}",
    "html[data-rtheme] .level b{font-size:16px;font-weight:700}",
    "html[data-rtheme] .tag.used{background:var(--warnbg);color:var(--warnfg)}",
    // no stray scroll arrows on the tab rows
    "html[data-rtheme] .tabs{scrollbar-width:none}",
    "html[data-rtheme] .tabs::-webkit-scrollbar{display:none}",
    // light schemes: soft card edges
    "html[data-rlight] {--card-shadow:0 1px 0 rgba(0,0,0,.05)}",
    "html[data-rlight] .panel,html[data-rlight] .card{box-shadow:var(--card-shadow)}"
  ].join("\n");

  function current() {
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    return T[id] ? id : DEFAULT;
  }
  function apply(id) {
    if (!T[id]) id = DEFAULT;
    var h = document.documentElement;
    h.setAttribute("data-rtheme", id);
    if (T[id].light) h.setAttribute("data-rlight", ""); else h.removeAttribute("data-rlight");
    // Analytics switches its own light/dark chart colors with data-theme
    if (h.hasAttribute("data-theme")) h.setAttribute("data-theme", T[id].light ? "light" : "dark");
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", T[id].v.bar);
  }
  function save(id) {
    if (!T[id]) return;
    try { localStorage.setItem(KEY, id); } catch (e) {}
    apply(id);
  }

  var style = document.createElement("style");
  style.id = "reliant-theme";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  if (!document.querySelector('link[data-inter]')) {
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.setAttribute("data-inter", "");
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    (document.head || document.documentElement).appendChild(l);
  }
  apply(current());
  // another tab or the shell changed the scheme: follow it
  addEventListener("storage", function (e) { if (e.key === KEY) apply(current()); });

  window.RELIANT_THEME = {
    list: ORDER.map(function (id) { return { id: id, name: T[id].name, light: T[id].light }; }),
    current: current, apply: apply, save: save, DEFAULT: DEFAULT
  };
})();
