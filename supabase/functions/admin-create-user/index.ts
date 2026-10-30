// Admin user management for the Partner Hub. Only callable by an active admin; the service-role key never
// leaves Supabase. Supabase's built-in mailer only reaches org members, so instead of emailing, every action
// returns a one-time set-password link for the admin to share (WhatsApp / Slack).
//   { action: "create", email, full_name, role, facility_id, redirect_to }  -> new login + link
//   { action: "link", user_id, redirect_to }                                -> fresh link for an existing login
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "manager", "ops", "facility_staff"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin, error: authErr } = await caller.rpc("is_admin");
  if (authErr || !isAdmin) return json({ error: "Only admins can manage users" }, 403);

  let body: {
    action?: string;
    email?: string;
    password?: string;
    full_name?: string;
    role?: string;
    facility_id?: number | null;
    user_id?: string;
    redirect_to?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const redirectTo = body.redirect_to || undefined;

  const signInLink = async (email: string) => {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    if (error) throw error;
    return data.properties.action_link;
  };

  try {
    if ((body.action ?? "create") === "create") {
      const email = body.email?.trim().toLowerCase();
      const fullName = body.full_name?.trim() || null;
      const role = body.role ?? "facility_staff";
      if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400);
      if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
      // without a password the person sets their own through the link
      const password = body.password && body.password.length >= 8 ? body.password : crypto.randomUUID() + "Aa1!";

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
        .update({
          full_name: fullName,
          role,
          facility_id: role === "facility_staff" ? body.facility_id ?? null : null,
          is_active: true,
        })
        .eq("id", data.user.id);
      if (e2) return json({ error: e2.message }, 400);

      return json({ ok: true, id: data.user.id, link: await signInLink(email) });
    }

    if (body.action === "link") {
      if (!body.user_id) return json({ error: "user_id is required" }, 400);
      const { data, error } = await admin.auth.admin.getUserById(body.user_id);
      if (error || !data.user?.email) return json({ error: error?.message ?? "User not found" }, 404);
      return json({ ok: true, link: await signInLink(data.user.email) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
