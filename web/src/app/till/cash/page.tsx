"use client";

import { useCallback, useEffect, useState } from "react";
import { RiBankLine, RiHandCoinLine, RiLockLine, RiPrinterLine, RiWallet3Line } from "@remixicon/react";
import { usePos } from "@/lib/pos/context";
import { sb, RpcError } from "@/lib/pos/supabase";
import { dateTime, inr, modeLabel, time } from "@/lib/pos/format";
import type { StaffSession } from "@/lib/pos/types";
import { Alert, Badge, Button, Card, Chip, Empty, Field, Input, Modal, Spinner, Stat, cx, useToast } from "@/components/pos/ui";
import { PinPad } from "@/components/pos/PinPad";

interface Report {
  shift_id: number; register: string; status: string; opened_at: string; closed_at: string | null; opening_float: number; opened_by: string;
  closed_by: string | null; invoices: number; gross_total: number; discount_total: number; sales_total: number; tax_total: number;
  by_mode: Record<string, number>; pending_by_mode: Record<string, number>; by_staff: { name: string; invoices: number; sales: number }[];
  credit_notes: number; credit_total: number; open_drafts: number; cash_sales: number; cash_in: number; petty_cash: number;
  bank_deposit: number; expected_cash: number; counted_cash: number | null; variance: number | null; close_note: string | null;
}
interface Move { id: number; kind: string; category: string | null; amount: number; note: string | null; created_at: string; staff_id: string }

const CATS = ["Food & tea", "Utilities", "Maintenance", "Stationery", "Cleaning", "Courier", "Other"];
const NOTES = [500, 200, 100, 50, 20, 10];

function ZReport({ r }: { r: Report }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales" value={inr(r.sales_total)} sub={`${r.invoices} invoice${r.invoices === 1 ? "" : "s"}`} />
        <Stat label="Discounts" value={inr(r.discount_total)} />
        <Stat label="Credit notes" value={inr(r.credit_total)} sub={`${r.credit_notes} issued`} />
        <Stat label={r.status === "closed" ? "Cash variance" : "Expected in drawer"} value={inr(r.status === "closed" ? r.variance : r.expected_cash)}
          tone={r.status === "closed" && r.variance ? "red" : undefined} sub={r.status === "closed" ? `counted ${inr(r.counted_cash)} vs ${inr(r.expected_cash)}` : undefined} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <table className="w-full">
          <thead><tr className="border-b border-n300 text-left text-[11px] uppercase tracking-wider text-n800"><th className="py-2">Takings by mode</th><th className="py-2 text-right">Received</th><th className="py-2 text-right">Pending</th></tr></thead>
          <tbody className="divide-y divide-n300">
            {Array.from(new Set([...Object.keys(r.by_mode), ...Object.keys(r.pending_by_mode)])).map((m) => (
              <tr key={m}><td className="py-2">{modeLabel[m] ?? m}</td><td className="tabular py-2 text-right">{inr(r.by_mode[m] ?? 0)}</td><td className="tabular py-2 text-right text-n800">{r.pending_by_mode[m] ? inr(r.pending_by_mode[m]) : "—"}</td></tr>
            ))}
            {!Object.keys(r.by_mode).length && <tr><td className="py-2 text-n800" colSpan={3}>No payments yet</td></tr>}
          </tbody>
        </table>
        <table className="w-full">
          <thead><tr className="border-b border-n300 text-left text-[11px] uppercase tracking-wider text-n800"><th className="py-2">Cash drawer</th><th className="py-2 text-right">₹</th></tr></thead>
          <tbody className="tabular divide-y divide-n300">
            <tr><td className="py-2">Opening float</td><td className="py-2 text-right">{inr(r.opening_float)}</td></tr>
            <tr><td className="py-2">+ Cash sales</td><td className="py-2 text-right">{inr(r.cash_sales)}</td></tr>
            <tr><td className="py-2">+ Cash in</td><td className="py-2 text-right">{inr(r.cash_in)}</td></tr>
            <tr><td className="py-2">− Petty cash</td><td className="py-2 text-right">{inr(r.petty_cash)}</td></tr>
            <tr><td className="py-2">− Bank deposits</td><td className="py-2 text-right">{inr(r.bank_deposit)}</td></tr>
            <tr className="font-semibold"><td className="py-2">= Expected</td><td className="py-2 text-right">{inr(r.expected_cash)}</td></tr>
          </tbody>
        </table>
      </div>
      {r.by_staff.length > 0 && (
        <table className="w-full">
          <thead><tr className="border-b border-n300 text-left text-[11px] uppercase tracking-wider text-n800"><th className="py-2">By staff</th><th className="py-2 text-right">Invoices</th><th className="py-2 text-right">Sales</th></tr></thead>
          <tbody className="divide-y divide-n300">{r.by_staff.map((s) => <tr key={s.name}><td className="py-2">{s.name}</td><td className="tabular py-2 text-right">{s.invoices}</td><td className="tabular py-2 text-right">{inr(s.sales)}</td></tr>)}</tbody>
        </table>
      )}
      {r.open_drafts > 0 && <Alert tone="yellow">{r.open_drafts} unpaid or flagged sale{r.open_drafts > 1 ? "s" : ""} on this shift. Check Invoices → Unpaid.</Alert>}
      {r.close_note && <p className="text-n900"><b>Close note:</b> {r.close_note}</p>}
    </div>
  );
}

export default function CashPage() {
  const { ctx, register, staff, facilityId, call, refresh } = usePos();
  const toast = useToast();
  const shiftId = register?.open_shift?.id ?? null;
  const [report, setReport] = useState<Report | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [history, setHistory] = useState<{ id: number; opened_at: string; closed_at: string; variance: number; z_report: Report }[]>([]);
  const [form, setForm] = useState<null | "petty_cash" | "bank_deposit" | "cash_in" | "close">(null);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [z, setZ] = useState<Report | null>(null);

  const load = useCallback(async () => {
    if (shiftId) {
      setReport(await call<Report>("pos_shift_report", { p_shift_id: shiftId }));
      const { data } = await sb().from("pos_cash_movements").select("*").eq("shift_id", shiftId).order("created_at", { ascending: false });
      setMoves((data as Move[]) ?? []);
    } else setReport(null);
    if (register) {
      const { data } = await sb().from("pos_shifts").select("id,opened_at,closed_at,variance,z_report").eq("register_id", register.id).eq("status", "closed").order("closed_at", { ascending: false }).limit(10);
      setHistory((data as typeof history) ?? []);
    }
  }, [shiftId, register, call]);
  useEffect(() => { load(); }, [load]);

  const counted = NOTES.reduce((s, n) => s + n * (Number(count[n]) || 0), 0) + (Number(count.coins) || 0);
  const isManager = staff && staff.staff.pos_role !== "cashier";
  const staffName = Object.fromEntries((ctx?.staff ?? []).map((s) => [s.user_id, s.display_name]));

  const run = async (token: string) => {
    setErr(null);
    try {
      if (form === "close") {
        const r = await call<Report>("pos_close_shift", { p_shift_id: shiftId, p_staff_token: token, p_counted_cash: counted, p_note: note });
        setZ(r); setForm(null); await refresh();
      } else {
        await call("pos_add_cash_movement", { p_shift_id: shiftId, p_staff_token: token, p_kind: form, p_amount: Number(amount), p_category: cat || null, p_note: note });
        toast("Saved"); setForm(null); await load();
      }
      return null;
    } catch (e) {
      const x = e as RpcError;
      return x.message;
    }
  };
  const submit = async () => {
    if (form !== "cash_in" && !isManager) return setNeedPin(true);
    const e = await run(staff!.token);
    if (e) setErr(e);
  };
  const openForm = (f: typeof form) => { setForm(f); setAmount(""); setCat(""); setNote(""); setCount({}); setErr(null); };

  if (!register) return null;
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Cash & day end</h1>
          <p className="text-sm text-n800">{register.name}{register.open_shift ? ` · opened ${time(register.open_shift.opened_at)} by ${register.open_shift.opened_by}` : " · no open shift"}</p>
        </div>
        {shiftId && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openForm("petty_cash")}><RiWallet3Line /> Petty cash</Button>
            <Button variant="secondary" onClick={() => openForm("bank_deposit")}><RiBankLine /> Bank deposit</Button>
            <Button variant="ghost" onClick={() => openForm("cash_in")}><RiHandCoinLine /> Cash in</Button>
            <Button variant="dark" onClick={() => openForm("close")}><RiLockLine /> Close day</Button>
          </div>
        )}
      </div>

      {!shiftId ? (
        <Card><Empty icon={<RiLockLine />} title="The till is closed">Open a shift from the Sell screen to start taking money.</Empty></Card>
      ) : !report ? <div className="flex justify-center p-10"><Spinner /></div> : (
        <>
          <Card title={<span>Live shift report <Badge tone="green" className="ml-2">open</Badge></span>}><ZReport r={report} /></Card>
          <Card className="mt-4" title="Cash movements this shift" pad={false}>
            {moves.length === 0 ? <p className="px-5 py-4 text-sm text-n800">No petty cash, deposits or cash in yet.</p> : (
              <ul className="divide-y divide-n300">{moves.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Badge tone={m.kind === "cash_in" ? "green" : m.kind === "bank_deposit" ? "blue" : "yellow"}>{m.kind.replace("_", " ")}</Badge>
                  <span className="flex-1">{m.category ?? ""} {m.note && <span className="text-n800">· {m.note}</span>}<span className="block text-xs text-n800">{time(m.created_at)} · {staffName[m.staff_id] ?? ""}</span></span>
                  <span className="tabular font-semibold">{m.kind === "cash_in" ? "+" : "−"} {inr(m.amount)}</span>
                </li>
              ))}</ul>
            )}
          </Card>
        </>
      )}

      {history.length > 0 && (
        <Card className="mt-4" title="Closed shifts" pad={false}>
          <ul className="divide-y divide-n300">{history.map((h) => (
            <li key={h.id}><button className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-n100" onClick={() => setZ(h.z_report)}>
              <span className="flex-1">{dateTime(h.opened_at)} → {time(h.closed_at)}</span>
              <span className="tabular">{inr(h.z_report?.sales_total)}</span>
              <Badge tone={h.variance ? "red" : "green"}>{h.variance ? `off ${inr(h.variance)}` : "balanced"}</Badge>
            </button></li>
          ))}</ul>
        </Card>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form === "close" ? "Close the day" : form === "petty_cash" ? "Petty cash" : form === "bank_deposit" ? "Bank deposit" : "Cash in"}
        footer={<Button size="lg" className="w-full" onClick={submit} disabled={form === "close" ? false : !Number(amount)}>
          {form === "close" ? `Close with ${inr(counted)} counted` : "Save"}{form !== "cash_in" && !isManager ? " · manager PIN" : ""}</Button>}>
        {form === "close" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-n800">Count every note in the drawer. The system expects <b>{inr(report?.expected_cash)}</b>.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {NOTES.map((n) => (
                <Field key={n} label={`₹${n} notes`}><Input inputMode="numeric" value={count[n] ?? ""} onChange={(e) => setCount({ ...count, [n]: e.target.value.replace(/\D/g, "") })} placeholder="0" /></Field>
              ))}
              <Field label="Coins (₹ total)"><Input inputMode="decimal" value={count.coins ?? ""} onChange={(e) => setCount({ ...count, coins: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" /></Field>
            </div>
            <div className={cx("flex items-center justify-between rounded-md p-3", counted === report?.expected_cash ? "bg-green-c text-green-a" : "bg-y50")}>
              <span className="text-sm font-medium">Counted {inr(counted)}</span>
              <span className="tabular font-semibold">{counted === report?.expected_cash ? "Balanced" : `Off by ${inr(counted - (report?.expected_cash ?? 0))}`}</span>
            </div>
            <Field label={counted === report?.expected_cash ? "Note (optional)" : "Why is it different? (required)"}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Amount (₹)"><Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="h-14 text-2xl font-semibold" /></Field>
            {form === "petty_cash" && <div className="flex flex-wrap gap-2">{CATS.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}</div>}
            <Field label={form === "bank_deposit" ? "Deposit slip no. / bank" : "Note"}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {form === "petty_cash" && <p className="text-xs text-n800">Keep the bill. Receipt photos come in the next version.</p>}
          </div>
        )}
        {err && <Alert className="mt-4">{err}</Alert>}
      </Modal>

      <PinPad open={needPin} onClose={() => setNeedPin(false)} staff={(ctx?.staff ?? []).filter((s) => s.pos_role !== "cashier")}
        title="Manager PIN" subtitle={form === "close" ? "Closing the day is done by a manager or a Frido admin." : "Petty cash and bank deposits are recorded by a manager or a Frido admin."}
        onSubmit={async (uid, p) => {
          const r = await call<{ ok: boolean; error?: string } & StaffSession>("pos_pin_login", { p_facility_id: facilityId, p_register_id: register.id, p_user_id: uid, p_pin: p });
          if (!r.ok) return r.error ?? "Wrong PIN";
          const e = await run(r.token);
          if (e) { setErr(e); setNeedPin(false); return null; }
          setNeedPin(false);
          return null;
        }} />

      <Modal open={!!z} onClose={() => setZ(null)} wide title={<span className="flex items-center gap-2">Z-report · {z?.register}</span>}
        footer={<Button variant="secondary" onClick={() => window.print()}><RiPrinterLine /> Print</Button>}>
        {z && <><p className="mb-3 text-sm text-n800">{dateTime(z.opened_at)} → {dateTime(z.closed_at)} · opened by {z.opened_by}, closed by {z.closed_by}</p><ZReport r={z} /></>}
      </Modal>
    </div>
  );
}
