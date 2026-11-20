// One reader per app. Each turns what the live page shows (feed messages or new page elements) into sales:
//   { event_id, buyer: { id?, username, display_name? } | null, price, title?, kind?, status?, at? }
// status: "awaiting_payment" | "paid" | "cancelled" (a sale is sent again when its status changes).
// A reader can also return { sales: [...], feed: { total } } when the data is the app's full sales list,
// so the extension knows it is still hearing the app and can check nothing was missed.
// Readers are built from "Learning" recordings of real shows and updated whenever an app changes its page.
(() => {
  const today = () => new Date().toLocaleDateString("en-CA");          // 2026-11-15
  const pathKey = re => { const m = location.pathname.match(re); return m ? m[1] : null; };
  const queryKey = name => new URLSearchParams(location.search).get(name);

  // TikTok seller dashboard (shop.tiktok.com/streamer/live/product/dashboard?session_id=...).
  // The dashboard keeps asking TikTok for this LIVE's auction results every few seconds. Each answer is the
  // whole list, newest first, with TikTok's own order number, so the same sale is never made twice.
  // Learned from the 11/16/2026 show, checked against the 11/16-11/19 shows.
  // order_status: 5 = auction won, order not made yet (no order number, ~2 s after the gavel; the order
  // number follows 3-7 s later, and now and then never comes), 2 = waiting for payment, 3 = paid, 4 = payment failed.
  // Each sale is keyed on the auction (product + the moment it ended), not TikTok's order number, so the chit
  // prints at the win and the same auction stays one ticket as it moves from 5 to 2 to 3.
  // Now and then an answer comes back with the buyer left blank (ttuid "0"); the next answer has it.
  const TT_FEED = /\/live_auction\/auction_result\/get/;
  const TT_STATUS = { 5: "awaiting_payment", 2: "awaiting_payment", 3: "paid", 4: "cancelled" };
  function ttKey(r) {
    const end = Number(r.auction_end_timestamp);
    if (Number.isFinite(end) && end > 0) return "A" + String(r.product_id || r.sku_id || "x").replace(/\W/g, "") + "-" + end;
    return r.order_id ? "O" + String(r.order_id).replace(/\W/g, "") : null;
  }
  function ttSale(r) {
    const key = r && ttKey(r);
    if (!key) return null;
    const uid = r.ttuid != null ? String(r.ttuid) : "";
    const named = uid && uid !== "0" && (r.user_display_id || r.user_name);
    const price = Number(String(r.selling_price ?? "").replace(/[^0-9.]/g, ""));
    const t = Number(r.auction_end_timestamp || r.order_create_time);
    return {
      event_id: key,
      buyer: named ? { id: uid, username: r.user_display_id || r.user_name, display_name: r.user_name || null } : null,
      price: Number.isFinite(price) ? price : null,
      title: r.product_name || null,
      kind: "auction",
      status: TT_STATUS[r.order_status] || (r.is_payment_successful ? "paid" : "awaiting_payment"),
      at: t > 1e12 ? new Date(t).toISOString() : undefined,
    };
  }

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
      ready: true,
      feedBased: true,                       // the extension warns when this app's sales list goes quiet
      onFeedPage: () => /\/streamer\/live\//.test(location.pathname),
      session: () => queryKey("session_id"),
      showKey: () => "TT-" + (queryKey("session_id") || pathKey(/@([\w.-]+)\/live/) || "page") + "-" + today(),
      fromData(kind, text, url) {
        if (!TT_FEED.test(url || "")) return [];
        let j;
        try { j = JSON.parse(text); } catch { throw new Error("TikTok's auction results couldn't be read (the page may have changed)"); }
        if (!j || j.code !== 0) return [];
        if (!Array.isArray(j.auction_result_data)) throw new Error("TikTok's auction results look different (the page may have changed)");
        const sales = j.auction_result_data.map(ttSale).filter(Boolean);
        const total = Number(j.total_result_count);
        return { sales, feed: { total: Number.isFinite(total) ? total : sales.length } };
      },
      fromNode(node) { return []; },
    },
    EB: {
      name: "eBay",
      ready: false,
      // Learning only (not enough recorded yet to read sales): on eBay Live host pages, the listing rows
      // ("PAID #033 - title $2.00 🏆 buyer PAID 1 bid") plus any line about a win, sold or bid, as plain text.
      snapshot() {
        if (!/\/ebaylive\//.test(location.pathname) || !document.body) return "";
        const rows = [...document.querySelectorAll('[aria-roledescription="sortable"]')]
          .map(el => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()).filter(t => /#\d{1,4}\b/.test(t));
        const lines = (document.body.innerText || document.body.textContent || "").split("\n").map(t => t.trim())
          .filter(t => t && t.length < 200 && /🏆|\bwon\b|\bsold\b|winner|\bbids?\b|unpaid|awaiting/i.test(t));
        const out = (rows.length ? "ROWS\n" + rows.join("\n") + "\n" : "") + (lines.length ? "LINES\n" + [...new Set(lines)].join("\n") : "");
        return out.slice(0, 7900);
      },
      showKey: () => "EB-" + (pathKey(/\/live\/(?:[\w-]+\/)?([\w-]+)/) || pathKey(/\/([\w-]+)\/?$/) || "page") + "-" + today(),
      fromData(kind, text, url) { return []; },
      fromNode(node) { return []; },
    },
  };
})();
