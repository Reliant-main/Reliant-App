// One reader per app. Each turns what the live page shows (feed messages or new page elements) into sales:
//   { event_id, buyer: { id?, username }, price, title?, kind? }
// The readers start empty. They get filled in from "Learning" recordings of real shows,
// and updated whenever an app changes its page.
(() => {
  const today = () => new Date().toLocaleDateString("en-CA");          // 2026-11-15
  const pathKey = re => { const m = location.pathname.match(re); return m ? m[1] : null; };
  window.RPR_READERS = {
    WN: {
      name: "Whatnot",
      ready: false,
      showKey: () => "WN-" + (pathKey(/\/live\/([\w-]+)/) || pathKey(/\/([\w-]+)\/?$/) || "page") + "-" + today(),
      fromData(kind, text, url) { return []; },
      fromNode(node) { return []; },
    },
    TT: {
      name: "TikTok",
      ready: false,
      showKey: () => "TT-" + (pathKey(/@([\w.-]+)\/live/) || pathKey(/\/([\w-]+)\/?$/) || "page") + "-" + today(),
      fromData(kind, text, url) { return []; },
      fromNode(node) { return []; },
    },
    EB: {
      name: "eBay",
      ready: false,
      showKey: () => "EB-" + (pathKey(/\/live\/(?:[\w-]+\/)?([\w-]+)/) || pathKey(/\/([\w-]+)\/?$/) || "page") + "-" + today(),
      fromData(kind, text, url) { return []; },
      fromNode(node) { return []; },
    },
  };
})();
