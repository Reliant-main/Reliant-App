// Shows "Update available" when the Reliant App lists a newer Scan Helper.
(async () => {
  const mine = chrome.runtime.getManifest().version;
  document.getElementById("ver").textContent = "v" + mine;
  const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
  try {
    const r = await fetch("https://reliant-main.github.io/Reliant-App/tools.json", { cache: "no-store" });
    const t = ((await r.json()).tools || []).find(x => x.id === "scan-helper");
    if (t && newer(t.version, mine)) {
      document.getElementById("updText").textContent = `Update available: version ${t.version} (this computer has ${mine}). Get it in the Reliant App under Computer tools.`;
      document.getElementById("upd").hidden = false;
    }
  } catch {}
})();
