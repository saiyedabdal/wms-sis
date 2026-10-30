"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Facility, Profile } from "@/lib/types";

type State = { kind: "loading" } | { kind: "inactive" } | { kind: "ready"; profile: Profile; facilities: Facility[] };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // sign-in links that fell back to the site root still carry their recovery token: finish them properly
    if (/type=(recovery|invite)/.test(window.location.hash)) {
      window.location.replace("/reset-password/" + window.location.hash);
      return;
    }
    const sb = supabaseBrowser();
    (async () => {
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!session) return router.replace("/login/");
      const [{ data: profile }, { data: facilities }] = await Promise.all([
        sb.from("profiles").select("*").eq("id", session.user.id).single(),
        sb.from("facilities").select("*").order("name"),
      ]);
      if (!profile || !profile.is_active) return setState({ kind: "inactive" });
      setState({ kind: "ready", profile: profile as Profile, facilities: (facilities ?? []) as Facility[] });
    })();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login/");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-2xl font-bold lowercase tracking-tight text-n600">frido</span>
      </div>
    );
  }
  if (state.kind === "inactive") {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-lg border border-n300 bg-white p-8 text-center">
        <p className="text-lg font-semibold">Account not active</p>
        <p className="mt-2 text-sm text-n800">Ask a Frido WMS admin to activate your login.</p>
        <button className="mt-6 text-sm text-blue hover:underline" onClick={() => supabaseBrowser().auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }
  const reloadFacilities = async () => {
    const { data } = await supabaseBrowser().from("facilities").select("*").order("name");
    setState((st) => (st.kind === "ready" ? { ...st, facilities: (data ?? []) as Facility[] } : st));
  };

  return (
    <AppShell profile={state.profile} facilities={state.facilities} reloadFacilities={reloadFacilities}>
      {/* record pages read ?id= via useSearchParams, which needs a Suspense boundary in a static export */}
      <Suspense>{children}</Suspense>
    </AppShell>
  );
}
