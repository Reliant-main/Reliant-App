// ISBN helpers shared by the page script and the background.
// isbn13(): a valid ISBN-13 (978/979, check digit checked) or an ISBN-10 converted to ISBN-13; otherwise null.
(function (root) {
  function isbn13(raw) {
    const s = String(raw || "").replace(/[\s-]/g, "").toUpperCase();
    if (/^97[89]\d{10}$/.test(s)) {
      let t = 0; for (let i = 0; i < 12; i++) t += +s[i] * (i % 2 ? 3 : 1);
      return (10 - (t % 10)) % 10 === +s[12] ? s : null;
    }
    if (/^\d{9}[\dX]$/.test(s)) {
      let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === "X" ? 10 : +s[i]) * (10 - i);
      if (t % 11) return null;
      const b = "978" + s.slice(0, 9); let u = 0; for (let i = 0; i < 12; i++) u += +b[i] * (i % 2 ? 3 : 1);
      return b + ((10 - (u % 10)) % 10);
    }
    return null;
  }
  // The ISBN-10 form of a 978 ISBN-13 (so we can spot it on the page either way).
  function isbn10(i13) {
    if (!/^978\d{10}$/.test(i13 || "")) return null;
    const b = i13.slice(3, 12); let t = 0; for (let i = 0; i < 9; i++) t += +b[i] * (10 - i);
    const c = (11 - (t % 11)) % 11; return b + (c === 10 ? "X" : String(c));
  }
  // Every ISBN-looking token in a piece of text, as ISBN-13s.
  function isbnsIn(text) {
    const out = new Set();
    const m = String(text || "").match(/[0-9Xx][0-9Xx\- ]{8,20}[0-9Xx]/g) || [];
    for (const tok of m) {
      const v = isbn13(tok); if (v) { out.add(v); continue; }
      for (const part of tok.split(/\s+/)) { const w = isbn13(part); if (w) out.add(w); }
    }
    return out;
  }
  root.RSH_ISBN = { isbn13, isbn10, isbnsIn };
})(typeof self !== "undefined" ? self : globalThis);
