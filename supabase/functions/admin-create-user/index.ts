// Creates a WMS login. Only callable by an active admin; the service-role key never leaves Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "ops", "facility_staff"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin, error: authErr } = await caller.rpc("is_admin");
  if (authErr || !isAdmin) return json({ error: "Only admins can create users" }, 403);

  let body: { email?: string; password?: string; full_name?: string; role?: string; facility_id?: number | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = body.full_name?.trim() || null;
  const role = body.role ?? "facility_staff";
  if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
  if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) return json({ error: error.message }, 400);

  // the signup trigger created an inactive profile; activate it with the chosen role
  const { error: e2 } = await admin
    .from("profiles")
    .update({ full_name: fullName, role, facility_id: role === "facility_staff" ? body.facility_id ?? null : null, is_active: true })
    .eq("id", data.user.id);
  if (e2) return json({ error: e2.message }, 400);

  return json({ ok: true, id: data.user.id });
});
