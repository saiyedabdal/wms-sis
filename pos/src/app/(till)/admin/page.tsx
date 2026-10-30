"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiAlarmWarningLine, RiCheckLine, RiErrorWarningLine } from "@remixicon/react";
import { usePos } from "@/lib/pos";
import { sb } from "@/lib/supabase";
import { dateTime, inr, modeLabel, STATE_NAMES } from "@/lib/format";
import type { CatalogItem, PayMode, StaffRef } from "@/lib/types";
import { Alert, Badge, Button, Card, Chip, Empty, Field, Input, Modal, Select, StatusBadge, cx, useToast } from "@/components/ui";

type Tab = "attention" | "refunds" | "therapists" | "staff" | "health" | "setup";

function Attention() {
  const { facilityId } = usePos();
  const [rows, setRows] = useState<{ id: number; invoice_no: string | null; status: string; created_at: string; grand_total: number; customer_name: string | null; attention_reason: string | null }[] | null>(null);
  useEffect(() => {
    if (!facilityId) return;
    sb().from("pos_invoices").select("id,invoice_no,status,created_at,grand_total,customer_name,attention_reason").eq("facility_id", facilityId)
      .in("status", ["needs_attention", "awaiting_payment"]).order("created_at").then(({ data }) => setRows((data as typeof rows) ?? []));
  }, [facilityId]);
  if (!rows) return null;
  return rows.length === 0 ? <Empty icon={<RiCheckLine />} title="Nothing needs attention">Unpaid drafts and payments that could not be finished show up here, so no payment is ever lost silently.</Empty> : (
    <ul className="divide-y divide-n300">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <StatusBadge status={r.status} />
          <span className="flex-1"><b>{r.invoice_no ?? `Draft #${r.id}`}</b> · {r.customer_name ?? "Walk-in"} · {dateTime(r.created_at)}
            {r.attention_reason && <span className="block text-red-a">{r.attention_reason}</span>}</span>
          <span className="tabular font-semibold">{inr(r.grand_total)}</span>
          <Link href="/invoices/" className="text-sm font-semibold underline">Open in Invoices</Link>
        </li>
      ))}
    </ul>
  );
}

function Refunds() {
  const { facilityId, ctx, call } = usePos();
  const toast = useToast();
  const [rows, setRows] = useState<{ id: number; amount: number; method: string; payee_vpa: string | null; payee_account: { name: string; account_no: string; ifsc: string } | null; status: string; created_at: string; credit_note_id: number; utr: string | null }[]>([]);
  const [pay, setPay] = useState<number | null>(null);
  const [utr, setUtr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!facilityId) return;
    sb().from("pos_refunds").select("*").eq("facility_id", facilityId).order("created_at", { ascending: false }).limit(100).then(({ data }) => setRows((data as typeof rows) ?? []));
  }, [facilityId]);
  useEffect(load, [load]);
  const canPay = ctx?.user.is_ops || (ctx?.entity?.kind === "partner" && ctx?.user.pos_role === "manager");
  return (
    <>
      <p className="mb-3 text-sm text-n800">Refunds are paid online by {ctx?.entity?.kind === "frido" ? "Frido finance (this clinic invoices as Frido)" : "the clinic"}, then marked paid here with the UTR.</p>
      {rows.length === 0 ? <Empty title="No refunds yet" /> : (
        <ul className="divide-y divide-n300">{rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <StatusBadge status={r.status} />
            <span className="flex-1">{r.method === "upi" ? `UPI ${r.payee_vpa}` : r.method === "bank_transfer" ? `Bank ${r.payee_account?.name} · ${r.payee_account?.account_no} · ${r.payee_account?.ifsc}` : "Razorpay refund"}
              <span className="block text-xs text-n800">{dateTime(r.created_at)}{r.utr ? ` · UTR ${r.utr}` : ""}</span></span>
            <span className="tabular font-semibold">{inr(r.amount)}</span>
            {r.status === "pending" && canPay && <Button size="sm" onClick={() => { setPay(r.id); setUtr(""); setErr(null); }}>Mark paid</Button>}
          </li>
        ))}</ul>
      )}
      <Modal open={pay !== null} onClose={() => setPay(null)} title="Refund paid"
        footer={<Button size="lg" className="w-full" disabled={utr.trim().length < 4} onClick={async () => {
          try { await call("pos_mark_refund", { p_refund_id: pay, p_status: "paid", p_utr: utr, p_note: null }); toast("Refund marked paid"); setPay(null); load(); }
          catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
        }}>Save</Button>}>
        <Field label="UTR of the refund payment"><Input autoFocus value={utr} onChange={(e) => setUtr(e.target.value)} /></Field>
        {err && <Alert className="mt-3">{err}</Alert>}
      </Modal>
    </>
  );
}

function Therapists() {
  const { facilityId, refresh } = usePos();
  const [rows, setRows] = useState<{ id: number; name: string; kind: string; phone: string | null; is_active: boolean }[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("doctor");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!facilityId) return;
    sb().from("pos_therapists").select("*").eq("facility_id", facilityId).order("name").then(({ data }) => setRows((data as typeof rows) ?? []));
  }, [facilityId]);
  useEffect(load, [load]);
  const add = async () => {
    setErr(null);
    const { error } = await sb().from("pos_therapists").insert({ facility_id: facilityId, name: name.trim(), kind });
    if (error) return setErr(error.message);
    setName(""); load(); refresh();
  };
  const toggle = async (id: number, is_active: boolean) => { await sb().from("pos_therapists").update({ is_active }).eq("id", id); load(); refresh(); };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Name" className="min-w-56 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Neha Joshi" /></Field>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="doctor">Doctor</option><option value="therapist">Therapist</option></Select></Field>
        <Button onClick={add} disabled={name.trim().length < 2}><RiAddLine /> Add</Button>
      </div>
      {err && <Alert className="mb-3">{err}</Alert>}
      <ul className="divide-y divide-n300">{rows.map((t) => (
        <li key={t.id} className={cx("flex items-center gap-3 py-3 text-sm", !t.is_active && "opacity-50")}>
          <span className="flex-1 font-semibold">{t.name}</span><Badge>{t.kind}</Badge>
          <Button size="sm" variant="ghost" onClick={() => toggle(t.id, !t.is_active)}>{t.is_active ? "Deactivate" : "Reactivate"}</Button>
        </li>
      ))}</ul>
    </>
  );
}

function Staff() {
  const { ctx, facilityId, call, refresh } = usePos();
  const toast = useToast();
  const [edit, setEdit] = useState<StaffRef | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [old, setOld] = useState("");
  const [mine, setMine] = useState("");
  const save = async () => {
    setErr(null);
    try {
      await call("pos_admin_set_staff", { p_user_id: edit!.user_id, p_facility_id: edit!.pos_role === "admin" ? null : facilityId, p_pos_role: edit!.pos_role,
        p_display_name: edit!.display_name, p_pin: pin, p_is_active: true });
      toast(`PIN set for ${edit!.display_name}`); setEdit(null); refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <>
      <ul className="divide-y divide-n300">{ctx?.staff.map((s) => (
        <li key={s.user_id} className="flex items-center gap-3 py-3 text-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-n200 font-semibold">{s.display_name.slice(0, 1)}</span>
          <span className="flex-1 font-semibold">{s.display_name}</span>
          <Badge tone={s.pos_role === "admin" ? "black" : s.pos_role === "manager" ? "yellow" : "neutral"}>{s.pos_role}</Badge>
          {!s.has_pin && <Badge tone="red">no PIN</Badge>}
          {(ctx.user.is_ops || s.pos_role === "cashier") && <Button size="sm" variant="secondary" onClick={() => { setEdit(s); setPin(""); setErr(null); }}>Set PIN</Button>}
        </li>
      ))}</ul>
      <p className="mt-3 text-xs text-n800">New people get a Partner Hub login first (one per person, never a shared counter account). Frido ops then add them here with a role.</p>
      {ctx?.user.pos_role && (
        <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-n300 pt-4">
          <Field label="My current PIN"><Input type="password" inputMode="numeric" maxLength={6} value={old} onChange={(e) => setOld(e.target.value)} /></Field>
          <Field label="New PIN (4–6 digits)"><Input type="password" inputMode="numeric" maxLength={6} value={mine} onChange={(e) => setMine(e.target.value)} /></Field>
          <Button variant="secondary" onClick={async () => {
            const r = await call<{ ok: boolean; error?: string }>("pos_change_my_pin", { p_old_pin: old, p_new_pin: mine });
            toast(r.ok ? "PIN changed" : r.error ?? "Not changed", r.ok ? "green" : "red"); setOld(""); setMine("");
          }}>Change my PIN</Button>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`PIN for ${edit?.display_name}`}
        footer={<Button size="lg" className="w-full" disabled={!/^\d{4,6}$/.test(pin)} onClick={save}>Save PIN</Button>}>
        <Field label="New PIN (4–6 digits)" hint="Tell them in person. They can change it under Admin → Staff."><Input autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
        {err && <Alert className="mt-3">{err}</Alert>}
      </Modal>
      {ctx?.user.is_ops && <AddStaff />}
    </>
  );
}

const FRIDO_ROLES = ["super_admin", "admin", "ops", "manager"];

/** Frido ops add a Partner Hub login to this clinic's POS staff (or as a Frido approver) with a role and PIN. */
function AddStaff() {
  const { ctx, facilityId, call, refresh } = usePos();
  const toast = useToast();
  const [people, setPeople] = useState<{ id: string; email: string; full_name: string | null; role: string; facility_id: number | null }[]>([]);
  const [who, setWho] = useState("");
  const [role, setRole] = useState("cashier");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    sb().from("profiles").select("id,email,full_name,role,facility_id").eq("is_active", true).order("full_name")
      .then(({ data }) => setPeople((data as typeof people) ?? []));
  }, []);
  const onPos = new Set(ctx?.staff.map((s) => s.user_id));
  const eligible = people.filter((p) => !onPos.has(p.id) && ((p.role === "facility_staff" && p.facility_id === facilityId) || FRIDO_ROLES.includes(p.role)));
  const person = eligible.find((p) => p.id === who);
  const frido = person ? FRIDO_ROLES.includes(person.role) : false;
  const add = async () => {
    setErr(null);
    try {
      await call("pos_admin_set_staff", { p_user_id: who, p_facility_id: frido ? null : facilityId, p_pos_role: frido ? "admin" : role,
        p_display_name: name || person?.full_name || person?.email, p_pin: pin, p_is_active: true });
      toast("Added to the POS"); setWho(""); setName(""); setPin(""); refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="mt-6 border-t border-n300 pt-4">
      <h3 className="mb-1 font-semibold">Add a person</h3>
      <p className="mb-3 text-xs text-n800">Clinic staff need a Partner Hub login assigned to {ctx?.facility?.name ?? "this clinic"} first (Hub → Users). Frido super admins, admins and managers join as POS admins who can approve above the manager limit and late returns.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Partner Hub user">
          <Select value={who} onChange={(e) => { setWho(e.target.value); setName(""); }}>
            <option value="">Choose…</option>
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email} · {p.role.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="POS role">
          {frido ? <Input disabled value="Frido admin (approver)" /> : (
            <Select value={role} onChange={(e) => setRole(e.target.value)}><option value="cashier">Cashier</option><option value="manager">Clinic manager</option></Select>
          )}
        </Field>
        <Field label="Name on invoices"><Input value={name} placeholder={person?.full_name ?? ""} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="PIN (4–6 digits)"><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      {eligible.length === 0 && <p className="mt-2 text-xs text-n800">Everyone eligible is already on the POS.</p>}
      {err && <Alert className="mt-3">{err}</Alert>}
      <Button className="mt-3" disabled={!who || !/^\d{4,6}$/.test(pin)} onClick={add}><RiAddLine /> Add to POS</Button>
    </div>
  );
}

function Health() {
  const { facilityId } = usePos();
  const [rows, setRows] = useState<CatalogItem[]>([]);
  useEffect(() => {
    if (!facilityId) return;
    sb().from("pos_v_catalog").select("*").eq("facility_id", facilityId).eq("sale_ready", "false").order("sku").then(({ data }) => setRows((data as CatalogItem[]) ?? []));
  }, [facilityId]);
  return rows.length === 0 ? <Empty icon={<RiCheckLine />} title="Every SKU in the assortment can be sold" /> : (
    <>
      <Alert tone="yellow" className="mb-3">These SKUs are in the clinic&apos;s assortment but can&apos;t be invoiced until Frido ops fix them in the Partner Hub: a GST invoice needs a selling price (MSP), an HSN code and a valid GST rate.</Alert>
      <ul className="divide-y divide-n300">{rows.map((i) => (
        <li key={i.sku} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <RiErrorWarningLine className="h-5 w-5 text-red-a" />
          <span className="flex-1"><b>{i.name}</b> · {i.sku}</span>
          {i.msp == null && <Badge tone="red">no MSP</Badge>}
          {!i.hsn_code && <Badge tone="red">no HSN</Badge>}
          {(i.gst_pct == null || ![0, 5, 12, 18, 28, 40].includes(Number(i.gst_pct))) && <Badge tone="red">GST {i.gst_pct ?? "blank"}</Badge>}
        </li>
      ))}</ul>
    </>
  );
}

function Setup() {
  const { ctx, facilityId, call, refresh } = usePos();
  const toast = useToast();
  const s = ctx?.settings;
  const [modes, setModes] = useState<PayMode[]>(s?.payment_modes ?? ["cash", "upi_static", "card_edc"]);
  const [inv, setInv] = useState(ctx?.series?.invoice ?? "");
  const [cn, setCn] = useState(ctx?.series?.credit_note ?? "");
  const [cashier, setCashier] = useState(String(s?.cashier_max_disc_pct ?? 5));
  const [manager, setManager] = useState(String(s?.manager_max_disc_pct ?? 10));
  const [days, setDays] = useState(String(s?.return_days ?? 10));
  const [footer, setFooter] = useState(s?.invoice_footer ?? "");
  const [till, setTill] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!ctx?.user.is_ops) return <Alert tone="yellow">Only Frido ops change the invoicing entity, series, payment modes and limits.</Alert>;
  if (!ctx.facility || !s) return <Onboard />;
  const save = async () => {
    setErr(null);
    try {
      await call("pos_admin_setup_facility", { p_facility_id: facilityId, p_entity_id: ctx.entity?.id ?? s?.entity_id, p_invoice_series: inv, p_credit_series: cn,
        p_settings: { payment_modes: modes, cashier_max_disc_pct: Number(cashier), manager_max_disc_pct: Number(manager), return_days: Number(days), invoice_footer: footer } });
      toast("Settings saved"); refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="blue">Invoices as <b>{ctx.entity?.legal_name}</b> · GSTIN {ctx.entity?.gstin ?? "not set"} · {ctx.entity?.kind === "frido" ? "Frido-invoiced (clinic acts as agent)" : "clinic-invoiced"}. Decision 1: set per facility.</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice series code" hint={`Numbers look like ${inv || "NMB1"}/2627/000123 (16 characters)`}><Input maxLength={4} value={inv} onChange={(e) => setInv(e.target.value.toUpperCase())} /></Field>
        <Field label="Credit note series code"><Input maxLength={4} value={cn} onChange={(e) => setCn(e.target.value.toUpperCase())} /></Field>
        <Field label="Cashier max discount %"><Input inputMode="decimal" value={cashier} onChange={(e) => setCashier(e.target.value)} /></Field>
        <Field label="Manager max discount %" hint="Above this only a Frido admin can approve"><Input inputMode="decimal" value={manager} onChange={(e) => setManager(e.target.value)} /></Field>
        <Field label="Return window (days)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Invoice footer"><Input value={footer} onChange={(e) => setFooter(e.target.value)} /></Field>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">Payment modes</div>
        <div className="flex flex-wrap gap-2">
          {(["cash", "upi_static", "upi_razorpay", "card_edc", "bank_transfer"] as PayMode[]).map((m) => (
            <Chip key={m} active={modes.includes(m)} onClick={() => setModes(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m])}>{modeLabel[m]}</Chip>
          ))}
        </div>
      </div>
      {err && <Alert>{err}</Alert>}
      <Button className="self-start" onClick={save}>Save settings</Button>
      <div className="flex flex-wrap items-end gap-2 border-t border-n300 pt-4">
        <Field label="Add a till" className="min-w-56 flex-1"><Input value={till} onChange={(e) => setTill(e.target.value)} placeholder="e.g. Physio floor" /></Field>
        <Button variant="secondary" disabled={till.trim().length < 2} onClick={async () => {
          const { error } = await sb().from("pos_registers").insert({ facility_id: facilityId, name: till.trim(), printer: "thermal_80" });
          if (error) setErr(error.message); else { setTill(""); toast("Till added"); refresh(); }
        }}><RiAddLine /> Add till</Button>
      </div>
      <details className="border-t border-n300 pt-4">
        <summary className="cursor-pointer text-sm font-semibold">Put another clinic on the POS</summary>
        <div className="mt-4"><Onboard /></div>
      </details>
    </div>
  );
}

const ALL_MODES: PayMode[] = ["cash", "upi_static", "upi_razorpay", "card_edc", "bank_transfer"];
const seriesFrom = (code: string, suffix: string) => (code.replace(/[^A-Z0-9]/g, "").slice(0, 3) + suffix).padEnd(4, "X");

/** First-time setup for a Partner Hub facility: invoicing entity (Decision 1), series codes, payment modes, first till. */
function Onboard() {
  const { ctx, call, setFacility } = usePos();
  const toast = useToast();
  const [facs, setFacs] = useState<{ id: number; code: string; name: string; type: string; state: string | null }[]>([]);
  const [ents, setEnts] = useState<{ id: number; code: string; legal_name: string; gstin: string | null; kind: string }[]>([]);
  const [fac, setFac] = useState<number | "">("");
  const [entityId, setEntityId] = useState<number | "new">("new");
  const [e, setE] = useState({ code: "", kind: "frido", legal_name: "", trade_name: "", gstin: "", state_code: "27", address: "", pan: "", cin: "", upi_vpa: "", upi_payee_name: "" });
  const [inv, setInv] = useState("");
  const [cn, setCn] = useState("");
  const [modes, setModes] = useState<PayMode[]>(["cash", "upi_static", "card_edc"]);
  const [till, setTill] = useState("Front desk");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb().from("facilities").select("id,code,name,type,state").eq("is_active", true).order("name")
      .then(({ data }) => setFacs(((data as typeof facs) ?? []).filter((f) => f.type !== "warehouse")));
    sb().from("pos_entities").select("id,code,legal_name,gstin,kind").eq("is_active", true).order("legal_name").then(({ data }) => {
      const list = (data as typeof ents) ?? [];
      setEnts(list);
      if (list.length) setEntityId(list[0].id);
    });
  }, []);
  const onPos = new Set(ctx?.facilities.map((f) => f.id));
  const chosen = facs.find((f) => f.id === fac);
  const pick = (id: number) => {
    const f = facs.find((x) => x.id === id);
    setFac(id);
    if (f) { setInv(seriesFrom(f.code, "1")); setCn(seriesFrom(f.code, "R")); }
  };
  const gstinOk = !e.gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(e.gstin);

  const submit = async () => {
    setErr(null);
    if (!fac) return setErr("Choose the clinic");
    if (entityId === "new") {
      if (!e.legal_name.trim() || !e.address.trim()) return setErr("The invoicing entity needs a legal name and address");
      if (!gstinOk) return setErr("GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5");
      if (e.gstin && e.gstin.slice(0, 2) !== e.state_code) return setErr("The GSTIN's first two digits must match the state code");
    }
    if (!/^[A-Z0-9]{4}$/.test(inv) || !/^[A-Z0-9]{4}$/.test(cn)) return setErr("Series codes are exactly 4 letters or digits");
    setBusy(true);
    try {
      let eid = entityId;
      if (eid === "new") {
        const code = (e.code || (e.kind === "frido" ? `FRIDO-${e.state_code}` : chosen!.code)).toUpperCase();
        const { data, error } = await sb().from("pos_entities").insert({
          code, kind: e.kind, legal_name: e.legal_name.trim(), trade_name: e.trade_name || null, gstin: e.gstin || null,
          state_name: STATE_NAMES[e.state_code] ?? e.state_code, state_code: e.state_code, address: e.address.trim(),
          pan: e.pan || null, cin: e.cin || null, upi_vpa: e.upi_vpa || null, upi_payee_name: e.upi_payee_name || null,
        }).select("id").single();
        if (error) throw error;
        eid = (data as { id: number }).id;
      }
      await call("pos_admin_setup_facility", { p_facility_id: fac, p_entity_id: eid, p_invoice_series: inv, p_credit_series: cn,
        p_settings: { payment_modes: modes } });
      if (till.trim()) {
        const { error } = await sb().from("pos_registers").insert({ facility_id: fac, name: till.trim(), printer: "thermal_80" });
        if (error && !/duplicate/i.test(error.message)) throw error;
      }
      toast(`${chosen?.name} is on the POS`);
      setFacility(Number(fac));
    } catch (x) { setErr(x instanceof Error ? x.message : String((x as { message?: string })?.message ?? x)); }
    setBusy(false);
  };

  const ent = (k: keyof typeof e) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setE({ ...e, [k]: k === "gstin" || k === "code" ? ev.target.value.toUpperCase() : ev.target.value });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="font-semibold">Put a clinic on the POS</h3>
        <p className="text-sm text-n800">Pick a Partner Hub facility, who invoices for it (Decision 1), its invoice series and how it takes payment. Staff and PINs come next, under Staff &amp; PINs.</p>
      </div>
      <Field label="Clinic / retailer">
        <Select value={fac} onChange={(ev) => pick(Number(ev.target.value))}>
          <option value="">Choose…</option>
          {facs.map((f) => <option key={f.id} value={f.id} disabled={onPos.has(f.id)}>{f.name} · {f.code}{onPos.has(f.id) ? " (already on the POS)" : ""}</option>)}
        </Select>
      </Field>
      <Field label="Invoices are issued by">
        <Select value={entityId} onChange={(ev) => setEntityId(ev.target.value === "new" ? "new" : Number(ev.target.value))}>
          {ents.map((x) => <option key={x.id} value={x.id}>{x.legal_name} · {x.gstin ?? "no GSTIN"} · {x.kind === "frido" ? "Frido" : "clinic"}</option>)}
          <option value="new">+ New invoicing entity…</option>
        </Select>
      </Field>
      {entityId === "new" && (
        <div className="grid gap-4 rounded-md border border-n300 p-4 sm:grid-cols-2">
          <Field label="Type"><Select value={e.kind} onChange={ent("kind")}><option value="frido">Frido invoices (clinic is agent)</option><option value="partner">Clinic invoices with its own GSTIN</option></Select></Field>
          <Field label="Legal name"><Input value={e.legal_name} onChange={ent("legal_name")} placeholder="Frido Arcatron Mobility Pvt Ltd" /></Field>
          <Field label="GSTIN" error={gstinOk ? null : "15 characters, e.g. 27ABCDE1234F1Z5"}><Input maxLength={15} value={e.gstin} onChange={ent("gstin")} /></Field>
          <Field label="State (registration)">
            <Select value={e.state_code} onChange={ent("state_code")}>{Object.entries(STATE_NAMES).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</Select>
          </Field>
          <Field label="Registered address" className="sm:col-span-2"><Input value={e.address} onChange={ent("address")} /></Field>
          <Field label="PAN (optional)"><Input value={e.pan} onChange={ent("pan")} /></Field>
          <Field label="CIN (optional)"><Input value={e.cin} onChange={ent("cin")} /></Field>
          <Field label="UPI ID for the static QR" hint="An address, not a secret, e.g. frido@icici"><Input value={e.upi_vpa} onChange={ent("upi_vpa")} /></Field>
          <Field label="UPI payee name"><Input value={e.upi_payee_name} onChange={ent("upi_payee_name")} /></Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Invoice series" hint={`${inv || "XXX1"}/2627/000001`}><Input maxLength={4} value={inv} onChange={(ev) => setInv(ev.target.value.toUpperCase())} /></Field>
        <Field label="Credit note series"><Input maxLength={4} value={cn} onChange={(ev) => setCn(ev.target.value.toUpperCase())} /></Field>
        <Field label="First till"><Input value={till} onChange={(ev) => setTill(ev.target.value)} /></Field>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">Payment modes</div>
        <div className="flex flex-wrap gap-2">{ALL_MODES.map((m) => (
          <Chip key={m} active={modes.includes(m)} onClick={() => setModes(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m])}>{modeLabel[m]}</Chip>
        ))}</div>
        <p className="mt-2 text-xs text-n800">Defaults: cashier 5%, manager 10%, returns 10 days, customer required. Change them after setup.</p>
      </div>
      {err && <Alert>{err}</Alert>}
      <Button className="self-start" disabled={busy || !fac} onClick={submit}>{busy ? "Setting up…" : "Put on the POS"}</Button>
    </div>
  );
}

export default function AdminPage() {
  const { ctx, setFacility } = usePos();
  const isManager = ctx?.user.is_ops || ctx?.user.pos_role === "manager";
  const onPos = !!ctx?.facility && !!ctx?.settings;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "attention", label: "Needs attention", show: onPos },
    { id: "refunds", label: "Refunds", show: onPos },
    { id: "therapists", label: "Therapists & doctors", show: onPos && !!isManager },
    { id: "staff", label: "Staff & PINs", show: onPos },
    { id: "health", label: "Data health", show: onPos },
    { id: "setup", label: "Setup", show: !!ctx?.user.is_ops },
  ];
  const [tab, setTab] = useState<Tab>(onPos ? "attention" : "setup");
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">Admin</h1>
        {ctx?.user.is_ops && (ctx.facilities.length ?? 0) > 1 && (
          <Select aria-label="Clinic" className="h-10 w-auto" value={ctx.facility?.id ?? ""} onChange={(e) => setFacility(Number(e.target.value))}>
            {ctx.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
        )}
      </div>
      <p className="mb-5 text-sm text-n800">{ctx?.facility?.name ?? "No clinic selected"} · signed in as {ctx?.user.full_name} ({ctx?.user.is_ops ? "Frido ops" : ctx?.user.pos_role ?? "staff"})</p>
      <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
        {tabs.filter((t) => t.show).map((t) => <Chip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>{t.id === "attention" && <RiAlarmWarningLine className="h-4 w-4" />}{t.label}</Chip>)}
      </div>
      <Card>
        {tab === "attention" && <Attention />}
        {tab === "refunds" && <Refunds />}
        {tab === "therapists" && <Therapists />}
        {tab === "staff" && <Staff />}
        {tab === "health" && <Health />}
        {tab === "setup" && <Setup />}
      </Card>
    </div>
  );
}
