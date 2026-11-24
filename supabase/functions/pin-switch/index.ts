// PIN switch for shared devices.
// A person already signed in on the device picks a name and types that person's PIN.
// If the PIN is right, this returns a one-time sign-in token for that person, and the page
// swaps its session to them. Five wrong PINs for a person lock switching to them for 15 minutes.
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401);

  let body: { staff_id?: string; pin?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const staffId = String(body.staff_id || ""), pin = String(body.pin || "");
  if (!/^[0-9a-f-]{36}$/i.test(staffId) || !/^\d{4,6}$/.test(pin)) return json({ error: "Pick a person and enter their 4–6 digit PIN." }, 400);

  // the caller must be signed in as an active staff member
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return json({ error: "Sign in first." }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: caller } = await admin.from("staff").select("id").eq("user_id", who.user.id).eq("active", true).maybeSingle();
  if (!caller) return json({ error: "Only staff can switch people." }, 403);

  // lockout: 5 wrong PINs for this person in 15 minutes
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const { count } = await admin.from("pin_attempts").select("id", { count: "exact", head: true }).eq("staff_id", staffId).eq("ok", false).gte("at", since);
  if ((count ?? 0) >= 5) return json({ error: "Too many wrong PINs for this person. Try again in 15 minutes, or sign in with email and password." }, 429);

  const { data: ok, error: pinErr } = await asCaller.rpc("check_pin", { p_staff: staffId, p_pin: pin });
  await admin.from("pin_attempts").insert({ staff_id: staffId, ok: ok === true, by_user: who.user.id });
  if (pinErr) return json({ error: "Couldn't check the PIN." }, 500);
  if (ok !== true) return json({ error: "That PIN isn't right." }, 403);

  const { data: target } = await admin.from("staff").select("user_id, display_name, active").eq("id", staffId).maybeSingle();
  if (!target?.active || !target.user_id) return json({ error: "That person can't be switched to." }, 403);
  const { data: u } = await admin.auth.admin.getUserById(target.user_id);
  const email = u?.user?.email;
  if (!email) return json({ error: "That person has no sign-in email." }, 400);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.properties?.hashed_token) return json({ error: "Couldn't switch right now." }, 500);
  return json({ token_hash: link.properties.hashed_token, name: target.display_name });
});
