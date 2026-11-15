// Runs inside the live page. Watches the page's own live feeds (WebSocket messages and data requests)
// and passes anything that might be a sale to the extension. It never changes what the page does.
(() => {
  if (window.__reliantReader) return;
  window.__reliantReader = true;
  let mode = "off";
  window.addEventListener("message", e => {
    if (e.source === window && e.data && e.data.__rprMode) mode = e.data.__rprMode;
  });
  const HINT = /sold|purchas|order|winner|won\b|bought|buyer|checkout|auction|giveaway|claim/i;
  const MAX = 200000;
  // binary frames (TikTok sends these): keep the readable pieces, like the "strings" tool
  function readable(buf) {
    const v = new Uint8Array(buf), out = []; let run = "";
    const n = Math.min(v.length, MAX);
    for (let i = 0; i < n; i++) {
      const c = v[i];
      if (c >= 32 && c < 127) run += String.fromCharCode(c);
      else { if (run.length >= 3) out.push(run); run = ""; }
    }
    if (run.length >= 3) out.push(run);
    return out.join("|");
  }
  function send(kind, text, url) {
    if (mode === "off" || !text) return;
    if (text.length > MAX) text = text.slice(0, MAX);
    if (!HINT.test(text)) return;
    window.postMessage({ __rprData: 1, kind, text, url: String(url || "").slice(0, 300), t: Date.now() }, "*");
  }
  function inspect(kind, data, url) {
    try {
      if (mode === "off" || data == null) return;
      if (typeof data === "string") send(kind, data, url);
      else if (data instanceof ArrayBuffer) send(kind + "-bin", readable(data), url);
      else if (typeof Blob !== "undefined" && data instanceof Blob) data.arrayBuffer().then(b => send(kind + "-bin", readable(b), url)).catch(() => {});
      else if (ArrayBuffer.isView(data)) send(kind + "-bin", readable(data.buffer), url);
    } catch {}
  }
  // WebSocket
  const NativeWS = window.WebSocket;
  if (NativeWS) {
    const Wrapped = function (...args) {
      const ws = new NativeWS(...args);
      try { ws.addEventListener("message", e => inspect("ws", e.data, ws.url)); } catch {}
      return ws;
    };
    Wrapped.prototype = NativeWS.prototype;
    try { Object.defineProperty(Wrapped, "name", { value: "WebSocket" }); } catch {}
    Object.setPrototypeOf(Wrapped, NativeWS);
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(k => { try { Object.defineProperty(Wrapped, k, { value: NativeWS[k] }); } catch {} });
    window.WebSocket = Wrapped;
  }
  // fetch
  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (...args) {
      const p = nativeFetch.apply(this, args);
      if (mode !== "off") {
        p.then(r => {
          try {
            const ct = r.headers.get("content-type") || "";
            if (!/json|text|protobuf|octet/i.test(ct)) return;
            const url = r.url || (args[0] && args[0].url) || String(args[0]);
            if (/json|text/i.test(ct)) r.clone().text().then(t => inspect("fetch", t, url)).catch(() => {});
            else r.clone().arrayBuffer().then(b => inspect("fetch", b, url)).catch(() => {});
          } catch {}
        }).catch(() => {});
      }
      return p;
    };
  }
  // XMLHttpRequest
  const X = window.XMLHttpRequest;
  if (X) {
    const open = X.prototype.open;
    X.prototype.open = function (m, url, ...rest) { this.__rprUrl = url; return open.call(this, m, url, ...rest); };
    const sendX = X.prototype.send;
    X.prototype.send = function (...args) {
      if (mode !== "off") {
        this.addEventListener("load", () => {
          try {
            const rt = this.responseType;
            if (rt === "" || rt === "text") inspect("xhr", this.responseText, this.__rprUrl);
            else if (rt === "json") inspect("xhr", JSON.stringify(this.response), this.__rprUrl);
            else if (rt === "arraybuffer") inspect("xhr", this.response, this.__rprUrl);
          } catch {}
        });
      }
      return sendX.apply(this, args);
    };
  }
})();
