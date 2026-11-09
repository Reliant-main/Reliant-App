/* Live show bridge.
   The show screen (Book Spotlight) was built for the old Workspace, where it saved its show, playlist,
   TV and layout data in the page's own storage and read the books from Google Sheets. This file gives it
   the same two connections, backed by the Reliant database instead:
     use("db")  -> the live_docs table (shared by every signed-in show computer and the TV, updates live)
     use("mcp") -> the book list and Show Prep lists from the database. Nothing is ever written to the sheets.
   Everything saved here is rehearsal data: it never touches the real shows and sales tables. */
(() => {
  "use strict";
  const cfg = window.RELIANT_CONFIG;
  const SHOW_ROLES = ["owner", "manager", "operator"];
  const fail = msg => {
    const d = document.createElement("div");
    d.className = "bridgeFail";
    d.innerHTML = `<div><h2>Live show</h2><p></p><p><a href="index.html">Go to the Workspace sign-in</a></p></div>`;
    d.querySelector("p").textContent = msg;
    const put = () => document.body.appendChild(d);
    if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
  };
  if (!window.supabase || !cfg) { fail("The Workspace couldn't load. Check the internet connection and reload."); return; }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  window.RELIANT = { sb, staff: null, rehearsal: true };

  const ready = (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { fail("Sign in on the Workspace home page first, then open the live show again."); throw new Error("signed out"); }
    const { data: me, error } = await sb.rpc("my_staff");
    if (error) { fail("Couldn't check your account: " + error.message); throw error; }
    if (!me || !SHOW_ROLES.includes(me.role)) { fail("Your account doesn't run shows. Ask the owner if it should."); throw new Error("role"); }
    window.RELIANT.staff = me;
    return me;
  })();
  ready.catch(() => {});

  // ---------------------------------------------------------------- document store
  const parentOf = p => p.split("/").slice(0, -1).join("/");
  const lastOf = p => p.split("/").pop();
  const autoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const docs = new Map();          // path -> data (only what this page has read or been sent)
  const docWatch = new Map();      // path -> Set(fn)
  const colWatch = new Map();      // parent -> Set(fn)
  const colLoaded = new Set();     // parents fully loaded
  const snapOf = (path, data) => ({ id: lastOf(path), exists: data != null, data: () => (data == null ? undefined : JSON.parse(JSON.stringify(data))) });
  const colSnap = parent => {
    const out = [];
    for (const [p, d] of docs) if (parentOf(p) === parent && d != null) out.push({ id: lastOf(p), exists: true, data: () => JSON.parse(JSON.stringify(d)) });
    return { docs: out, size: out.length, empty: !out.length };
  };
  const emitDoc = path => { const s = docWatch.get(path); if (s) for (const fn of [...s]) { try { fn(snapOf(path, docs.get(path))); } catch (e) { console.error(e); } } };
  const emitCol = parent => { const s = colWatch.get(parent); if (s) { const snap = colSnap(parent); for (const fn of [...s]) { try { fn(snap); } catch (e) { console.error(e); } } } };
  function local(path, data) {
    const before = docs.has(path) ? JSON.stringify(docs.get(path)) : undefined;
    const after = data == null ? undefined : JSON.stringify(data);
    if (data == null) docs.delete(path); else docs.set(path, data);
    if (before === after) return;
    emitDoc(path); emitCol(parentOf(path));
  }
  const check = ({ error }) => { if (error) throw error; };

  async function loadDoc(path) {
    await ready;
    const { data, error } = await sb.from("live_docs").select("data").eq("path", path).maybeSingle();
    if (error) throw error;
    local(path, data ? data.data : null);
    return docs.get(path);
  }
  async function loadCol(parent) {
    await ready;
    const { data, error } = await sb.from("live_docs").select("path,data").eq("parent", parent).limit(5000);
    if (error) throw error;
    const seen = new Set(data.map(r => r.path));
    for (const p of [...docs.keys()]) if (parentOf(p) === parent && !seen.has(p)) docs.delete(p);
    data.forEach(r => docs.set(r.path, r.data));
    colLoaded.add(parent);
    emitCol(parent); data.forEach(r => emitDoc(r.path));
  }

  // live updates from other computers (and the TV)
  let channel = null, wasUp = false;
  function listen() {
    if (channel) return;
    channel = sb.channel("live_docs_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_docs" }, msg => {
        const row = msg.eventType === "DELETE" ? msg.old : msg.new;
        if (!row || !row.path) return;
        local(row.path, msg.eventType === "DELETE" ? null : row.data);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") {
          if (wasUp) { // back after a drop: catch up on anything missed
            colWatch.forEach((s, parent) => { if (s.size) loadCol(parent).catch(() => {}); });
            docWatch.forEach((s, path) => { if (s.size) loadDoc(path).catch(() => {}); });
          }
          wasUp = true;
        }
      });
  }
  ready.then(listen, () => {});
  // the sign-in token is refreshed in the background; keep the live connection using the current one
  sb.auth.onAuthStateChange((_e, session) => { if (session) try { sb.realtime.setAuth(session.access_token); } catch {} });

  function docRef(path) {
    return {
      id: lastOf(path), path,
      async get() { return snapOf(path, await loadDoc(path)); },
      async set(data) {
        await ready;
        const clean = JSON.parse(JSON.stringify(data));
        local(path, clean);
        check(await sb.from("live_docs").upsert({ path, parent: parentOf(path), data: clean, updated_at: new Date().toISOString() }));
      },
      async update(fields) {
        await ready;
        const clean = JSON.parse(JSON.stringify(fields));
        if (docs.has(path)) local(path, { ...docs.get(path), ...clean });
        const { data, error } = await sb.rpc("live_doc_merge", { p_path: path, p_fields: clean });
        if (error) throw error;
        if (data) local(path, data);
      },
      async delete() {
        await ready;
        local(path, null);
        check(await sb.from("live_docs").delete().eq("path", path));
      },
      onSnapshot(fn, onErr) {
        if (!docWatch.has(path)) docWatch.set(path, new Set());
        docWatch.get(path).add(fn);
        loadDoc(path).catch(e => { if (onErr) onErr(e); });
        return () => { const s = docWatch.get(path); if (s) s.delete(fn); };
      }
    };
  }
  function colRef(parent) {
    return {
      path: parent,
      doc(id) { return docRef(parent + "/" + (id || autoId())); },
      async get() { await loadCol(parent); return colSnap(parent); },
      onSnapshot(fn, onErr) {
        if (!colWatch.has(parent)) colWatch.set(parent, new Set());
        colWatch.get(parent).add(fn);
        loadCol(parent).catch(e => { if (onErr) onErr(e); });
        return () => { const s = colWatch.get(parent); if (s) s.delete(fn); };
      }
    };
  }
  const db = { doc: docRef, collection: colRef };

  // ---------------------------------------------------------------- book list and Show Prep
  const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function bookCsv() {
    await ready;
    const { data, error } = await sb.rpc("show_book_list");
    if (error) throw { code: "tool_error", message: error.message };
    const head = ["Title", "Author", "Genres", "Tropes", "Goodreads", "Spice", "ISBN", "Synopsis", "Series", "Pronunciation"];
    const lines = [head.join(",")];
    for (const b of data) lines.push([b.title, b.author, b.genres, b.tropes, b.goodreads, b.spice, b.isbn, b.description, b.series, b.pron].map(csvCell).join(","));
    return lines.join("\n");
  }
  // Each Show Prep list becomes two columns, like the old Show Prep tab: the show's books, then its
  // "2nd book" column (the second book of a two-book lot sits on the same row). A divider row such as
  // "— Set 2 —" starts a new set.
  let prepOrder = [];   // column i of the old Show Prep tab -> prep document path (both columns of a list)
  async function prepValues() {
    await loadCol("prep");
    const lists = [];
    for (const [p, d] of docs) if (parentOf(p) === "prep" && d) lists.push({ p, d });
    lists.sort((a, b) => (a.d.createdAt || 0) - (b.d.createdAt || 0));
    prepOrder = lists.flatMap(x => [x.p, x.p]);
    const height = Math.max(0, ...lists.map(x => (x.d.isbns || []).length));
    const rows = [lists.flatMap(x => { const n = x.d.name || "Show"; return [n, n + " - 2nd book"]; })];
    for (let r = 0; r < height; r++) rows.push(lists.flatMap(x => [(x.d.isbns || [])[r] || "", (x.d.pairs || [])[r] || ""]));
    return lists.length ? rows : [];
  }
  const colIndex = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rangeTab = r => { const m = /^'([^']+)'!/.exec(String(r || "")); return m ? m[1] : ""; };
  const notSent = () => Promise.reject({ code: "rehearsal", message: "Rehearsal: nothing is written to the sheets." });
  const mcp = {
    async callTool(server, tool, input) {
      if (tool === "download_file_content") { const csv = await bookCsv(); return { payload: { content: csv }, cache: { storedAt: Date.now() } }; }
      if (tool === "get_values") {
        const tab = rangeTab(input && input.range);
        if (tab === "Show Prep") return { payload: { values: await prepValues() } };
        if (tab === "Sources") {   // used-book sources and their cost per book, like the Used Books workbook's Sources tab
          await ready;
          const { data, error } = await sb.from("used_sources").select("code,cost_per_book,active").eq("active", true).order("code");
          if (error) throw { code: "tool_error", message: error.message };
          return { payload: { values: data.filter(r => r.cost_per_book != null).map(r => [r.code, String(r.cost_per_book)]) } };
        }
        if (tab === "Inventory") {   // books on hand, in the Inventory tab's column order (ISBN, Title, Author, -, On hand)
          await ready;
          const { data, error } = await sb.from("stock_on_hand").select("isbn,title,author,on_hand").gt("on_hand", 0).order("title").limit(5000);
          if (error) throw { code: "tool_error", message: error.message };
          return { payload: { values: data.map(r => [r.isbn, r.title || "", r.author || "", "", String(r.on_hand)]) } };
        }
        return { payload: { values: [] } };   // naming, costs, used sources: nothing needed for a rehearsal
      }
      if (tool === "update_values" && rangeTab(input && input.range) === "Show Prep") {
        // "clear these ISBNs after loading": empty that Show Prep list (its name stays)
        const m = /!([A-Z]+)\d/.exec(input.range), col = m ? colIndex(m[1]) : -1, path = prepOrder[col];
        if (path) await docRef(path).update({ isbns: [], pairs: [], updatedAt: Date.now() });
        return { payload: {} };
      }
      return notSent();
    },
    watchTool(server, tool, input, cb, opts) {
      let stop = false;
      const run = () => mcp.callTool(server, tool, input).then(result => { if (!stop) cb({ type: "data", result }); }, error => { if (!stop) cb({ type: "error", error }); });
      run();
      const t = setInterval(() => { if (!document.hidden) run(); }, (opts && opts.refetchInterval) || 60000);
      return () => { stop = true; clearInterval(t); };
    }
  };

  window.claude = {
    use(name) {
      if (name === "db") return ready.then(() => db);
      if (name === "mcp") return ready.then(() => mcp);
      return Promise.resolve(null);   // "room": the TV clicker falls back to the shared store
    }
  };
})();
