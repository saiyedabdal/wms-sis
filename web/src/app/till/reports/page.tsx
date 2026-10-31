"use client";

import { useCallback, useEffect, useState } from "react";
import { RiDownload2Line } from "@remixicon/react";
import { usePos } from "@/lib/pos/context";
import { sb } from "@/lib/pos/supabase";
import { addDays, inr, inr0, istDay, modeLabel, num } from "@/lib/pos/format";
import { Button, Card, Field, Input, Segmented, Spinner, Stat } from "@/components/pos/ui";

interface Report {
  kpi: { orders: number; gross_qty: number; returned_qty: number; net_qty: number; gross_sales: number; returned_sales: number; net_sales: number;
         discount_total: number; new_customers: number; returning_customers: number; avg_bill: number };
  by_day: { day: string; orders: number; qty: number; sales: number }[];
  by_sku: { sku: string; name: string; category: string; qty: number; sales: number; returned_qty: number }[];
  by_category: { category: string; qty: number; sales: number }[];
  by_staff: { name: string; orders: number; sales: number; discount: number }[];
  by_therapist: { name: string; kind: string | null; orders: number; sales: number }[];
  by_mode: { mode: string; confirmed: number | null; pending: number; count: number }[];
  refunds: { pending: number; paid: number };
}

/** Sales by day: one series, one hue (DS blue B300, validated on white), bars anchored to the baseline. */
function DayBars({ from, to, rows }: { from: string; to: string; rows: Report["by_day"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days: { day: string; sales: number; orders: number }[] = [];
  for (let d = from; d <= to && days.length < 92; d = addDays(d, 1)) {
    const r = rows.find((x) => x.day === d);
    days.push({ day: d, sales: r?.sales ?? 0, orders: r?.orders ?? 0 });
  }
  const max = Math.max(...days.map((d) => d.sales), 1);
  const label = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div>
      <div className="relative flex h-48 items-end gap-[2px] border-b border-n400" role="img" aria-label="Net sales by day; the table below has the figures">
        {days.map((d, i) => (
          <div key={d.day} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover(i)}>
            <div className="w-full max-w-10 rounded-t-[4px] bg-[#307fe2] transition-opacity" style={{ height: `${(d.sales / max) * 100}%`, opacity: hover === null || hover === i ? 1 : 0.45, minHeight: d.sales ? 2 : 0 }} />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-sm bg-ink px-3 py-2 text-xs text-white shadow-[var(--shadow-sheet)]">
                <div className="font-semibold">{label(d.day)}</div>
                <div className="tabular">{inr(d.sales)} · {d.orders} order{d.orders === 1 ? "" : "s"}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-n800"><span>{label(from)}</span><span>{label(to)}</span></div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-n300 text-left text-[11px] uppercase tracking-wider text-n800">{head.map((h, i) => <th key={h} className={`py-2 ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-n300">
        {rows.length === 0 ? <tr><td colSpan={head.length} className="py-3 text-n800">Nothing in this period</td></tr>
          : rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`py-2 ${j ? "tabular text-right" : ""}`}>{c}</td>)}</tr>)}
      </tbody>
    </table>
  );
}

export default function ReportsPage() {
  const { ctx, facilityId, call } = usePos();
  const today = istDay();
  const [preset, setPreset] = useState<"today" | "7" | "30" | "month">("7");
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [r, setR] = useState<Report | null>(null);

  useEffect(() => {
    if (preset === "today") { setFrom(today); setTo(today); }
    if (preset === "7") { setFrom(addDays(today, -6)); setTo(today); }
    if (preset === "30") { setFrom(addDays(today, -29)); setTo(today); }
    if (preset === "month") { setFrom(`${today.slice(0, 8)}01`); setTo(today); }
  }, [preset, today]);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setR(null);
    setR(await call<Report>("pos_report", { p_facility_id: facilityId, p_from: from, p_to: to }));
  }, [facilityId, from, to, call]);
  useEffect(() => { load(); }, [load]);

  const exportXlsx = async () => {
    if (!r) return;
    const XLSX = await import("xlsx");
    const { data: inv } = await sb().from("pos_invoices").select("invoice_no,invoiced_at,customer_name,customer_phone,customer_gstin,gross_total,discount_total,taxable_total,cgst_total,sgst_total,igst_total,round_off,grand_total")
      .eq("facility_id", facilityId!).eq("status", "paid").gte("invoiced_at", `${from}T00:00:00+05:30`).lte("invoiced_at", `${to}T23:59:59+05:30`).order("invoiced_at");
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: object[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "no data" }]), name);
    add("Summary", Object.entries(r.kpi).map(([k, v]) => ({ metric: k.replace(/_/g, " "), value: v })));
    add("By day", r.by_day);
    add("By product", r.by_sku);
    add("By category", r.by_category);
    add("By staff", r.by_staff);
    add("By therapist", r.by_therapist);
    add("Payments", r.by_mode.map((m) => ({ mode: modeLabel[m.mode] ?? m.mode, received: m.confirmed ?? 0, pending: m.pending, payments: m.count })));
    add("Invoices", (inv as object[]) ?? []);
    XLSX.writeFile(wb, `frido-pos-${ctx?.facility?.code}-${from}-to-${to}.xlsx`);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-n800">{ctx?.facility?.name} · sales after returns, by invoice date (IST)</p>
        </div>
        <Button variant="secondary" onClick={exportXlsx} disabled={!r}><RiDownload2Line /> Export to Excel</Button>
      </div>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Segmented value={preset} onChange={setPreset} options={[{ value: "today", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "month", label: "This month" }]} />
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10" /></Field>
        <Field label="To"><Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-10" /></Field>
      </div>

      {!r ? <div className="flex justify-center p-10"><Spinner /></div> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Net sales" value={inr0(r.kpi.net_sales)} sub={`${inr0(r.kpi.gross_sales)} sold − ${inr0(r.kpi.returned_sales)} returned`} />
            <Stat label="Orders" value={num(r.kpi.orders)} sub={`avg bill ${inr0(r.kpi.avg_bill)}`} />
            <Stat label="Units" value={num(r.kpi.net_qty)} sub={`${num(r.kpi.gross_qty)} sold · ${num(r.kpi.returned_qty)} returned`} />
            <Stat label="Customers" value={`${num(r.kpi.new_customers)} new`} sub={`${num(r.kpi.returning_customers)} returning`} />
          </div>
          <Card title="Net sales by day"><DayBars from={from} to={to} rows={r.by_day} /></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top products"><Table head={["Product", "Sold", "Returned", "Sales"]} rows={r.by_sku.slice(0, 10).map((s) => [`${s.name} · ${s.sku}`, s.qty, s.returned_qty, inr(s.sales)])} /></Card>
            <Card title="By category"><Table head={["Category", "Units", "Sales"]} rows={r.by_category.map((c) => [c.category, c.qty, inr(c.sales)])} /></Card>
            <Card title="By staff"><Table head={["Staff", "Orders", "Discount given", "Sales"]} rows={r.by_staff.map((s) => [s.name, s.orders, inr(s.discount), inr(s.sales)])} /></Card>
            <Card title="Referred by (therapist / doctor)"><Table head={["Referral", "Orders", "Sales"]} rows={r.by_therapist.map((t) => [t.name, t.orders, inr(t.sales)])} /></Card>
            <Card title="Payment reconciliation"><Table head={["Mode", "Payments", "Received", "Pending"]} rows={r.by_mode.map((m) => [modeLabel[m.mode] ?? m.mode, m.count, inr(m.confirmed ?? 0), m.pending ? inr(m.pending) : "—"])} /></Card>
            <Card title="Daily figures"><Table head={["Day", "Orders", "Units", "Sales"]} rows={r.by_day.map((d) => [d.day, d.orders, d.qty, inr(d.sales)])} /></Card>
          </div>
          <p className="text-xs text-n800">Discounts given: {inr(r.kpi.discount_total)} · Refunds: {inr(r.refunds.pending)} waiting to be paid, {inr(r.refunds.paid)} paid.</p>
        </div>
      )}
    </div>
  );
}
