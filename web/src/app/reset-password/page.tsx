"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Landing page for the one-time sign-in links admins share: the person chooses their password here. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"wait" | "ok" | "invalid">("wait");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    // the link signs the person in via the URL fragment; supabase-js picks it up on load
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) {
        setEmail(session.user.email ?? "");
        setReady("ok");
      }
    });
    const hashError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
    sb.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail(data.session.user.email ?? "");
        setReady("ok");
      } else if (hashError) {
        setErr(hashError);
        setReady("invalid");
      } else {
        setTimeout(() => setReady((r) => (r === "wait" ? "invalid" : r)), 2500);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setErr("Passwords don't match");
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    router.replace("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <span className="mb-2 block text-3xl font-bold lowercase tracking-tight">frido</span>
        <span className="rounded-xs bg-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Partner Hub</span>
        <h1 className="mt-8 text-[28px] font-semibold tracking-tight">Set your password</h1>
        {ready === "wait" && <p className="mt-2 text-sm text-n800">Checking your link…</p>}
        {ready === "invalid" && (
          <div className="mt-6 flex flex-col gap-4">
            <Alert>{err ?? "This link is invalid or has expired."} Ask your admin for a new sign-in link.</Alert>
            <Button variant="secondary" onClick={() => router.replace("/login/")}>
              Go to sign in
            </Button>
          </div>
        )}
        {ready === "ok" && (
          <form onSubmit={save} className="mt-6 flex flex-col gap-5">
            <p className="text-sm text-n800">
              Signing in as <span className="font-medium text-ink">{email}</span>
            </p>
            <Field label="New password">
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" />
            </Field>
            <Field label="Repeat password">
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required autoComplete="new-password" />
            </Field>
            {err && <Alert>{err}</Alert>}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save and continue"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
