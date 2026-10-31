"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RiArrowGoBackLine, RiFileList3Line, RiSearchLine } from "@remixicon/react";
import { usePos } from "@/lib/pos/context";
import { sb } from "@/lib/pos/supabase";
import { addDays, date, dateTime, inr, istDay, modeLabel, time } from "@/lib/pos/format";
import type { InvoiceSummary } from "@/lib/pos/types";
import { Alert, Badge, Button, Card, Chip, Empty, Field, Input, Modal, Segmented, Spinner, StatusBadge, cx, useToast } from "@/components/pos/ui";
import { ShareButtons } from "@/components/pos/sell/DoneSheet";

interface Inv {
  id: number; invoice_no: string | null; status: string; created_at: string; invoiced_at: string | null; customer_name: string | null;
  customer_phone: string | null; seller_id: string; grand_total: number; discount_total: number; share_token: string; is_b2b: boolean;
  attention_reason: string | null; therapist_id: number | null; max_disc_pct: number;
}
interface Line { id: number; line_no: number; sku: string; item_name: string; size: string | null; qty: number; returned_qty: number; unit_price: number;
  line_discount: number; cart_discount: number; net_amount: number; gst_pct: number; hsn_code: string; is_service: boolean }
interface Pay { id: number; mode: string; amount: number; status: string; reference: string | null; created_at: string }
interface Cn { id: number; credit_no: string; issued_at: string; grand_total: number; settlement: string; reason: string; share_token: string;
  redeemed_total: number; refunded_total: number }

export default function InvoicesPage() {
  const { ctx, facilityId, staff, call, register } = usePos();
  const toast = useToast();
  const [range, setRange] = useState<"today" | "7" | "30">("today");
  const [status, setStatus] = useState<"all" | "paid" | "open">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Inv[] | null>(null);
  const [sel, setSel] = useState<Inv | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [cns, setCns] = useState<Cn[]>([]);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const staffName = useMemo(() => Object.fromEntries((ctx?.staff ?? []).map((s) => [s.user_id, s.display_name])), [ctx]);

  const load = useCallback(async () => {
    if (!facilityId) return;
    const from = range === "today" ? istDay() : addDays(istDay(), -Number(range));
    const { data } = await sb().from("pos_invoices").select("*").eq("facility_id", facilityId)
      .gte("created_at", `${from}T00:00:00+05:30`).order("created_at", { ascending: false }).limit(300);
    setRows((data as Inv[]) ?? []);
  }, [facilityId, range]);
  useEffect(() => { load(); }, [load]);

  const open = async (inv: Inv) => {
    setSel(inv); setErr(null); setUtr("");
    const [l, p, c] = await Promise.all([
      sb().from("pos_invoice_lines").select("*").eq("invoice_id", inv.id).order("line_no"),
      sb().from("pos_payments").select("*").eq("invoice_id", inv.id).order("id"),
      sb().from("pos_credit_notes").select("*").eq("invoice_id", inv.id).order("id"),
    ]);
    setLines((l.data as Line[]) ?? []); setPays((p.data as Pay[]) ?? []); setCns((c.data as Cn[]) ?? []);
  };

  const shown = (rows ?? []).filter((r) => (status === "all" || (status === "paid" ? r.status === "paid" : r.status !== "paid" && r.status !== "cancelled"))
    && (!q || [r.invoice_no, r.customer_name, r.customer_phone].some((v) => v?.toLowerCase().includes(q.toLowerCase()))));
  const openCount = (rows ?? []).filter((r) => r.status === "awaiting_payment" || r.status === "needs_attention").length;
  const pendingBank = pays.find((p) => p.status === "pending" && p.mode === "bank_transfer");
  const returnable = sel?.status === "paid" && lines.some((l) => l.qty > l.returned_qty);
  const ageDays = sel?.invoiced_at ? Math.floor((Date.now() - new Date(sel.invoiced_at).getTime()) / 86400000) : 0;

  const act = async (fn: string, args: Record<string, unknown>, okMsg: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await call<InvoiceSummary>(fn, args);
      toast(okMsg);
      await load();
      setSel((s) => (s ? { ...s, status: r.status, invoice_no: r.invoice_no } : s));
      if (sel) await open({ ...sel, status: r.status, invoice_no: r.invoice_no });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-n800">{ctx?.facility?.name} · reprint, share, return or exchange</p>
        </div>
        <Segmented value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-n800" />
          <Input className="pl-10" placeholder="Invoice no., customer name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Chip active={status === "all"} onClick={() => setStatus("all")}>All</Chip>
        <Chip active={status === "paid"} onClick={() => setStatus("paid")}>Paid</Chip>
        <Chip active={status === "open"} onClick={() => setStatus("open")}>Unpaid / attention {openCount > 0 && <Badge tone="yellow">{openCount}</Badge>}</Chip>
      </div>

      <Card pad={false}>
        {rows === null ? <div className="flex justify-center p-10"><Spinner /></div> : shown.length === 0 ? (
          <Empty icon={<RiFileList3Line />} title="No invoices here">{range === "today" ? "Sales you ring up today appear here." : "Try a longer date range."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-n300 text-left text-[11px] uppercase tracking-wider text-n800">
                <tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Customer</th><th className="hidden px-4 py-3 md:table-cell">Sold by</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-n300">
                {shown.map((r) => (
                  <tr key={r.id} onClick={() => open(r)} className={cx("cursor-pointer hover:bg-n100", sel?.id === r.id && "bg-y50")}>
                    <td className="tabular px-4 py-3 font-semibold">{r.invoice_no ?? <span className="text-n800">Draft #{r.id}</span>}{r.is_b2b && <Badge tone="blue" className="ml-2">B2B</Badge>}</td>
                    <td className="tabular px-4 py-3 text-n900">{range === "today" ? time(r.invoiced_at ?? r.created_at) : dateTime(r.invoiced_at ?? r.created_at)}</td>
                    <td className="px-4 py-3">{r.customer_name ?? r.customer_phone ?? <span className="text-n700">Walk-in</span>}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{staffName[r.seller_id] ?? "—"}</td>
                    <td className="tabular px-4 py-3 text-right font-semibold">{inr(r.grand_total)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!sel} onClose={() => setSel(null)} wide title={sel?.invoice_no ? `Invoice ${sel.invoice_no}` : `Unpaid draft #${sel?.id}`}>
        {sel && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-n900">
              <StatusBadge status={sel.status} />
              <span>{dateTime(sel.invoiced_at ?? sel.created_at)}</span>·<span>{sel.customer_name ?? sel.customer_phone ?? "Walk-in"}</span>·<span>sold by {staffName[sel.seller_id] ?? "—"}</span>
              {sel.therapist_id && <>·<span>referred by {ctx?.therapists.find((t) => t.id === sel.therapist_id)?.name ?? "therapist"}</span></>}
            </div>
            {sel.attention_reason && <Alert>{sel.attention_reason}</Alert>}
            <table className="w-full text-sm">
              <tbody className="divide-y divide-n300">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2"><div className="font-semibold">{l.item_name}{l.size ? ` · ${l.size}` : ""}</div><div className="text-xs text-n800">{l.sku} · HSN {l.hsn_code} · GST {l.gst_pct}%</div></td>
                    <td className="tabular py-2 text-right">{l.qty}{l.returned_qty > 0 && <div className="text-xs text-red-a">{l.returned_qty} returned</div>}</td>
                    <td className="tabular py-2 text-right">{inr(l.net_amount)}{l.line_discount + l.cart_discount > 0 && <div className="text-xs text-n800">− {inr(l.line_discount + l.cart_discount)}</div>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-ink font-semibold"><td className="py-2">Total</td><td /><td className="tabular py-2 text-right">{inr(sel.grand_total)}</td></tr></tfoot>
            </table>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-n800">Payments</div>
              <ul className="space-y-1 text-sm">
                {pays.map((p) => <li key={p.id} className="flex items-center gap-2"><StatusBadge status={p.status} /> {modeLabel[p.mode]} <span className="text-n800">{p.reference}</span><span className="tabular ml-auto">{inr(p.amount)}</span></li>)}
              </ul>
            </div>
            {cns.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-n800">Credit notes</div>
                <ul className="space-y-1 text-sm">{cns.map((c) => (
                  <li key={c.id} className="flex items-center gap-2"><a className="tabular font-semibold underline" href={`/doc/?t=${c.share_token}`} target="_blank">{c.credit_no}</a>
                    <Badge tone="blue">{c.settlement}</Badge><span className="text-n800">{date(c.issued_at)} · {c.reason}</span><span className="tabular ml-auto">− {inr(c.grand_total)}</span></li>
                ))}</ul>
              </div>
            )}
            {pendingBank && (
              <div className="flex items-end gap-2 rounded-md bg-y50 p-3">
                <Field label="Bank transfer arrived? Enter its UTR" className="flex-1"><Input value={utr} onChange={(e) => setUtr(e.target.value)} /></Field>
                <Button size="lg" disabled={busy || utr.trim().length < 4 || !staff}
                  onClick={() => act("pos_confirm_payment", { p_payment_id: pendingBank.id, p_staff_token: staff!.token, p_reference: utr }, "Payment confirmed")}>Confirm</Button>
              </div>
            )}
            {err && <Alert>{err}</Alert>}
            {sel.status === "paid" && <ShareButtons token={sel.share_token} phone={sel.customer_phone} what={`invoice ${sel.invoice_no}`} clinic={ctx?.facility?.name ?? "Frido"} printer={register?.printer} />}
            <div className="flex flex-wrap gap-2">
              {returnable && (
                <Link href={`/till/returns/?invoice=${sel.id}`} className="inline-flex h-11 items-center gap-2 rounded-md border border-ink px-5 text-sm font-semibold uppercase tracking-wide hover:bg-n100">
                  <RiArrowGoBackLine className="h-4 w-4" /> Return / exchange
                </Link>
              )}
              {sel.status === "paid" && ctx?.settings && ageDays > ctx.settings.return_days && (
                <span className="self-center text-xs text-n800">{ageDays} days old: past the {ctx.settings.return_days}-day window, so a Frido admin must approve a return.</span>
              )}
              {sel.status === "awaiting_payment" && staff && (
                <Button variant="danger" disabled={busy} onClick={() => act("pos_cancel_invoice", { p_invoice_id: sel.id, p_staff_token: staff.token, p_reason: "Customer left without paying" }, "Draft cancelled; stock released")}>
                  Cancel draft
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
