"use client";

import { useState } from "react";
import { sb } from "@/lib/supabase";
import { Alert, Button, Field, Input } from "@/components/ui";
import { Logo } from "@/components/Shell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setErr(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    location.href = "/";
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <Logo className="text-4xl text-white" />
        <div>
          <p className="text-[44px] font-semibold leading-[1.1] tracking-tight">Sell Frido at your clinic in seconds.</p>
          <p className="mt-4 max-w-md text-lg text-n600">Scan, take payment, hand over a GST invoice. Stock and settlement update in the Frido Partner Hub as you sell.</p>
        </div>
        <p className="text-sm text-n700">Freedom To Do More</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <Logo className="mb-8 text-4xl lg:hidden" />
          <h1 className="text-[28px] font-semibold tracking-tight">Sign in to the till</h1>
          <p className="mt-1 text-sm text-n800">Use your own Partner Hub account. Staff switch with a PIN once the till is open.</p>
          <div className="mt-8 flex flex-col gap-5">
            <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {err && <Alert>{err}</Alert>}
            <Button type="submit" size="lg" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
