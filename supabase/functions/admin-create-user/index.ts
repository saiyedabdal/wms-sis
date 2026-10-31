// Admin user management for the Partner Hub. Only callable by an active admin; the service-role key never
// leaves Supabase. Supabase's built-in mailer only reaches org members, so logins come with a one-time
// set-password link (or temporary password) for the admin to share; approvals are also emailed when set up.
//   { action: "create", email, full_name, role, facility_id, redirect_to }  -> new login + link
//   { action: "link", user_id, redirect_to }                                -> fresh link for an existing login
//   { action: "approve_application", application_id, code, name, fulfiller_ss_id, margin_pct, is_consignment,
//     note, login_url }  -> facility + login with a temporary password, emailed to the applicant when a mail
//     provider is set up (RESEND_API_KEY + MAIL_FROM secrets); the message is always returned for copying too
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "manager", "ops", "field_sales", "facility_staff"];

// readable but random: no 0/O or 1/l/I to mistype
function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "Frido@" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function sendMail(to: string, subject: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { sent: false, reason: "Email isn't set up yet, so nothing was sent. Share the message below yourself." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("MAIL_FROM") ?? "Frido Partner Hub <onboarding@resend.dev>", to: [to], subject, text }),
  });
  if (res.ok) return { sent: true };
  return { sent: false, reason: `The email could not be sent (${res.status}: ${(await res.text()).slice(0, 200)}). Share the message below yourself.` };
}

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
    application_id?: number;
    code?: string;
    name?: string;
    fulfiller_ss_id?: number | null;
    margin_pct?: number;
    is_consignment?: boolean;
    note?: string;
    login_url?: string;
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
      // a sign-in link is a way into that account, so only a super admin gets one for a super admin
      const { data: target } = await admin.from("profiles").select("role").eq("id", body.user_id).single();
      if (target?.role === "super_admin") {
        const { data: isSuper } = await caller.rpc("is_super_admin");
        if (!isSuper) return json({ error: "Only a super admin can get a link for a super admin" }, 403);
      }
      const { data, error } = await admin.auth.admin.getUserById(body.user_id);
      if (error || !data.user?.email) return json({ error: error?.message ?? "User not found" }, 404);
      return json({ ok: true, link: await signInLink(data.user.email) });
    }

    if (body.action === "approve_application") {
      const { data: app } = await admin.from("vendor_applications").select("*").eq("id", body.application_id).single();
      if (!app) return json({ error: "Application not found" }, 404);
      if (app.status !== "pending") return json({ error: `This application is already ${app.status}` }, 400);
      const email = String(app.poc_email).toLowerCase();
      const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (existing) return json({ error: `${email} already has a login. Remove this application or ask them to use another email.` }, 400);

      // login first (its profile starts inactive), then the facility; undo the login if the facility fails
      const password = tempPassword();
      const { data: created, error: e1 } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: app.poc_name },
      });
      if (e1) return json({ error: e1.message }, 400);
      const { data: facilityId, error: e2 } = await caller.rpc("approve_vendor_application", {
        p_id: app.id,
        p_code: body.code ?? "",
        p_name: body.name ?? app.business_name,
        p_fulfiller_ss_id: body.fulfiller_ss_id ?? null,
        p_margin_pct: body.margin_pct ?? 0,
        p_is_consignment: body.is_consignment ?? false,
        p_note: body.note ?? null,
      });
      if (e2) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: e2.message }, 400);
      }
      await admin
        .from("profiles")
        .update({ full_name: app.poc_name, role: "facility_staff", facility_id: facilityId, is_active: true, must_change_password: true })
        .eq("id", created.user.id);

      const kind = app.applying_as === "super_stockist" ? "super stockist" : "retailer";
      const subject = "Your Frido Partner Hub request has been approved";
      const message = `Hi ${app.poc_name},

Your request to join Frido Partner Hub as a ${kind} (${body.name || app.business_name}) has been approved.

Sign in for the first time here: ${body.login_url ?? ""}
Email: ${email}
Temporary password: ${password}

You'll be asked to choose your own password when you first sign in.

Team Frido`;
      const mail = await sendMail(email, subject, message);
      await admin
        .from("vendor_applications")
        .update({ user_id: created.user.id, email_sent_at: mail.sent ? new Date().toISOString() : null })
        .eq("id", app.id);
      return json({ ok: true, facility_id: facilityId, email, email_sent: mail.sent, email_note: mail.reason ?? null, subject, message });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
