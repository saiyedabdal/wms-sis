"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RiArrowRightSLine } from "@remixicon/react";
import { APP_FULL_NAME, Brand } from "@/components/Brand";
import { OnboardingForm } from "@/components/OnboardingForm";
import { Alert, Button, Field, Input, cx } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Portal = "admin" | "field_sales" | "retailer" | "super_stockist";
const PORTALS: Record<Portal, { label: string; title: string; hint: string }> = {
  admin: { label: "Admin", title: "Admin login", hint: "Frido admins, managers and ops." },
  field_sales: { label: "Field sales", title: "Field sales team login", hint: "Frido's field team, for the retailers assigned to you." },
  retailer: { label: "Retailer", title: "Retailer login", hint: "For Frido retailers: clinics, physio centres and stores." },
  super_stockist: { label: "Super stockist", title: "Super stockist login", hint: "For Frido super stockists and distributors." },
};

/**
 * One login page per audience: /login/ (Admin, Field sales), /login/retailer/ and /login/ss/.
 * Only the retailer and SS pages carry their onboarding form, so nobody sees another audience's form.
 */
export function LoginScreen({ portals }: { portals: Portal[] }) {
  const router = useRouter();
  const [portal, setPortal] = useState<Portal>(portals[0]);
  const canApply = portal === "retailer" || portal === "super_stockist";
  // retailers and super stockists land on the onboarding form; approved ones switch to sign in
  const [apply, setApply] = useState(canApply);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const p = PORTALS[portal];

  // already signed in (the static site has no middleware to do this)
  useEffect(() => {
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => data.session && router.replace("/"));
  }, [router]);

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
        <Brand size="lg" />
        <div>
          <p className="text-[44px] font-semibold leading-[1.1] tracking-tight">
            Stock that <span className="text-yellow">moves</span>
            <br />
            with our partners.
          </p>
          <p className="mt-4 max-w-sm text-n600">
            {APP_FULL_NAME}: inward, outward, demand, approvals and fulfilment across Frido retailers, super stockists and stores.
          </p>
        </div>
        <p className="text-xs uppercase tracking-widest text-n800">Freedom To Do More</p>
      </div>

      <div className="flex justify-center px-4 py-8 sm:px-6 md:py-12">
        <div className={cx("w-full", apply && canApply ? "max-w-2xl" : "max-w-sm")}>
          <Brand size="lg" className="mb-6 md:hidden" />
          <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-xs text-n800">
            {/* retailers and SS stay on their own page; only the Frido team's page links home */}
            {canApply ? (
              <span>Frido CDN</span>
            ) : (
              <Link href="/login/" className="hover:text-ink hover:underline">
                Frido CDN
              </Link>
            )}
            <RiArrowRightSLine size={14} />
            <span className={cx(canApply ? "" : "font-semibold text-ink")}>{p.title}</span>
            {canApply && (
              <>
                <RiArrowRightSLine size={14} />
                <span className="font-semibold text-ink">{apply ? "Onboarding" : "Sign in"}</span>
              </>
            )}
          </nav>

          {portals.length > 1 && (
            <div role="tablist" aria-label="Login type" className="mb-8 grid grid-cols-2 gap-1 rounded-md bg-n100 p-1">
              {portals.map((x) => (
                <button
                  key={x}
                  role="tab"
                  aria-selected={portal === x}
                  onClick={() => {
                    setPortal(x);
                    setMsg(null);
                  }}
                  className={cx("h-9 rounded-xs px-2 text-sm font-medium", portal === x ? "bg-white font-semibold text-ink shadow-sm" : "text-n800 hover:text-ink")}
                >
                  {PORTALS[x].label}
                </button>
              ))}
            </div>
          )}
          {canApply && (
            <div role="tablist" aria-label="Onboarding or sign in" className="mb-8 grid max-w-sm grid-cols-2 gap-1 rounded-md bg-n100 p-1">
              {[
                { v: true, label: "Get access" },
                { v: false, label: "Sign in" },
              ].map((x) => (
                <button
                  key={x.label}
                  role="tab"
                  aria-selected={apply === x.v}
                  onClick={() => {
                    setApply(x.v);
                    setMsg(null);
                  }}
                  className={cx("h-9 rounded-xs px-2 text-sm font-medium", apply === x.v ? "bg-white font-semibold text-ink shadow-sm" : "text-n800 hover:text-ink")}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}

          {apply && canApply ? (
            <OnboardingForm applyingAs={portal} onSignIn={() => setApply(false)} />
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
                    No login yet? Get access to Frido CDN
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
