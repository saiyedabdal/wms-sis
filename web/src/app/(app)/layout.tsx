import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { supabaseServer } from "@/lib/supabase/server";
import type { Facility, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: facilities }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("facilities").select("*").order("name"),
  ]);

  if (!profile || !profile.is_active) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-lg border border-n300 bg-white p-8 text-center">
        <p className="text-lg font-semibold">Account not active</p>
        <p className="mt-2 text-sm text-n800">Ask a Frido WMS admin to activate your login.</p>
      </div>
    );
  }

  return (
    <AppShell profile={profile as Profile} facilities={(facilities ?? []) as Facility[]}>
      {children}
    </AppShell>
  );
}
