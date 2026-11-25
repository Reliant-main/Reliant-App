// Reliant Scan Helper — the station banner rules.
// The rules themselves (the profit line, which words put a book in which group, bin overrides,
// banner colors and wording) come from the Reliant App ("scan_rules"), so they can change
// without a new version of the extension. DEFAULT_RULES is only used until the App answers.
(function (root) {
  const DEFAULT_RULES = {
    "version": 5,
    "accept_profit_min": 2.5,
    "group_order": [
      "religious",
      "politics",
      "selfhelp",
      "textbook",
      "fiction"
    ],
    "groups": {
      "religious": {
        "label": "Religious",
        "words": [
          "Religion",
          "Christian",
          "Bible",
          "Theology",
          "Spirituality",
          "Church",
          "Catholic",
          "Devotional",
          "Prayer",
          "Ministry"
        ]
      },
      "politics": {
        "label": "Political Science / Politics & Culture",
        "words": [
          "Politics & Government",
          "Political Science",
          "Political"
        ]
      },
      "selfhelp": {
        "label": "Self-Help, Health & Wellness, Parenting & Relationships",
        "words": [
          "Self-Help",
          "Self Help",
          "Self-Improvement",
          "Self Improvement",
          "Motivation"
        ]
      },
      "textbook": {
        "label": "Textbooks, Education & Teaching",
        "words": [
          "Textbook"
        ]
      },
      "fiction": {
        "label": "Fiction",
        "words": [
          "Fiction",
          "Romance",
          "Mystery",
          "Thriller",
          "Suspense",
          "Fantasy",
          "Science Fiction",
          "Horror",
          "Westerns",
          "Classics",
          "Graphic Novels",
          "Poetry"
        ]
      }
    },
    "not_fiction_words": [
      "Nonfiction",
      "Non-Fiction",
      "Non Fiction",
      "Essays",
      "History & Criticism",
      "Correspondence"
    ],
    "back_end_only_groups": [
      "politics",
      "selfhelp",
      "textbook"
    ],
    "bin_groups": {
      "1-25": "religious",
      "2-41": "religious",
      "2-46": "religious",
      "3-70": "politics",
      "2-42": "selfhelp",
      "2-45": "selfhelp",
      "3-68": "textbook"
    },
    "banners": {
      "hand_search": {
        "label": "HAND SEARCH",
        "bg": "#6B7570",
        "fg": "#FFFFFF"
      },
      "accept": {
        "label": "ACCEPT",
        "bg": "#1E8A2E",
        "fg": "#FFFFFF"
      },
      "recycle": {
        "label": "REJECT",
        "bg": "#D62A1E",
        "fg": "#FFFFFF"
      },
      "religious": {
        "label": "RELIGIOUS",
        "bg": "#000000",
        "fg": "#FFFFFF"
      },
      "tt_then_back": {
        "label": "STREAM",
        "bg": "#FFFFFF",
        "fg": "#10261F",
        "tag": "BE ACCEPT"
      },
      "sbyb": {
        "label": "STREAM",
        "bg": "#FFFFFF",
        "fg": "#10261F",
        "tag": "SBYB"
      },
      "stream": {
        "label": "STREAM",
        "bg": "#FFFFFF",
        "fg": "#10261F"
      },
      "ebay": {
        "label": "EBAY ONLY",
        "bg": "#F28C28",
        "fg": "#10261F"
      },
      "sbyb_gaylord": {
        "label": "SBYB",
        "bg": "#FFD60A",
        "fg": "#10261F"
      }
    },
    "tags": {
      "tt_then_back": "BE ACCEPT",
      "sbyb": "SBYB"
    },
    "boxes": {
      "picture_books": {
        "label": "KIDS 0-6",
        "bg": "#6EC6F0",
        "fg": "#10261F",
        "note": "Children's 0-2 to 0-4 (age 0-6)"
      },
      "young_readers": {
        "label": "KIDS 6-11",
        "bg": "#0E8C8C",
        "fg": "#FFFFFF",
        "note": "Children's 0-5 to 0-7 (age 6-11)"
      },
      "young_teen": {
        "label": "TEEN 12-14",
        "bg": "#D9B98C",
        "fg": "#10261F",
        "note": "Teen 0-9 (age 12-14)"
      },
      "romance": {
        "label": "ROMANCE",
        "bg": "#E8559B",
        "fg": "#FFFFFF"
      },
      "mystery": {
        "label": "MYSTERY & THRILLER",
        "bg": "#1F3A93",
        "fg": "#FFFFFF"
      },
      "fantasy_scifi": {
        "label": "FANTASY & SCI-FI",
        "bg": "#6B3FA0",
        "fg": "#FFFFFF"
      },
      "historical_western": {
        "label": "HISTORICAL & WESTERN",
        "bg": "#7B4A2A",
        "fg": "#FFFFFF"
      },
      "general_fiction": {
        "label": "GENERAL FICTION",
        "bg": "#FFFFFF",
        "fg": "#10261F"
      },
      "religious": {
        "label": "RELIGIOUS",
        "bg": "#000000",
        "fg": "#FFFFFF"
      },
      "nonfiction": {
        "label": "EBAY NON-FICTION",
        "bg": "#F28C28",
        "fg": "#10261F"
      },
      "scanner_choice": {
        "label": "SCANNER CHOICE",
        "bg": "#FFFFFF",
        "fg": "#10261F",
        "pattern": "rainbow",
        "note": "No box — use your best judgment on the genre"
      }
    },
    "bin_boxes": {
      "0-2": "picture_books",
      "0-3": "picture_books",
      "0-4": "picture_books",
      "0-5": "young_readers",
      "0-6": "young_readers",
      "0-7": "young_readers",
      "0-9": "young_teen",
      "0-10": "genre",
      "0-11": "genre",
      "0-1": "scanner_choice",
      "1-20": "historical_western",
      "1-21": "general_fiction",
      "1-22": "fantasy_scifi",
      "1-23": "general_fiction",
      "1-24": "historical_western",
      "1-25": "religious",
      "1-26": "mystery",
      "1-27": "romance",
      "1-28": "romance",
      "1-29": "fantasy_scifi",
      "1-30": "mystery",
      "1-31": "historical_western",
      "3-60": "genre",
      "3-61": "genre",
      "3-62": "genre",
      "3-63": "genre",
      "3-71": "scanner_choice",
      "3-76": "scanner_choice",
      "3-77": "scanner_choice",
      "2-40": "nonfiction",
      "2-43": "nonfiction",
      "2-44": "nonfiction",
      "3-64": "nonfiction",
      "3-65": "nonfiction",
      "3-66": "nonfiction",
      "3-67": "nonfiction",
      "3-69": "nonfiction",
      "3-72": "nonfiction",
      "3-73": "nonfiction",
      "3-74": "nonfiction",
      "3-75": "nonfiction"
    },
    "genre_boxes": [
      {
        "box": "romance",
        "words": [
          "Romance",
          "Romantic"
        ]
      },
      {
        "box": "mystery",
        "words": [
          "Mystery",
          "Mysteries",
          "Thriller",
          "Suspense",
          "Crime",
          "Detective",
          "Horror"
        ]
      },
      {
        "box": "fantasy_scifi",
        "words": [
          "Fantasy",
          "Science Fiction",
          "Sci-Fi",
          "Sci Fi",
          "Dystopian",
          "Steampunk",
          "Paranormal",
          "Supernatural"
        ]
      },
      {
        "box": "historical_western",
        "words": [
          "Historical",
          "Western"
        ]
      }
    ],
    "auto_add": {
      "stream": "stream",
      "ebay": "stream",
      "tt_then_back": "stream",
      "sbyb": "stream",
      "accept": "accept"
    },
    "category_share_min": 0.5
  };

  const lc = (s) => String(s || "").toLowerCase();
  const normBin = (b) => String(b || "").replace(/\s+/g, "").replace(/[.]/g, "-");

  // CashMonkey's call: accept, reject, sbyb or miss (no catalog data).
  function cmKind(cm) {
    const r = lc(cm && (cm.result || cm.result_text));
    if (!cm || /more info|catalog miss/.test(r)) return "miss";
    if (/reject/.test(r)) return "reject";
    if (/sbyb/.test(r)) return "sbyb";
    if (r) return "accept";
    return cm.title ? "reject" : "miss";
  }

  // Which group the book is in. Looks at CashMonkey's bin first, then Amazon's categories,
  // then the subject line; the first place that matches a group decides.
  // Which group a book is in. Strongest evidence first:
  //  1. a bin pinned to a group (e.g. 3 - 70 → politics)   2. CashMonkey's textbook flag
  //  3. CashMonkey's bin name (e.g. "Fiction - Romance")     4. the publisher's subject line (one main subject)
  //  5. Amazon's categories, by vote: a group needs at least `category_share_min` (default half) of them,
  //     so one stray category (e.g. "Humor > Political" on a comedy memoir) can't decide it.
  //     Essays, criticism and letters filed under Amazon's "Literature & Fiction" don't count as fiction (not_fiction_words).
  function bookGroup(cm, R) {
    const data = (cm && cm.data) || {};
    const bin = normBin(cm && cm.cm_number);
    if (bin && R.bin_groups && R.bin_groups[bin]) return { group: R.bin_groups[bin], from: "bin " + cm.cm_number };
    if (data.textbook_istextbook === true) return { group: "textbook", from: "CashMonkey textbook flag" };
    const rc = data.retailcategory || {};
    const subject = (rc.contentcafeinfo && rc.contentcafeinfo.generalsubject) || "";
    const cats = (Array.isArray(data.categories) ? data.categories : []).filter(Boolean);
    const notFiction = (R.not_fiction_words || []).map(lc);
    const matches = (txt, g) => {
      let s = lc(txt);
      if (g === "fiction" && notFiction.some((w) => s.includes(w))) return false;
      const words = ((R.groups || {})[g] || {}).words || [];
      return words.some((w) => s.includes(lc(w)));
    };
    const order = R.group_order || [];
    for (const src of [(cm && (cm.cm_cat || cm.category)), subject]) {
      if (!src) continue;
      for (const g of order) if (matches(src, g)) return { group: g, from: src };
    }
    if (cats.length) {
      const min = Number(R.category_share_min) > 0 ? Number(R.category_share_min) : 0.5;
      let best = null, bestN = 0;
      for (const g of order) {
        const n = cats.filter((c) => matches(c, g)).length;
        if (n > bestN) { best = g; bestN = n; }
      }
      if (best && bestN / cats.length >= min) return { group: best, from: `${bestN} of ${cats.length} Amazon categories` };
    }
    const known = (cm && cm.cm_cat) || subject || cats[0] || null;
    return { group: "nonfiction", from: known, guessed: true };
  }

  // Which stream box a streamed book goes in. CashMonkey's bin decides first ("genre" = look at the book).
  // For "genre" bins and books with no bin: the publisher's subject line (one main genre) is checked first;
  // otherwise every Amazon category gets a vote and the box with the most wins (ties: box order).
  // No category information at all → SCANNER CHOICE.
  function streamBox(cm, R, g) {
    if (g.group === "religious") return { box: "religious", from: g.from };   // all religious → Religious
    const bin = normBin(cm && cm.cm_number);
    const byBin = bin && R.bin_boxes ? R.bin_boxes[bin] : null;
    if (byBin && byBin !== "genre") return { box: byBin, from: "bin " + cm.cm_number };
    const data = (cm && cm.data) || {};
    const rc = data.retailcategory || {};
    const subject = (rc.contentcafeinfo && rc.contentcafeinfo.generalsubject) || "";
    const cats = (Array.isArray(data.categories) ? data.categories : []).filter(Boolean);
    if (g.guessed && !g.from && !cats.length && !subject) return { box: "scanner_choice", from: "no category information from CashMonkey" };
    if (g.group !== "fiction") return { box: "nonfiction", from: g.from };
    const GB = R.genre_boxes || [];
    const hit = (txt, gb) => (gb.words || []).some((w) => lc(txt).includes(lc(w)));
    if (subject) for (const gb of GB) if (hit(subject, gb)) return { box: gb.box, from: "subject: " + subject };
    let best = null, bestN = 0;
    for (const gb of GB) {
      const n = cats.filter((c) => hit(c, gb)).length;
      if (n > bestN) { best = gb.box; bestN = n; }
    }
    if (best) return { box: best, from: `${bestN} of ${cats.length} Amazon categories` };
    return { box: "general_fiction", from: g.from };
  }

  // The banner for one scan. Returns { key (the route saved with the book), label, bg, fg, reason,
  // group, box, top (small line above the label), tag (BE ACCEPT / SBYB), sub (small line under) }.
  function decide(cm, rules) {
    const R = rules && rules.banners ? rules : DEFAULT_RULES;
    const B = R.banners || DEFAULT_RULES.banners;
    const BX = R.boxes || DEFAULT_RULES.boxes;
    const mk = (key, reason, g) => Object.assign({ key, reason, group: g ? g.group : null, group_from: g ? g.from : null }, B[key] || DEFAULT_RULES.banners[key]);
    if (!cm) return null;
    const kind = cmKind(cm);
    if (kind === "miss") return mk("hand_search", "CashMonkey has no data — hand search");
    const g = bookGroup(cm, R);
    const gl = ((R.groups || {})[g.group] || {}).label || (g.group === "nonfiction" ? "Non-fiction" : g.group);
    const min = Number(R.accept_profit_min);
    const p = cm.profit_mf;
    const money = (v) => (v === null || v === undefined ? "no profit shown" : (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2));
    const kindTxt = kind === "accept" ? "accept" : kind === "sbyb" ? "SBYB" : "reject";
    if ((R.back_end_only_groups || []).includes(g.group)) {
      if (kind === "accept") return mk("accept", `${gl} · accept → back end`, g);
      if (kind === "reject") return mk("recycle", `${gl} · reject → recycler`, g);
      return mk(B.sbyb_gaylord ? "sbyb_gaylord" : "sbyb", `${gl} · SBYB → SBYB gaylord`, g);
    }
    if (kind === "accept" && g.group !== "religious" && p !== null && p !== undefined && p > min)
      return mk("accept", `Accept · profit ${money(p)} (over $${min.toFixed(2)})`, g);
    // Everything else streams, into a box.
    const sb = streamBox(cm, R, g);
    const box = BX[sb.box] || BX.general_fiction || { label: "STREAM", bg: "#FFFFFF", fg: "#10261F" };
    const route = g.group === "religious" ? "religious"
      : kind === "accept" ? "tt_then_back" : kind === "sbyb" ? "sbyb"
      : sb.box === "nonfiction" ? "ebay" : "stream";
    const tag = (R.tags || {})[route] || (B[route] && B[route].tag) || null;
    const why = route === "tt_then_back" ? `Accept · profit ${money(p)} ($${min.toFixed(2)} or less)`
      : route === "sbyb" ? "SBYB · stream first"
      : `${(cm.category && String(cm.category).slice(0, 40)) || (sb.box === "scanner_choice" && !g.from ? "No category info from CashMonkey" : g.group === "religious" ? "Religious" : g.group === "fiction" ? "Fiction" : "Non-fiction")} · ${kindTxt}${kind === "reject" ? "" : " · " + money(p)}`;
    return { key: route, box: sb.box, label: box.label, bg: box.bg, fg: box.fg, pattern: box.pattern || null,
      top: "STREAM", tag: route === "religious" ? null : tag, sub: box.note && sb.box === "scanner_choice" ? box.note : null,
      reason: why, group: g.group, group_from: g.from, box_from: sb.from };
  }

  root.RSH_RULES = { DEFAULT_RULES, decide, bookGroup, streamBox, cmKind };
})(typeof self !== "undefined" ? self : globalThis);
