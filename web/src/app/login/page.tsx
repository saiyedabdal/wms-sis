"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    if (mode === "signin") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ tone: "red", text: error.message });
      else {
        router.replace("/");
        router.refresh();
      }
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) setMsg({ tone: "red", text: error.message });
      else if (data.session) {
        router.replace("/");
        router.refresh();
      } else setMsg({ tone: "green", text: "Check your inbox to confirm your email, then sign in." });
    }
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white md:flex">
        <span className="text-3xl font-bold lowercase tracking-tight">frido</span>
        <div>
          <p className="text-[44px] font-semibold leading-[1.1] tracking-tight">
            Stock that <span className="text-yellow">moves</span>
            <br />
            with our partners.
          </p>
          <p className="mt-4 max-w-sm text-n600">Order requests, receipts, sales and settlements for Frido clinics and stores.</p>
        </div>
        <p className="text-xs uppercase tracking-widest text-n800">Freedom To Do More</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <span className="mb-8 block text-3xl font-bold lowercase tracking-tight md:hidden">frido</span>
          <h1 className="text-[28px] font-semibold tracking-tight">{mode === "signin" ? "Sign in to WMS" : "Create account"}</h1>
          <p className="mt-1 text-sm text-n800">
            {mode === "signin" ? "Use the email and password your admin set up." : "The first account becomes the admin. Others need an admin to activate them."}
          </p>
          <div className="mt-8 flex flex-col gap-5">
            {mode === "signup" && (
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </Field>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              type="button"
              className="text-sm text-blue hover:underline"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setMsg(null);
              }}
            >
              {mode === "signin" ? "First time? Create an account" : "Have an account? Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
