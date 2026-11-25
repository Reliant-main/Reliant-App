// Accounts for people without an email address (Operator or Scanner only).
// They sign in with a username such as "Brooklyn.Smith" and a password an owner or manager sets.
// Behind the scenes the username becomes a sign-in address that receives no mail: brooklyn.smith@staff.reliantbookstore.com
//   create: {action:"create", name, username, password, role, pin?, must_change?}
//   reset:  {action:"reset", staff_id, password, must_change?}
import { createClient } from "jsr:@supabase/supabase-js@2";

const DOMAIN = "staff.reliantbookstore.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: isMgr } = await asCaller.rpc("is_manager");
  if (isMgr !== true) return json({ error: "Only an owner or manager can do this." }, 403);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const password = String(b.password || "");
  if (password.length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  const mustChange = b.must_change !== false;

  if (b.action === "create") {
    const name = String(b.name || "").trim(), role = String(b.role || "");
    const username = String(b.username || "").trim().toLowerCase();
    const pin = String(b.pin || "").trim();
    if (!name) return json({ error: "Type their name." }, 400);
    if (!/^[a-z0-9]+([.\-_][a-z0-9]+)*$/.test(username) || username.length > 40) return json({ error: "A username is letters and numbers, with a dot between first and last name (for example Brooklyn.Smith)." }, 400);
    if (!["operator", "scanner"].includes(role)) return json({ error: "Accounts without an email can be Operator or Scanner only." }, 400);
    if (pin && !/^\d{4,6}$/.test(pin)) return json({ error: "A PIN is 4 to 6 digits." }, 400);
    const email = `${username}@${DOMAIN}`;
    const { data: all } = await admin.from("staff").select("email, display_name");
    if ((all || []).some(x => (x.email || "").toLowerCase() === email)) return json({ error: "That username is already taken." }, 409);
    if ((all || []).some(x => (x.display_name || "").toLowerCase() === name.toLowerCase())) return json({ error: "Someone already has that name. Add a last initial or similar." }, 409);
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, must_change: mustChange } });
    if (ue || !u?.user) return json({ error: /already/i.test(ue?.message || "") ? "That username is already taken." : (ue?.message || "Couldn't create the account.") }, 400);
    const { data: s, error: se } = await admin.from("staff").insert({ display_name: name, email, role, active: true, user_id: u.user.id }).select("id").single();
    if (se) { await admin.auth.admin.deleteUser(u.user.id); return json({ error: se.message }, 400); }
    if (pin) { const { error: pe } = await asCaller.rpc("set_staff_pin", { p_staff: s.id, p_pin: pin }); if (pe) return json({ ok: true, id: s.id, warning: "Account made, but the PIN wasn't saved: " + pe.message }); }
    return json({ ok: true, id: s.id, username });
  }

  if (b.action === "reset") {
    const { data: s } = await admin.from("staff").select("id, user_id, email, role").eq("id", String(b.staff_id || "")).maybeSingle();
    if (!s?.user_id || !String(s.email || "").endsWith("@" + DOMAIN)) return json({ error: "Only accounts without an email are reset here. Others use Forgot password on the sign-in screen." }, 400);
    const { data: cur } = await admin.auth.admin.getUserById(s.user_id);
    const { error } = await admin.auth.admin.updateUserById(s.user_id, { password, user_metadata: { ...(cur?.user?.user_metadata || {}), must_change: mustChange } });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
