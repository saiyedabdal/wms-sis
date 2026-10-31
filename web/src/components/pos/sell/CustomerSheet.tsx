"use client";

import { useEffect, useState } from "react";
import { RiBuilding2Line, RiCheckLine } from "@remixicon/react";
import { sb } from "@/lib/pos/supabase";
import { date } from "@/lib/pos/format";
import type { Customer } from "@/lib/pos/types";
import { Alert, Badge, Button, Chip, Field, Input, Modal, Segmented } from "../ui";

const LEAD_SOURCES = [
  ["doctor_referral", "Doctor / therapist"], ["walk_in", "Walked in"], ["google", "Google"], ["social_media", "Instagram / social"],
  ["friends_family", "Friends / family"], ["frido_website", "Frido website"], ["other", "Other"],
] as const;

/** Phone first: look the patient up at this clinic, or add them. B2B adds GSTIN + company. Marketing consent is opt-in. */
export function CustomerSheet({ open, facilityId, current, onClose, onSave, call }: {
  open: boolean;
  facilityId: number;
  current: Customer | null;
  onClose: () => void;
  onSave: (c: Customer | null) => void;
  call: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
}) {
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Customer | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [b2b, setB2b] = useState<"d2c" | "b2b">("d2c");
  const [gstin, setGstin] = useState("");
  const [company, setCompany] = useState("");
  const [lead, setLead] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = current;
    setPhone(c?.phone ?? ""); setFound(c ?? undefined); setName(c?.name ?? ""); setEmail(c?.email ?? "");
    setB2b(c?.gstin ? "b2b" : "d2c"); setGstin(c?.gstin ?? ""); setCompany(c?.company_name ?? ""); setLead(c?.lead_source ?? null);
    setConsent(c?.marketing_consent ?? false); setErr(null);
  }, [open, current]);

  const digits = phone.replace(/\D/g, "").slice(-10);
  useEffect(() => {
    if (!open || digits.length !== 10 || found?.phone === digits) return;
    let stale = false;
    sb().from("pos_customers").select("*").eq("facility_id", facilityId).eq("phone", digits).then(({ data }) => {
      if (stale) return;
      const c = (data?.[0] as Customer | undefined) ?? null;
      setFound(c);
      if (c) { setName(c.name ?? ""); setEmail(c.email ?? ""); setB2b(c.gstin ? "b2b" : "d2c"); setGstin(c.gstin ?? ""); setCompany(c.company_name ?? ""); setLead(c.lead_source); setConsent(c.marketing_consent); }
    });
    return () => { stale = true; };
  }, [digits, open, facilityId, found?.phone]);

  const save = async () => {
    setErr(null);
    if (!/^[6-9]\d{9}$/.test(digits)) return setErr("Enter a 10-digit mobile number");
    if (b2b === "b2b" && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase())) return setErr("Enter a valid 15-character GSTIN");
    setBusy(true);
    try {
      const c = await call<Customer>("pos_upsert_customer", {
        p_facility_id: facilityId,
        p_customer: { phone: digits, name, email, gstin: b2b === "b2b" ? gstin : null, company_name: b2b === "b2b" ? company : null,
                      lead_source: lead, marketing_consent: consent, consent_channel: "pos_counter" },
      });
      onSave(c);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Customer"
      footer={<div className="flex gap-2">
        {current && <Button variant="ghost" onClick={() => onSave(null)}>Remove from sale</Button>}
        <Button className="ml-auto" size="lg" onClick={save} disabled={busy || digits.length !== 10}><RiCheckLine /> {found ? "Use customer" : "Add customer"}</Button>
      </div>}>
      <div className="flex flex-col gap-4">
        <Field label="Mobile number" hint="10 digits. We look the customer up as you type.">
          <div className="flex items-center gap-2">
            <span className="flex h-12 items-center rounded-xs border border-n500 bg-n100 px-3 text-base text-n800">+91</span>
            <Input autoFocus inputMode="numeric" value={phone} maxLength={14} onChange={(e) => { setPhone(e.target.value); setFound(undefined); }} placeholder="98765 43210" />
          </div>
        </Field>
        {digits.length === 10 && found !== undefined && (found
          ? <Alert tone="green">Returning customer · {found.visits ?? "?"} earlier visit{found.visits === 1 ? "" : "s"}{found.last_visit ? `, last on ${date(found.last_visit)}` : ""}</Alert>
          : <Alert tone="blue">New customer at this clinic.</Alert>)}
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="As it should appear on the invoice" /></Field>
        <Field label="Email (optional)" hint="Leave blank if they don't have one. We never invent placeholder emails.">
          <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div>
          <Segmented value={b2b} onChange={setB2b} options={[{ value: "d2c", label: "Individual" }, { value: "b2b", label: <span className="flex items-center gap-1"><RiBuilding2Line className="h-4 w-4" /> Business (GST)</span> }]} />
        </div>
        {b2b === "b2b" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN"><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="27ABCDE1234F1Z5" /></Field>
            <Field label="Company name"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          </div>
        )}
        {!found?.lead_source && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">How did they hear about Frido? <Badge>optional</Badge></div>
            <div className="flex flex-wrap gap-2">
              {LEAD_SOURCES.map(([v, l]) => <Chip key={v} active={lead === v} onClick={() => setLead(lead === v ? null : v)}>{l}</Chip>)}
            </div>
          </div>
        )}
        <label className="flex items-start gap-3 rounded-md border border-n300 p-3">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-[#131313]" />
          <span className="text-sm">
            <span className="font-semibold">Customer agrees to receive offers and updates from Frido</span>
            <span className="block text-xs text-n800">Ask first; leave unticked unless they say yes. Their answer is saved with the date.</span>
          </span>
        </label>
        {err && <Alert>{err}</Alert>}
      </div>
    </Modal>
  );
}
