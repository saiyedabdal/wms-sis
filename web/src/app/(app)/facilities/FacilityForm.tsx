"use client";

import { paths } from "@/lib/paths";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { FACILITY_TYPES, type Facility } from "@/lib/types";
import { errMsg } from "@/lib/format";

type Form = Omit<Facility, "id">;

const EMPTY: Form = {
  code: "",
  name: "",
  type: "retailer",
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
  region: "",
  fulfiller_ss_id: null,
  pos_location: "",
  planning_enabled: true,
  review_days: 7,
  safety_days: 7,
  lead_time_days: 7,
};

export function FacilityForm({ initial }: { initial?: Facility }) {
  const router = useRouter();
  const { facilities, reloadFacilities } = useApp();
  const superStockists = facilities.filter((x) => x.type === "super_stockist" && x.is_active && x.id !== initial?.id);
  const [f, setF] = useState<Form>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      ...f,
      code: f.code.toUpperCase().trim(),
      default_margin_pct: Number(f.default_margin_pct),
      // only retailers and Frido stores are supplied by a super stockist
      fulfiller_ss_id: f.type === "retailer" || f.type === "internal" ? f.fulfiller_ss_id : null,
      region: f.region || null,
      pos_location: f.pos_location || null,
    };
    const sb = supabaseBrowser();
    const res = initial
      ? await sb.from("facilities").update(payload).eq("id", initial.id).select().single()
      : await sb.from("facilities").insert(payload).select().single();
    setBusy(false);
    if (res.error) return setMsg({ tone: "red", text: errMsg(res.error) });
    setMsg({ tone: "green", text: "Saved" });
    await reloadFacilities();
    if (!initial) router.push(paths.facility(res.data.id));
  };

  return (
    <form onSubmit={save}>
      <Card title="Details" actions={<Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>}>
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Facility name">
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} required placeholder="Neuromatics, Baner" />
          </Field>
          <Field label="Code" hint="Use the POS Store ID if it has one (e.g. FRIDO_0005)">
            <Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required pattern="[A-Z0-9_\-]{2,20}" placeholder="FRIDO_0005" />
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
          <Field label="Region">
            <Input value={f.region ?? ""} onChange={(e) => set("region", e.target.value)} placeholder="Pune West" />
          </Field>
          {(f.type === "retailer" || f.type === "internal") && (
            <Field label="Supplied by super stockist" hint="Approved requests take this SS's free stock first, the rest comes from Frido WH">
              <Select value={f.fulfiller_ss_id ?? ""} onChange={(e) => set("fulfiller_ss_id", Number(e.target.value) || null)}>
                <option value="">— Frido WH only —</option>
                {superStockists.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="POS location" hint="Shopify / DevX POS location name, if any">
            <Input value={f.pos_location ?? ""} onChange={(e) => set("pos_location", e.target.value)} placeholder="ELPro Mall" />
          </Field>
          <div className="rounded-md border border-n300 bg-n50 p-4 md:col-span-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-[#131313]" checked={f.planning_enabled} onChange={(e) => set("planning_enabled", e.target.checked)} />
              Weekly demand plan drafts a request for this facility
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Lead time (days)" hint="Used until real request → receipt times exist">
                <Input type="number" min={1} max={90} value={f.lead_time_days} onChange={(e) => set("lead_time_days", Number(e.target.value))} />
              </Field>
              <Field label="Review period (days)" hint="How often it gets replenished">
                <Input type="number" min={0} max={90} value={f.review_days} onChange={(e) => set("review_days", Number(e.target.value))} />
              </Field>
              <Field label="Safety stock (days)">
                <Input type="number" min={0} max={90} value={f.safety_days} onChange={(e) => set("safety_days", Number(e.target.value))} />
              </Field>
            </div>
          </div>
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
