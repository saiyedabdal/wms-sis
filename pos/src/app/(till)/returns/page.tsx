"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiAddLine, RiArrowGoBackLine, RiCheckboxCircleFill, RiExchangeLine, RiSubtractLine } from "@remixicon/react";
import { usePos } from "@/lib/pos";
import { sb, RpcError } from "@/lib/supabase";
import { date, inr, round2, uuid } from "@/lib/format";
import type { StaffSession } from "@/lib/types";
import { Alert, Button, Card, Chip, Field, Input, Segmented, Spinner, cx } from "@/components/ui";
import { PinPad } from "@/components/PinPad";
import { ShareButtons } from "@/components/sell/DoneSheet";

interface Line { id: number; sku: string; item_name: string; size: string | null; qty: number; returned_qty: number; net_amount: number; is_service: boolean }
interface Inv { id: number; invoice_no: string; invoiced_at: string; customer_id: number | null; therapist_id: number | null; customer_name: string | null; customer_phone: string | null; grand_total: number; status: string }
interface Result { id: number; credit_no: string; grand_total: number; share_token: string; settlement: string; refund_id: number | null }

const REASONS = ["Wrong size", "Defective", "Not suitable for the patient", "Changed mind", "Doctor changed advice"];

function Returns() {
  const { ctx, register, staff, facilityId, call } = usePos();
  const router = useRouter();
  const invoiceId = Number(useSearchParams().get("invoice"));
  const [inv, setInv] = useState<Inv | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [paidViaRzp, setPaidViaRzp] = useState(false);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [bucket, setBucket] = useState<Record<number, "sellable" | "damaged">>({});
  const [reason, setReason] = useState("");
  const [settle, setSettle] = useState<"refund" | "exchange">("exchange");
  const [method, setMethod] = useState<"upi" | "bank_transfer" | "razorpay_api">("upi");
  const [vpa, setVpa] = useState("");
  const [acct, setAcct] = useState({ name: "", account_no: "", ifsc: "" });
  const [pin, setPin] = useState<null | "manager" | "admin">(null);
  const [managerToken, setManagerToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [clientRef] = useState(uuid);

  useEffect(() => {
    if (!invoiceId) return;
    (async () => {
      const [i, l, p] = await Promise.all([
        sb().from("pos_invoices").select("*").eq("id", invoiceId),
        sb().from("pos_invoice_lines").select("*").eq("invoice_id", invoiceId).order("line_no"),
        sb().from("pos_payments").select("mode,status").eq("invoice_id", invoiceId),
      ]);
      setInv((i.data?.[0] as Inv) ?? null);
      setLines((l.data as Line[]) ?? []);
      setPaidViaRzp(((p.data as { mode: string; status: string }[]) ?? []).some((x) => x.mode === "upi_razorpay" && x.status === "confirmed"));
    })();
  }, [invoiceId]);

  const credit = useMemo(() => round2(lines.reduce((s, l) => s + (qty[l.id] ? (l.net_amount * qty[l.id]) / l.qty : 0), 0)), [lines, qty]);
  const chosen = lines.filter((l) => qty[l.id] > 0);
  const age = inv ? Math.floor((Date.now() - new Date(inv.invoiced_at).getTime()) / 86400000) : 0;
  const late = !!ctx?.settings && age > ctx.settings.return_days;

  const submit = async (mgrToken: string, overrideToken: string | null) => {
    setBusy(true); setErr(null);
    try {
      const r = await call<Result>("pos_return", {
        p_client_ref: clientRef, p_invoice_id: invoiceId, p_staff_token: mgrToken,
        p_lines: chosen.map((l) => ({ invoice_line_id: l.id, qty: qty[l.id], restock_bucket: l.is_service ? null : bucket[l.id] ?? "sellable" })),
        p_reason: reason, p_settlement: settle,
        p_refund: settle === "refund" ? { method, payee_vpa: vpa.trim(), payee_account: method === "bank_transfer" ? acct : null } : null,
        p_override_token: overrideToken,
      });
      setDone(r);
      setPin(null);
    } catch (e) {
      const x = e as RpcError;
      if (x.hint === "admin_override_required") { setManagerToken(mgrToken); setPin("admin"); }
      else { setErr(x.message); setPin(null); }
    }
    setBusy(false);
  };

  const start = () => {
    setErr(null);
    if (!chosen.length) return setErr("Choose what is coming back");
    if (reason.trim().length < 2) return setErr("Give a reason");
    if (staff && staff.staff.pos_role !== "cashier") {
      if (late) { setManagerToken(staff.token); return setPin("admin"); }
      return submit(staff.token, null);
    }
    setPin("manager");
  };

  const pinLogin = async (uid: string, p: string) => {
    const r = await call<{ ok: boolean; error?: string } & StaffSession>("pos_pin_login", { p_facility_id: facilityId, p_register_id: register?.id ?? null, p_user_id: uid, p_pin: p });
    return r.ok ? r.token : (r.error ?? "Wrong PIN");
  };

  // the replacement is the same customer's sale: carry them, the referral and the credit note into the till's cart
  const startExchange = async () => {
    if (!done || !register) return;
    const { data } = inv?.customer_id ? await sb().from("pos_customers").select("*").eq("id", inv.customer_id) : { data: null };
    try {
      const k = `pos.cart.${register.id}`;
      const cart = JSON.parse(localStorage.getItem(k) || "{}");
      localStorage.setItem(k, JSON.stringify({ ...cart, lines: cart.lines ?? [], customer: data?.[0] ?? cart.customer ?? null,
        therapist_id: inv?.therapist_id ?? cart.therapist_id ?? null,
        credit_note: { id: done.id, credit_no: done.credit_no, balance: done.grand_total } }));
    } catch { /* storage blocked: the cashier can still add the customer and credit note by hand */ }
    router.push("/");
  };

  if (!invoiceId) return <div className="p-6"><Alert tone="yellow">Open an invoice from <Link className="underline" href="/invoices/">Invoices</Link> and tap Return / exchange.</Alert></div>;
  if (!inv) return <div className="flex justify-center p-10"><Spinner /></div>;

  if (done)
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card>
          <div className="flex flex-col items-center gap-2 text-center">
            <RiCheckboxCircleFill className="h-14 w-14 text-green-b" />
            <div className="text-sm text-n800">Credit note</div>
            <div className="tabular text-2xl font-semibold">{done.credit_no}</div>
            <div className="tabular text-lg">{inr(done.grand_total)} against {inv.invoice_no}</div>
            {done.settlement === "refund"
              ? <Alert tone="blue" className="mt-2 text-left">Refund queued for {ctx?.entity?.kind === "frido" ? "Frido finance" : "the clinic"} to pay online. It shows under Admin → Refunds until the UTR is entered.</Alert>
              : <Alert tone="green" className="mt-2 text-left">{inr(done.grand_total)} is ready to spend on the replacement product.</Alert>}
          </div>
          <div className="mt-5"><ShareButtons token={done.share_token} phone={inv.customer_phone} what={`credit note ${done.credit_no}`} clinic={ctx?.facility?.name ?? "Frido"} printer={register?.printer} /></div>
          {done.settlement === "exchange"
            ? <Button size="xl" className="mt-4 w-full" onClick={startExchange}><RiExchangeLine /> Ring up the replacement</Button>
            : <Button size="xl" variant="dark" className="mt-4 w-full" onClick={() => router.push("/")}>Back to selling</Button>}
        </Card>
      </div>
    );

  const managers = (ctx?.staff ?? []).filter((s) => s.pos_role !== "cashier");
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <Link href="/invoices/" className="text-xs font-medium text-n800 hover:text-ink">← Invoices</Link>
      <h1 className="mt-1 flex items-center gap-2 text-[28px] font-semibold tracking-tight"><RiArrowGoBackLine /> Return against {inv.invoice_no}</h1>
      <p className="text-sm text-n800">{date(inv.invoiced_at)} · {inv.customer_name ?? inv.customer_phone ?? "Walk-in"} · {inr(inv.grand_total)} · {age} day{age === 1 ? "" : "s"} ago</p>
      <Alert tone="yellow" className="mt-4">Prototype: the return is recorded at the counter. Whether returns are taken at the counter or through Frido&apos;s online channel is still open (Decision 10). The credit note and refund queue work the same either way.</Alert>
      {late && <Alert className="mt-3">Past the {ctx?.settings?.return_days}-day return window. A Frido admin has to approve with their PIN.</Alert>}

      <Card className="mt-4" title="What is coming back?" pad={false}>
        <ul className="divide-y divide-n300">
          {lines.map((l) => {
            const left = l.qty - l.returned_qty;
            const q = qty[l.id] ?? 0;
            return (
              <li key={l.id} className={cx("flex flex-wrap items-center gap-3 px-5 py-4", left === 0 && "opacity-50")}>
                <div className="min-w-48 flex-1">
                  <div className="font-semibold">{l.item_name}{l.size ? ` · ${l.size}` : ""}</div>
                  <div className="text-xs text-n800">{l.sku} · bought {l.qty}{l.returned_qty ? `, ${l.returned_qty} already returned` : ""} · {inr(l.net_amount / l.qty)} each after discount</div>
                </div>
                {left > 0 && (
                  <>
                    <div className="flex items-center rounded-md border border-n500">
                      <button type="button" aria-label="One less" className="flex h-11 w-11 items-center justify-center hover:bg-n200" onClick={() => setQty({ ...qty, [l.id]: Math.max(q - 1, 0) })}><RiSubtractLine className="h-4 w-4" /></button>
                      <span className="tabular w-8 text-center font-semibold">{q}</span>
                      <button type="button" aria-label="One more" className="flex h-11 w-11 items-center justify-center hover:bg-n200" onClick={() => setQty({ ...qty, [l.id]: Math.min(q + 1, left) })}><RiAddLine className="h-4 w-4" /></button>
                    </div>
                    {!l.is_service && q > 0 && (
                      <Segmented value={bucket[l.id] ?? "sellable"} onChange={(b) => setBucket({ ...bucket, [l.id]: b })}
                        options={[{ value: "sellable", label: "Resell" }, { value: "damaged", label: "Damaged" }]} />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-4" title="Why and how?">
        <div className="flex flex-wrap gap-2">{REASONS.map((r) => <Chip key={r} active={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
        <Input className="mt-2" placeholder="Or type the reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-5">
          <Segmented value={settle} onChange={setSettle} options={[{ value: "exchange", label: "Exchange for another product" }, { value: "refund", label: "Refund online" }]} />
        </div>
        {settle === "refund" && (
          <div className="mt-4 flex flex-col gap-3">
            <Segmented value={method} onChange={setMethod} options={[{ value: "upi", label: "To UPI ID" }, { value: "bank_transfer", label: "To bank account" },
              { value: "razorpay_api", label: "Razorpay refund", disabled: !paidViaRzp }]} />
            {method === "upi" && <Field label="Customer's UPI ID"><Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@okaxis" /></Field>}
            {method === "bank_transfer" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Account holder"><Input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} /></Field>
                <Field label="Account number"><Input inputMode="numeric" value={acct.account_no} onChange={(e) => setAcct({ ...acct, account_no: e.target.value })} /></Field>
                <Field label="IFSC"><Input value={acct.ifsc} onChange={(e) => setAcct({ ...acct, ifsc: e.target.value.toUpperCase() })} maxLength={11} /></Field>
              </div>
            )}
            <p className="text-xs text-n800">No cash leaves the till. {ctx?.entity?.kind === "frido" ? "Frido finance" : "The clinic"} pays the refund online and records the UTR.</p>
          </div>
        )}
      </Card>

      {err && <Alert className="mt-4">{err}</Alert>}
      <div className="sticky bottom-16 mt-4 flex items-center justify-between gap-4 rounded-lg bg-ink p-4 text-white md:bottom-4">
        <div><div className="text-xs uppercase tracking-wider text-n600">Credit note value</div><div className="tabular text-2xl font-semibold">{inr(credit)}</div></div>
        <Button size="lg" disabled={busy || !chosen.length} onClick={start}>{busy ? "Saving…" : "Issue credit note"}</Button>
      </div>

      <PinPad open={pin === "manager"} onClose={() => setPin(null)} staff={managers} title="Manager approval for the return"
        subtitle="Returns are done by a manager. Their name is saved on the credit note."
        onSubmit={async (uid, p) => { const t = await pinLogin(uid, p); if (t.length !== 48) return t; await submit(t, null); return null; }} />
      <PinPad open={pin === "admin"} onClose={() => setPin(null)} staff={(ctx?.staff ?? []).filter((s) => s.pos_role === "admin")} title="Frido admin approval"
        subtitle={`This invoice is ${age} days old, past the ${ctx?.settings?.return_days}-day window.`}
        onSubmit={async (uid, p) => { const t = await pinLogin(uid, p); if (t.length !== 48) return t; await submit(managerToken ?? staff!.token, t); return null; }} />
    </div>
  );
}

export default function ReturnsPage() {
  return <Suspense><Returns /></Suspense>;
}
