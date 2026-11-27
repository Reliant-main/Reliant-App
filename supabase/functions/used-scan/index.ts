// CashMonkey Scan Helper intake: the browser extension at each back-end scanning station
// saves stream books (front-end used copies) and back-end ACCEPT books (accept_copies, a separate
// inventory), and records books staff marked DO NOT ADD. Every request carries the station's connection code;
// only its SHA-256 is stored.
// Every scanned book CashMonkey shows a result for is also written to scan_log (ISBN, title, author,
// CashMonkey projected profit/loss), added to inventory or not. That step can never block a scan.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-station-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const clip = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n));

// ISBN-13 (978/979) with a valid check digit, or an ISBN-10 turned into its ISBN-13.
function isbn13(raw: string): string | null {
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
function todayStartUTC() {   // midnight in the warehouse's time zone
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset).toISOString();
}
async function counts(stationId: number, sessionId: number | null) {
  const since = todayStartUTC();
  const { data: ss } = await db.from("scan_sessions").select("id, scanned_count").eq("station_id", stationId).gte("started_at", since);
  const ids = (ss ?? []).map((r) => r.id);
  let sentToday = 0, sentShift = 0, accToday = 0, accShift = 0;
  if (ids.length) {
    const { count } = await db.from("used_copies").select("id", { count: "exact", head: true }).in("session_id", ids);
    sentToday = count ?? 0;
    const { count: ac } = await db.from("accept_copies").select("id", { count: "exact", head: true }).in("session_id", ids);
    accToday = ac ?? 0;
  }
  if (sessionId) {
    const { count } = await db.from("used_copies").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
    sentShift = count ?? 0;
    const { count: ac } = await db.from("accept_copies").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
    accShift = ac ?? 0;
  }
  const scannedToday = (ss ?? []).reduce((a, r) => a + (r.scanned_count || 0), 0);
  const scannedShift = (ss ?? []).find((r) => r.id === sessionId)?.scanned_count ?? 0;
  const { data: nt } = await db.rpc("next_open_tote");
  const t = Array.isArray(nt) ? nt[0] : nt;
  const filling = t ? { label: t.label, books_in: Number(t.books_in), capacity: t.capacity } : null;
  return { today: { scanned: scannedToday, sent: sentToday, accepts: accToday }, shift: { scanned: scannedShift, sent: sentShift, accepts: accShift }, filling };
}
async function scanRules() {
  const { data } = await db.from("app_settings").select("value").eq("key", "scan_rules").maybeSingle();
  try { return data?.value ? JSON.parse(data.value) : null; } catch { return null; }
}
const ROUTES = new Set(["accept", "tt_then_back", "sbyb", "sbyb_gaylord", "stream", "ebay", "religious", "recycle", "hand_search"]);
async function ownSession(stationId: number, id: unknown) {
  const { data } = await db.from("scan_sessions").select("id, load_id, staff_name, ended_at, station_id").eq("id", Number(id)).maybeSingle();
  return data && data.station_id === stationId ? data : null;
}
const toNum = (v: unknown) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));

// One row per scanned book in scan_log. Same book on the same station within 15 seconds is one scan
// (CashMonkey re-showing it). Errors are swallowed: this must never stop a scan from being saved.
async function logScan(stationId: number, isbn: string, cm: any) {
  try {
    const since = new Date(Date.now() - 15_000).toISOString();
    const { data: dup } = await db.from("scan_log").select("id").eq("station_id", stationId).eq("isbn", isbn).gte("scanned_at", since).limit(1);
    if (dup && dup.length) return;
    const { data: ss } = await db.from("scan_sessions").select("id, staff_name, load_id").eq("station_id", stationId).is("ended_at", null).order("started_at", { ascending: false }).limit(1);
    const s = ss && ss[0];
    await db.from("scan_log").insert({
      station_id: stationId, session_id: s ? s.id : null, staff_name: s ? s.staff_name : null, load_id: s ? s.load_id : null,
      isbn, title: clip(cm.title, 500), author: clip(cm.author, 300), cm_result: clip(cm.result, 60),
      cm_profit_merchant: toNum(cm.profit_mf), cm_profit_fba: toNum(cm.profit_fba),
    });
  } catch (_) { /* never block a scan */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  const code = req.headers.get("x-station-code") ?? "";
  if (!/^rss_[0-9a-f]{36}$/.test(code)) return json({ error: "This computer isn't connected. Paste its station code." }, 401);
  const { data: st } = await db.from("scan_stations").select("id, label, revoked_at, last_used_at").eq("code_hash", await sha256(code)).maybeSingle();
  if (!st || st.revoked_at) return json({ error: "That station code isn't valid anymore. Ask a manager for a new one." }, 401);
  if (!st.last_used_at || Date.now() - Date.parse(st.last_used_at) > 60_000) {
    await db.from("scan_stations").update({ last_used_at: new Date().toISOString() }).eq("id", st.id);
  }
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad body" }, 400); }

  if (b?.type === "hello") {
    const { data: srcs } = await db.from("used_sources").select("code, name").eq("active", true).is("consignor_share", null);
    const codes = (srcs ?? []).map((s) => s.code);
    const { data: loads } = await db.from("loads").select("id, name, source_code, received_on, created_at").in("source_code", codes.length ? codes : ["-"]).order("created_at", { ascending: false });
    const names = Object.fromEntries((srcs ?? []).map((s) => [s.code, s.name]));
    return json({ ok: true, station: st.label, rules: await scanRules(), loads: (loads ?? []).map((l) => ({ id: l.id, name: l.name, source: l.source_code, source_name: names[l.source_code] })) });
  }

  if (b?.type === "start") {
    const staff = clip(b.staff, 60);
    const loadId = Number(b.load_id);
    if (!staff) return json({ error: "Type who's scanning." }, 400);
    const { data: load } = await db.from("loads").select("id, name, source_code").eq("id", loadId).maybeSingle();
    if (!load) return json({ error: "Pick a load." }, 400);
    await db.from("scan_sessions").update({ ended_at: new Date().toISOString() }).eq("station_id", st.id).is("ended_at", null);
    const { data, error } = await db.from("scan_sessions").insert({ staff_name: staff, load_id: load.id, station_id: st.id }).select("id, started_at").single();
    if (error) return json({ error: "Couldn't start the shift: " + error.message }, 500);
    return json({ ok: true, session_id: data.id, started_at: data.started_at, load, ...(await counts(st.id, data.id)) });
  }

  if (b?.type === "send") {
    const s = await ownSession(st.id, b.session_id);
    if (!s) return json({ error: "This shift wasn't found. Start the shift again." }, 400);
    if (s.ended_at && Date.now() - Date.parse(s.ended_at) > 12 * 3600_000) return json({ error: "That shift ended. Start a new one." }, 400);
    const isbn = isbn13(b.isbn);
    if (!isbn) return json({ error: "Not a valid ISBN — not saved." }, 400);
    const ref = clip(b.ref, 80);
    if (ref) {
      const { data: had } = await db.from("used_copies").select("id, containers(label)").eq("client_ref", ref).maybeSingle();
      if (had) return json({ ok: true, id: had.id, isbn, repeat: true, tote: had.containers ? { ok: true, label: (had.containers as any).label } : null, ...(await counts(st.id, s.id)) });
    }
    const cm = b.cm && typeof b.cm === "object" ? b.cm : null;
    const num = (v: unknown) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
    const at = b.at && !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : undefined;
    if (b.pool === "accept") {
      // a back-end ACCEPT: its own inventory, never matched to live-show sales
      if (ref) {
        const { data: had } = await db.from("accept_copies").select("id").eq("client_ref", ref).maybeSingle();
        if (had) return json({ ok: true, id: had.id, isbn, pool: "accept", repeat: true, ...(await counts(st.id, s.id)) });
      }
      const { data: sc } = await db.from("used_scans").insert({
        session_id: s.id, station_id: st.id, scan_code: isbn, isbn, scanned_at: at, cm_snapshot: cm,
        cm_decision: cm ? clip(cm.result, 60) : null, final_route: "back", client_ref: ref,
        suggested_route: cm && ROUTES.has(String(cm.route_key)) ? cm.route_key : null, rule_reason: cm ? clip(cm.route_reason, 300) : null,
      }).select("id").single();
      const { data: ac, error: aerr } = await db.from("accept_copies").insert({
        isbn, load_id: s.load_id, session_id: s.id, station_id: st.id, scanned_by: s.staff_name, scanned_at: at, client_ref: ref,
        scan_id: sc?.id ?? null, station_route: cm && ROUTES.has(String(cm.route_key)) ? cm.route_key : null, book_group: cm ? clip(cm.group, 40) : null,
        cm_result: cm ? clip(cm.result, 60) : null, cm_profit_merchant: cm ? num(cm.profit_mf) : null, cm_profit_fba: cm ? num(cm.profit_fba) : null,
        cm_target_merchant: cm ? num(cm.target_mf) : null, cm_bin: cm ? clip(cm.cm_number, 20) : null, notes: "CashMonkey Scan Helper",
      }).select("id").single();
      if (aerr) return json({ error: "Couldn't save: " + aerr.message }, 500);
      if (sc?.id) await db.from("used_scans").update({ accept_copy_id: ac.id }).eq("id", sc.id);
      return json({ ok: true, id: ac.id, isbn, pool: "accept", ...(await counts(st.id, s.id)) });
    }
    const { data: book } = await db.from("books").select("isbn, title").eq("isbn", isbn).maybeSingle();
    let scanId: number | null = null;
    if (cm) {
      const { data: sc } = await db.from("used_scans").insert({
        session_id: s.id, station_id: st.id, scan_code: isbn, isbn, scanned_at: at, cm_snapshot: cm,
        cm_decision: clip(cm.result, 60), final_route: "front", client_ref: ref,
        suggested_route: ROUTES.has(String(cm.route_key)) ? cm.route_key : null, rule_reason: clip(cm.route_reason, 300),
      }).select("id").single();
      scanId = sc?.id ?? null;
    }
    const { data, error } = await db.from("used_copies").insert({
      scan_code: isbn, isbn: book ? isbn : null, load_id: s.load_id, session_id: s.id, scanned_by: s.staff_name,
      status: "in stock", client_ref: ref, notes: "CashMonkey Scan Helper" + (b.bin ? " · bin " + clip(b.bin, 20) : ""),
      scanned_at: at, scan_id: scanId,
      station_route: cm && ROUTES.has(String(cm.route_key)) ? cm.route_key : null,
      station_box: cm && /^[a-z_]{2,40}$/.test(String(cm.box || "")) ? String(cm.box) : null,
      cm_result: cm ? clip(cm.result, 60) : null, cm_profit_merchant: cm ? num(cm.profit_mf) : null, cm_profit_fba: cm ? num(cm.profit_fba) : null,
    }).select("id").single();
    if (error) return json({ error: "Couldn't save: " + error.message }, 500);
    if (scanId) await db.from("used_scans").update({ used_copy_id: data.id }).eq("id", scanId);
    const { data: tote } = await db.rpc("assign_used_copy_tote", { p_copy: data.id });
    const { count: same } = await db.from("used_copies").select("id", { count: "exact", head: true }).eq("session_id", s.id).eq("scan_code", isbn);
    return json({ ok: true, id: data.id, isbn, title: book?.title ?? null, copies_this_shift: same ?? 1, tote: tote ?? null, ...(await counts(st.id, s.id)) });
  }

  if (b?.type === "undo" && b.pool === "accept") {
    const { data: cp } = await db.from("accept_copies").select("id, status, session_id, scanned_at").eq("id", Number(b.id)).maybeSingle();
    const s = cp && await ownSession(st.id, cp.session_id);
    if (!cp || !s) return json({ error: "That book wasn't found on this station." }, 400);
    if (cp.status !== "in stock") return json({ error: "That copy has already been sold or removed — a manager can fix it in the App." }, 400);
    if (Date.now() - Date.parse(cp.scanned_at) > 24 * 3600_000) return json({ error: "Too old to undo here — a manager can remove it in the App." }, 400);
    const reason = clip(b.reason, 40);
    await db.from("used_scans").update(reason ? { final_route: "not_added", not_added_reason: reason, accept_copy_id: null } : { final_route: null, accept_copy_id: null }).eq("accept_copy_id", cp.id);
    const { error } = await db.from("accept_copies").delete().eq("id", cp.id);
    if (error) return json({ error: "Couldn't undo: " + error.message }, 500);
    return json({ ok: true, ...(await counts(st.id, s.id)) });
  }

  if (b?.type === "undo") {
    const { data: cp } = await db.from("used_copies").select("id, status, session_id, scanned_at").eq("id", Number(b.id)).maybeSingle();
    const s = cp && await ownSession(st.id, cp.session_id);
    if (!cp || !s) return json({ error: "That book wasn't found on this station." }, 400);
    if (cp.status !== "in stock") return json({ error: "That copy has already been sold or used — a manager can fix it in the App." }, 400);
    if (Date.now() - Date.parse(cp.scanned_at) > 24 * 3600_000) return json({ error: "Too old to undo here — a manager can remove it in the App." }, 400);
    const reason = clip(b.reason, 40);
    await db.from("used_scans").update(reason ? { final_route: "not_added", not_added_reason: reason, used_copy_id: null } : { final_route: null, used_copy_id: null }).eq("used_copy_id", cp.id);
    const { error } = await db.from("used_copies").delete().eq("id", cp.id);
    if (error) return json({ error: "Couldn't undo: " + error.message }, 500);
    return json({ ok: true, ...(await counts(st.id, s.id)) });
  }

  if (b?.type === "notadded") {
    // staff pressed DO NOT ADD before the book was saved: keep a record of the scan and why
    const s = await ownSession(st.id, b.session_id);
    const isbn = isbn13(b.isbn);
    if (!s || !isbn) return json({ ok: true });
    const cm = b.cm && typeof b.cm === "object" ? b.cm : null;
    await db.from("used_scans").insert({
      session_id: s.id, station_id: st.id, scan_code: isbn, isbn, cm_snapshot: cm, cm_decision: cm ? clip(cm.result, 60) : null,
      final_route: "not_added", not_added_reason: clip(b.reason, 40) ?? "condition", client_ref: clip(b.ref, 80),
      suggested_route: cm && ROUTES.has(String(cm.route_key)) ? cm.route_key : null, rule_reason: cm ? clip(cm.route_reason, 300) : null,
    });
    return json({ ok: true });
  }

  if (b?.type === "capture") {
    // What CashMonkey showed for a scan: log the scan, keep the title details; keep a full copy of the page for a few scans.
    const cm = b.cm && typeof b.cm === "object" ? b.cm : {};
    const isbn = isbn13(b.isbn);
    if (isbn && Object.keys(cm).length) await logScan(st.id, isbn, cm);
    if (isbn && cm.title) {
      await db.rpc("used_title_seen", { p: {
        isbn, title: clip(cm.title, 500), author: clip(cm.author, 300), publisher: clip(cm.publisher, 200),
        published: clip(cm.published, 20), binding: clip(cm.binding, 60), edition: clip(cm.edition, 100),
        pagecount: cm.pagecount && Number.isFinite(Number(cm.pagecount)) ? String(Math.round(Number(cm.pagecount))) : "",
        category: clip(cm.category, 200),
        data: { ...(cm.data && typeof cm.data === "object" ? cm.data : {}), cm_bin: clip(cm.cm_number, 20), cm_bin_name: clip(cm.cm_cat, 120) },
      } });
    }
    if (b.sample && typeof b.sample === "object") {
      await db.from("scan_page_samples").insert({ station_id: st.id, isbn: isbn ?? clip(b.isbn, 40),
        page_text: clip(b.sample.page, 20000), debug_text: clip(b.sample.debug, 400000) });
      const { data: keep } = await db.from("scan_page_samples").select("id").order("id", { ascending: false }).range(59, 59);
      if (keep && keep.length) await db.from("scan_page_samples").delete().lt("id", keep[0].id);
    }
    return json({ ok: true });
  }

  if (b?.type === "count") {
    const s = await ownSession(st.id, b.session_id);
    if (!s) return json({ error: "shift not found" }, 400);
    const n = Math.max(0, Math.min(100000, Math.floor(Number(b.scanned) || 0)));
    await db.from("scan_sessions").update({ scanned_count: n }).eq("id", s.id).lt("scanned_count", n);
    return json({ ok: true, ...(await counts(st.id, s.id)) });
  }

  if (b?.type === "end") {
    const s = await ownSession(st.id, b.session_id);
    if (s && !s.ended_at) await db.from("scan_sessions").update({ ended_at: new Date().toISOString() }).eq("id", s.id);
    return json({ ok: true, ...(await counts(st.id, null)) });
  }

  if (b?.type === "rules") return json({ ok: true, rules: await scanRules() });

  if (b?.type === "counts") return json({ ok: true, ...(await counts(st.id, b.session_id ? Number(b.session_id) : null)) });

  return json({ error: "unknown request" }, 400);
});
