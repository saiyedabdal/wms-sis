"use server";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export async function createUser(input: { email: string; password: string; full_name: string; role: Role; facility_id: number | null }) {
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) return { error: "Only admins can create users" };

  const admin = supabaseAdmin();
  if (!admin) return { error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it in the hosting environment to create logins here." };

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error) return { error: error.message };

  // the signup trigger creates an inactive profile; activate it with the chosen role
  const { error: e2 } = await sb
    .from("profiles")
    .update({ full_name: input.full_name, role: input.role, facility_id: input.facility_id, is_active: true })
    .eq("id", data.user.id);
  if (e2) return { error: e2.message };
  return { ok: true };
}
