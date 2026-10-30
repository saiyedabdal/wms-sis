"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RiDeleteBack2Line, RiShieldUserLine } from "@remixicon/react";
import { Alert, Button, Modal, cx } from "./ui";
import type { StaffRef } from "@/lib/types";

const roleLabel = { cashier: "Cashier", manager: "Manager", admin: "Frido admin" } as const;

/**
 * Pick a person, type their 4–6 digit PIN. Used for the staff switch, manager approvals and admin overrides.
 * onSubmit returns an error message (wrong PIN, locked) or null when accepted.
 */
export function PinPad({ open, title, subtitle, staff, onSubmit, onClose, children, submitLabel = "Enter", dismissable = true, canSubmit = true, emptyText }: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  staff: StaffRef[];
  onSubmit: (userId: string, pin: string) => Promise<string | null>;
  onClose: () => void;
  children?: ReactNode;
  submitLabel?: string;
  dismissable?: boolean;
  canSubmit?: boolean;
  /** shown when nobody in `staff` can do this */
  emptyText?: ReactNode;
}) {
  const [who, setWho] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPin("");
    setErr(null);
    setWho(staff.length === 1 ? staff[0].user_id : null);
  }, [open, staff]);

  const submit = async (p = pin) => {
    if (!who || p.length < 4 || busy || !canSubmit) return;
    setBusy(true);
    setErr(null);
    const e = await onSubmit(who, p).catch((x) => (x instanceof Error ? x.message : String(x)));
    setBusy(false);
    if (e) { setErr(e); setPin(""); }
  };
  // digits only count once a person is picked, so the dots never fill while Enter stays off
  const press = (d: string) => { if (!who) return; setErr(null); setPin((p) => (p.length < 6 ? p + d : p)); };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <Modal open={open} onClose={onClose} title={title} dismissable={dismissable}>
      {subtitle && <div className="mb-4 text-sm text-n900">{subtitle}</div>}
      {children}
      {staff.length === 0 ? (
        <Alert tone="yellow">{emptyText ?? "Nobody on this clinic's POS staff list can do this. A Frido admin adds people under Admin → Staff & PINs."}</Alert>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {staff.map((s) => (
            <button key={s.user_id} type="button" onClick={() => { setWho(s.user_id); setPin(""); setErr(null); }}
              className={cx("flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 text-left transition",
                who === s.user_id ? "border-ink bg-y50 ring-2 ring-yellow" : "border-n500 bg-white hover:border-ink")}>
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold",
                s.pos_role === "admin" ? "bg-ink text-yellow" : "bg-n200 text-ink")}>
                {s.pos_role === "admin" ? <RiShieldUserLine className="h-5 w-5" /> : s.display_name.slice(0, 1)}
              </span>
              <span>
                <span className="block text-sm font-semibold">{s.display_name}</span>
                <span className="block text-xs text-n800">{roleLabel[s.pos_role]}{s.has_pin === false ? " · no PIN set" : ""}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto max-w-xs">
        {staff.length > 0 && !who && <p className="mb-1 text-center text-sm font-semibold text-y500">Tap your name above, then enter your PIN</p>}
        <div className="mb-2 flex h-8 items-center justify-center gap-3" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} className={cx("h-3.5 w-3.5 rounded-full", i < pin.length ? "bg-ink" : "bg-n400")} />
          ))}
        </div>
        {err && <Alert className="mb-3">{err}</Alert>}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" disabled={!who} onClick={() => press(d)}
              className="h-12 rounded-md bg-n100 text-xl font-semibold transition hover:bg-n200 active:bg-n300 disabled:opacity-40">{d}</button>
          ))}
          <button type="button" onClick={() => setPin("")} disabled={!who}
            className="h-12 rounded-md text-sm font-medium text-n900 hover:bg-n200 disabled:opacity-40">Clear</button>
          <button type="button" disabled={!who} onClick={() => press("0")}
            className="h-12 rounded-md bg-n100 text-xl font-semibold hover:bg-n200 active:bg-n300 disabled:opacity-40">0</button>
          <button type="button" aria-label="Delete" disabled={!who} onClick={() => setPin((p) => p.slice(0, -1))}
            className="flex h-12 items-center justify-center rounded-md hover:bg-n200 disabled:opacity-40"><RiDeleteBack2Line /></button>
        </div>
        <Button className="mt-3 w-full" size="lg" disabled={!who || pin.length < 4 || busy || !canSubmit} onClick={() => submit()}>
          {busy ? "Checking…" : submitLabel}
        </Button>
      </div>
    </Modal>
  );
}
