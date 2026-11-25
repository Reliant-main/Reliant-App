// Tells the Reliant App's Computer tools page which version of the Scan Helper is on this computer.
(() => {
  const v = chrome.runtime.getManifest().version;
  const say = () => window.postMessage({ __reliantTool: "scan-helper", version: v }, location.origin);
  say();
  window.addEventListener("message", e => { if (e.source === window && e.data && e.data.__reliantToolsAsk) say(); });
})();
