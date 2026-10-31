"use client";

import { useState, type ReactNode } from "react";
import { RiCheckboxCircleFill } from "@remixicon/react";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/types";
import { errMsg } from "@/lib/format";

export type ApplyingAs = "retailer" | "super_stockist";

const BUSINESS_TYPES: Record<ApplyingAs, string[]> = {
  retailer: ["Clinic / physiotherapy centre", "Hospital", "Pharmacy / chemist", "Orthopaedic / surgical store", "Retail store", "Other"],
  super_stockist: ["Distributor", "Super stockist / C&F agent", "Wholesaler", "Other"],
};
const TRACKING = ["Excel / Google Sheet", "Register (on paper)", "POS / billing software", "Not tracked today", "Other"];

const EMPTY = {
  business_name: "",
  business_type: "",
  legal_name: "",
  gstin: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  poc_name: "",
  poc_designation: "",
  poc_phone: "",
  poc_email: "",
  products_other: "",
  stock_location: "",
  stock_tracking: "",
  stock_poc_name: "",
  stock_poc_phone: "",
  stock_poc_email: "",
  referred_by: "",
  notes: "",
};

/** Request for Frido CDN portal access from an existing Frido retailer / super stockist (/login/retailer/, /login/ss/).
 *  An admin approves it on Onboarding. */
export function OnboardingForm({ applyingAs, onSignIn }: { applyingAs: ApplyingAs; onSignIn: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [categories, setCategories] = useState<string[]>([]);
  const [maintains, setMaintains] = useState<boolean | null>(null);
  const [fridoManage, setFridoManage] = useState<boolean | null>(null);
  const [stockPocSame, setStockPocSame] = useState(true);
  const [trap, setTrap] = useState(""); // hidden field only bots fill in
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const kind = applyingAs === "retailer" ? "retailer" : "super stockist";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (maintains === null) return setErr("Tell us whether you maintain stock.");
    if (maintains === false && fridoManage === null) return setErr("Tell us whether Frido should maintain the stock for you.");
    if (trap) return setDone(0);
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("submit_vendor_application", {
      p: {
        ...f,
        applying_as: applyingAs,
        product_categories: categories,
        maintains_stock: maintains,
        frido_manage_stock: maintains ? null : fridoManage,
        ...(maintains && stockPocSame ? { stock_poc_name: f.poc_name, stock_poc_phone: f.poc_phone, stock_poc_email: f.poc_email } : {}),
      },
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setDone(data);
  };

  if (done !== null) {
    return (
      <div className="flex flex-col gap-4">
        <RiCheckboxCircleFill size={40} className="text-green-a" />
        <h1 className="text-[28px] font-semibold tracking-tight">Thanks, {f.poc_name.split(" ")[0] || "we've got it"}</h1>
        <p className="text-sm text-n900">
          Your Frido CDN access request as a {kind} is with the Frido team{done ? ` (application #${done})` : ""}. Once it&apos;s approved you&apos;ll get an email at{" "}
          <span className="font-semibold">{f.poc_email}</span> with your temporary password to sign in.
        </p>
        <Button variant="secondary" onClick={onSignIn}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">{applyingAs === "retailer" ? "Retailer" : "Super stockist"} onboarding</h1>
        <p className="mt-1 text-sm text-n800">
          Get your login to Frido CDN, the Frido Care Distribution Network portal for stock, orders and deliveries. Fill in your details; once the Frido
          team approves them, you get an email with your login.
        </p>
      </div>

      <Section n={1} title="Business details">
        <Field label="Business name *" className="sm:col-span-2">
          <Input value={f.business_name} onChange={set("business_name")} required maxLength={200} placeholder="e.g. Neuromatics Physio, Baner" />
        </Field>
        <Field label="Type of business *">
          <Select value={f.business_type} onChange={set("business_type")} required>
            <option value="">Choose…</option>
            {BUSINESS_TYPES[applyingAs].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="GSTIN" hint="If registered">
          <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="27ABCDE1234F1Z5" />
        </Field>
        <Field label="Legal / registered name" className="sm:col-span-2">
          <Input value={f.legal_name} onChange={set("legal_name")} maxLength={200} placeholder="As on GST / invoices" />
        </Field>
        <Field label="Address *" className="sm:col-span-2">
          <Textarea value={f.address} onChange={set("address")} required rows={2} maxLength={500} />
        </Field>
        <Field label="City *">
          <Input value={f.city} onChange={set("city")} required maxLength={100} />
        </Field>
        <Field label="State *">
          <Input value={f.state} onChange={set("state")} required maxLength={100} />
        </Field>
        <Field label="Pincode *">
          <Input value={f.pincode} onChange={set("pincode")} required inputMode="numeric" pattern="\d{6}" maxLength={6} />
        </Field>
      </Section>

      <Section n={2} title="Point of contact" hint="This email becomes your Frido CDN login.">
        <Field label="Name *">
          <Input value={f.poc_name} onChange={set("poc_name")} required maxLength={120} />
        </Field>
        <Field label="Designation">
          <Input value={f.poc_designation} onChange={set("poc_designation")} maxLength={120} placeholder="Owner, manager…" />
        </Field>
        <Field label="Phone *">
          <Input type="tel" value={f.poc_phone} onChange={set("poc_phone")} required maxLength={20} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Email *">
          <Input type="email" value={f.poc_email} onChange={set("poc_email")} required maxLength={200} autoComplete="email" />
        </Field>
      </Section>

      <Section n={3} title="Products you deal in">
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {CATEGORIES.map((c) => {
            const on = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategories(on ? categories.filter((x) => x !== c) : [...categories, c])}
                className={cx("rounded-full border px-3 py-1.5 text-sm", on ? "border-ink bg-ink text-white" : "border-n500 bg-white hover:border-ink")}
              >
                {c}
              </button>
            );
          })}
        </div>
        <Field label="Other products or brands you sell" className="sm:col-span-2">
          <Input value={f.products_other} onChange={set("products_other")} maxLength={500} placeholder="e.g. braces, walkers, other brands" />
        </Field>
      </Section>

      <Section n={4} title="Stock">
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Do you maintain stock? *</p>
          <YesNo value={maintains} onChange={setMaintains} />
        </div>
        {maintains === true && (
          <>
            <Field label="Where is the stock kept? *" className="sm:col-span-2">
              <Textarea value={f.stock_location} onChange={set("stock_location")} required rows={2} maxLength={500} placeholder="In the store / godown address" />
            </Field>
            <Field label="How do you track it today?">
              <Select value={f.stock_tracking} onChange={set("stock_tracking")}>
                <option value="">Choose…</option>
                {TRACKING.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4 accent-[#131313]" checked={stockPocSame} onChange={(e) => setStockPocSame(e.target.checked)} />
              Same person looks after the stock
            </label>
            {!stockPocSame && (
              <>
                <Field label="Stock contact name *">
                  <Input value={f.stock_poc_name} onChange={set("stock_poc_name")} required maxLength={120} />
                </Field>
                <Field label="Stock contact phone *">
                  <Input type="tel" value={f.stock_poc_phone} onChange={set("stock_poc_phone")} required maxLength={20} />
                </Field>
                <Field label="Stock contact email" className="sm:col-span-2">
                  <Input type="email" value={f.stock_poc_email} onChange={set("stock_poc_email")} maxLength={200} />
                </Field>
              </>
            )}
          </>
        )}
        {maintains === false && (
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Should Frido maintain the stock for you, automatically? *</p>
            <p className="mb-2 text-xs text-n800">Frido keeps track of what is sent to you, sold and on hand in Frido CDN, so you don&apos;t have to.</p>
            <YesNo value={fridoManage} onChange={setFridoManage} />
          </div>
        )}
      </Section>

      <Section n={5} title="Anything else">
        <Field label="Referred by" hint="Frido team member, if any">
          <Input value={f.referred_by} onChange={set("referred_by")} maxLength={120} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={set("notes")} rows={2} maxLength={1000} />
        </Field>
        <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
      </Section>

      {err && <Alert>{err}</Alert>}
      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Sending…" : "Send for approval"}
        </Button>
        <button type="button" onClick={onSignIn} className="text-sm text-blue hover:underline">
          Already have a login? Sign in
        </button>
      </div>
    </form>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-n300 pt-5">
      <legend className="flex items-center gap-2 pr-2 text-sm font-semibold uppercase tracking-wider">
        <span className="flex size-5 items-center justify-center rounded-full bg-yellow text-[11px] font-bold">{n}</span>
        {title}
      </legend>
      {hint && <p className="mb-3 text-xs text-n800">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cx("h-10 min-w-24 rounded-xs border px-4 text-sm font-medium", value === v ? "border-ink bg-yellow" : "border-n500 bg-white hover:border-ink")}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}
