"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingForm } from "@/components/OnboardingForm";
import { Alert, Button, Field, Input, cx } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

type Portal = "admin" | "field_sales" | "retailer" | "super_stockist";
const PORTALS: { value: Portal; label: string; title: string; hint: string }[] = [
  { value: "admin", label: "Admin", title: "Admin login", hint: "Frido admins, managers and ops." },
  { value: "field_sales", label: "Field sales", title: "Field sales team login", hint: "Frido's field team, for the retailers assigned to you." },
  { value: "retailer", label: "Retailer", title: "Retailer login", hint: "Clinics, physio centres and stores selling Frido." },
  { value: "super_stockist", label: "Super stockist", title: "Super stockist login", hint: "Distributors supplying Frido retailers." },
];

export default function LoginPage() {
  const router = useRouter();
  const [portal, setPortal] = useState<Portal>("admin");
  // retailers and super stockists land on the onboarding form; approved ones switch to sign in
  const [apply, setApply] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const p = PORTALS.find((x) => x.value === portal)!;
  const canApply = portal === "retailer" || portal === "super_stockist";

  // already signed in (the static site has no middleware to do this)
  useEffect(() => {
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => data.session && router.replace("/"));
  }, [router]);

  const choose = (v: Portal) => {
    setPortal(v);
    setApply(v === "retailer" || v === "super_stockist");
    setMsg(null);
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    router.replace("/");
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[minmax(320px,2fr)_3fr]">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white md:sticky md:top-0 md:flex md:h-screen md:self-start">
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-bold lowercase tracking-tight">frido</span>
          <span className="rounded-xs bg-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">Partner Hub</span>
        </span>
        <div>
          <p className="text-[44px] font-semibold leading-[1.1] tracking-tight">
            Stock that <span className="text-yellow">moves</span>
            <br />
            with our partners.
          </p>
          <p className="mt-4 max-w-sm text-n600">Inward, outward, demand, approvals and fulfilment across Frido retailers, super stockists and stores.</p>
        </div>
        <p className="text-xs uppercase tracking-widest text-n800">Freedom To Do More</p>
      </div>

      <div className="flex justify-center px-4 py-8 sm:px-6 md:py-12">
        <div className={cx("w-full", apply && canApply ? "max-w-2xl" : "max-w-sm")}>
          <span className="mb-6 flex items-baseline gap-2 md:hidden">
            <span className="text-3xl font-bold lowercase tracking-tight">frido</span>
            <span className="rounded-xs bg-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">Partner Hub</span>
          </span>
          <div role="tablist" aria-label="Login type" className="mb-8 grid grid-cols-2 gap-1 rounded-md bg-n100 p-1 sm:grid-cols-4">
            {PORTALS.map((x) => (
              <button
                key={x.value}
                role="tab"
                aria-selected={portal === x.value}
                onClick={() => choose(x.value)}
                className={cx(
                  "h-9 rounded-xs px-2 text-sm font-medium",
                  portal === x.value ? "bg-white font-semibold text-ink shadow-sm" : "text-n800 hover:text-ink",
                )}
              >
                {x.label}
              </button>
            ))}
          </div>

          {apply && canApply ? (
            <OnboardingForm key={portal} applyingAs={portal} onSignIn={() => setApply(false)} />
          ) : (
            <form onSubmit={signIn}>
              <h1 className="text-[28px] font-semibold tracking-tight">{p.title}</h1>
              <p className="mt-1 text-sm text-n800">{p.hint}</p>
              <div className="mt-8 flex flex-col gap-5">
                <Field label="Email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </Field>
                <Field label="Password">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                </Field>
                {msg && <Alert>{msg}</Alert>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Please wait…" : "Sign in"}
                </Button>
                {canApply && (
                  <button type="button" className="text-sm text-blue hover:underline" onClick={() => setApply(true)}>
                    New {portal === "retailer" ? "retailer" : "super stockist"}? Apply to join
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
