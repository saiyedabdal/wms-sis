"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { FACILITY_TYPES, type Facility } from "@/lib/types";
import { errMsg } from "@/lib/format";

type Form = Omit<Facility, "id">;

const EMPTY: Form = {
  code: "",
  name: "",
  type: "partner_clinic",
  legal_name: "",
  gstin: "",
  address: "",
  city: "",
  state: "Maharashtra",
  pincode: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  default_margin_pct: 30,
  is_consignment: true,
  restrict_to_assortment: true,
  is_active: true,
  notes: "",
};

export function FacilityForm({ initial }: { initial?: Facility }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = { ...f, code: f.code.toUpperCase().trim(), default_margin_pct: Number(f.default_margin_pct) };
    const sb = supabaseBrowser();
    const res = initial
      ? await sb.from("facilities").update(payload).eq("id", initial.id).select().single()
      : await sb.from("facilities").insert(payload).select().single();
    setBusy(false);
    if (res.error) return setMsg({ tone: "red", text: errMsg(res.error) });
    setMsg({ tone: "green", text: "Saved" });
    router.refresh();
    if (!initial) router.push(`/facilities/${res.data.id}`);
  };

  return (
    <form onSubmit={save}>
      <Card title="Details" actions={<Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>}>
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Facility name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} required placeholder="Neuromatics, Baner" />
          </Field>
          <Field label="Code" hint="2–12 chars, A–Z 0–9 -">
            <Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required pattern="[A-Z0-9-]{2,12}" placeholder="NEU-BNR" />
          </Field>
          <Field label="Type">
            <Select value={f.type} onChange={(e) => set("type", e.target.value as Form["type"])}>
              {FACILITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Legal / billing name">
            <Input value={f.legal_name ?? ""} onChange={(e) => set("legal_name", e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <Input value={f.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} />
          </Field>
          <Field label="Default margin %" hint="Used when a category has no margin set">
            <Input type="number" step="0.01" min={0} max={100} value={f.default_margin_pct} onChange={(e) => set("default_margin_pct", Number(e.target.value))} />
          </Field>
          <Field label="Address" className="md:col-span-3">
            <Textarea value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} rows={2} />
          </Field>
          <Field label="City">
            <Input value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={f.state ?? ""} onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="Pincode">
            <Input value={f.pincode ?? ""} onChange={(e) => set("pincode", e.target.value)} />
          </Field>
          <Field label="Contact person">
            <Input value={f.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} />
          </Field>
          <Field label="Contact phone">
            <Input value={f.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={f.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} />
          </Field>
          <Field label="Notes" className="md:col-span-3">
            <Textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </Field>
          <div className="flex flex-wrap gap-6 md:col-span-3">
            {(
              [
                ["is_consignment", "Consignment (Frido-owned stock, settle on sale)"],
                ["restrict_to_assortment", "Only curated SKUs can be requested"],
                ["is_active", "Active"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[#131313]" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          {msg && (
            <div className="md:col-span-3">
              <Alert tone={msg.tone}>{msg.text}</Alert>
            </div>
          )}
        </div>
      </Card>
    </form>
  );
}
