"use client";

import { useEffect, useMemo, useState } from "react";
import { RiDownload2Line } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { Button, Card, CopyBlock, Empty, Input, PageHeader, Select, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bucketLabel, type RequestLineView } from "@/lib/types";
import { date, inr, num } from "@/lib/format";
import { downloadXlsx } from "@/lib/export";

type Tab = "fulfilment" | "settlement";

export default function ReportsPage() {
  const { facility, facilities, isOps } = useApp();
  const [tab, setTab] = useState<Tab>("settlement");
  const [facId, setFacId] = useState<number | null>(facility?.id ?? null);
  useEffect(() => setFacId(facility?.id ?? null), [facility]);
  const fac = facilities.find((f) => f.id === facId) ?? null;

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          isOps && (
            <Select value={facId ?? ""} onChange={(e) => setFacId(Number(e.target.value))} className="w-60">
              {facilities
                .filter((f) => f.type !== "warehouse")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "settlement", label: "Sales & consignment settlement" },
          { value: "fulfilment", label: "Requested vs dispatched vs received" },
        ]}
      />
      {fac && tab === "fulfilment" && <Fulfilment facilityId={fac.id} code={fac.code} />}
      {fac && tab === "settlement" && <Settlement facilityId={fac.id} name={fac.name} code={fac.code} consignment={fac.is_consignment} />}
    </>
  );
}

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);

function Fulfilment({ facilityId, code }: { facilityId: number; code: string }) {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return monthStart(d);
  });
  const [rows, setRows] = useState<(RequestLineView & { request_status: string; created_at: string })[]>([]);

  useEffect(() => {
    supabaseBrowser()
      .from("v_request_lines")
      .select("*")
      .eq("facility_id", facilityId)
      .gte("created_at", from)
      .neq("request_status", "cancelled")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as typeof rows));
  }, [facilityId, from]);

  const t = rows.reduce(
    (a, r) => ({
      req: a.req + r.requested_qty,
      disp: a.disp + Number(r.dispatched_qty),
      recv: a.recv + Number(r.received_qty),
      dmg: a.dmg + Number(r.damaged_qty),
      sub: a.sub + Number(r.substituted_qty),
    }),
    { req: 0, disp: 0, recv: 0, dmg: 0, sub: 0 },
  );
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requested units" value={num(t.req)} />
        <Stat label="Dispatch fill rate" value={pct(Math.min(t.disp, t.req), t.req)} hint={`${num(t.disp)} dispatched · ${num(t.sub)} substituted`} tone="yellow" />
        <Stat label="Received good" value={num(t.recv)} hint={`${pct(t.recv, t.disp)} of dispatched`} />
        <Stat label="Damaged on arrival" value={num(t.dmg)} />
      </div>
      <Card
        pad={false}
        title={`${rows.length} request lines`}
        actions={
          <>
            <span className="text-xs text-n800">Since</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadXlsx(`fulfilment-${code}-${from}`, {
                  Lines: rows.map((r) => ({
                    Request: r.request_no,
                    PO: r.po_no,
                    Date: date(r.created_at),
                    Status: r.request_status,
                    SKU: r.sku,
                    Product: r.item_name,
                    Purpose: bucketLabel(r.bucket),
                    Requested: r.requested_qty,
                    Dispatched: Number(r.dispatched_qty),
                    Substituted: Number(r.substituted_qty),
                    Received: Number(r.received_qty),
                    Damaged: Number(r.damaged_qty),
                    "Pending dispatch": Number(r.pending_dispatch_qty),
                  })),
                })
              }
            >
              <RiDownload2Line size={14} /> Excel
            </Button>
          </>
        }
      >
        {rows.length === 0 ? (
          <Empty title="No requests in this period" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Product</Th>
                <Th right>Req</Th>
                <Th right>Disp</Th>
                <Th right>Recv</Th>
                <Th right>Dmg</Th>
                <Th right>Pending</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_line_id}>
                  <Td>
                    <div className="font-medium">{r.request_no}</div>
                    <div className="text-xs text-n800">{date(r.created_at)}</div>
                  </Td>
                  <Td>
                    <div>{r.item_name}</div>
                    <div className="text-xs text-n800">{r.sku}</div>
                  </Td>
                  <Td right>{r.requested_qty}</Td>
                  <Td right>{r.dispatched_qty}</Td>
                  <Td right>{r.received_qty}</Td>
                  <Td right className={Number(r.damaged_qty) ? "text-red-a" : ""}>
                    {r.damaged_qty}
                  </Td>
                  <Td right className={Number(r.pending_dispatch_qty) ? "font-semibold" : "text-n700"}>
                    {r.pending_dispatch_qty}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

interface SaleLine {
  sale_no: string;
  sold_on: string;
  sku: string;
  item_name: string;
  category_name: string | null;
  qty: number;
  msp: number;
  margin_pct: number;
  gst_pct: number;
  payable_unit: number;
  gross_msp: number;
  payable_total: number;
  payable_taxable: number;
}

function Settlement({ facilityId, name, code, consignment }: { facilityId: number; name: string; code: string; consignment: boolean }) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<SaleLine[]>([]);

  useEffect(() => {
    supabaseBrowser()
      .from("v_sales_lines")
      .select("sale_no,sold_on,sku,item_name,category_name,qty,msp,margin_pct,gst_pct,payable_unit,gross_msp,payable_total,payable_taxable")
      .eq("facility_id", facilityId)
      .eq("period", period)
      .order("sold_on")
      .then(({ data }) => setRows((data ?? []) as SaleLine[]));
  }, [facilityId, period]);

  const bySku = useMemo(() => {
    const m = new Map<string, { sku: string; name: string; qty: number; gross: number; payable: number; taxable: number; margin: number }>();
    for (const r of rows) {
      const k = `${r.sku}|${r.margin_pct}`;
      const e = m.get(k) ?? { sku: r.sku, name: r.item_name, qty: 0, gross: 0, payable: 0, taxable: 0, margin: Number(r.margin_pct) };
      e.qty += r.qty;
      e.gross += Number(r.gross_msp);
      e.payable += Number(r.payable_total);
      e.taxable += Number(r.payable_taxable);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.payable - a.payable);
  }, [rows]);

  const t = bySku.reduce((a, r) => ({ qty: a.qty + r.qty, gross: a.gross + r.gross, payable: a.payable + r.payable, taxable: a.taxable + r.taxable }), { qty: 0, gross: 0, payable: 0, taxable: 0 });
  const monthLabel = new Date(`${period}-01`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Units sold" value={num(t.qty)} />
        <Stat label="Sales at MSP" value={inr(t.gross)} />
        <Stat label="Partner margin" value={inr(t.gross - t.payable)} />
        <Stat label={consignment ? "Payable to Frido" : "Net value"} value={inr(t.payable)} hint={`Taxable ${inr(t.taxable)} + GST ${inr(t.payable - t.taxable)}`} tone="yellow" />
      </div>
      <Card
        pad={false}
        title={`Settlement · ${monthLabel}`}
        actions={
          <>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-44" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadXlsx(`settlement-${code}-${period}`, {
                  Summary: bySku.map((r) => ({ SKU: r.sku, Product: r.name, Units: r.qty, "Margin %": r.margin, "Sales at MSP": r.gross, Payable: r.payable, Taxable: r.taxable, GST: r.payable - r.taxable })),
                  Sales: rows.map((r) => ({
                    Sale: r.sale_no,
                    Date: r.sold_on,
                    SKU: r.sku,
                    Product: r.item_name,
                    Qty: r.qty,
                    MSP: Number(r.msp),
                    "Margin %": Number(r.margin_pct),
                    "Payable / unit": Number(r.payable_unit),
                    Payable: Number(r.payable_total),
                  })),
                })
              }
            >
              <RiDownload2Line size={14} /> Excel
            </Button>
          </>
        }
      >
        {bySku.length === 0 ? (
          <Empty title="No sales this month" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th right>Units</Th>
                <Th right>Margin</Th>
                <Th right>Sales at MSP</Th>
                <Th right>Payable</Th>
              </tr>
            </thead>
            <tbody>
              {bySku.map((r) => (
                <tr key={r.sku + r.margin}>
                  <Td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-n800">{r.sku}</div>
                  </Td>
                  <Td right>{r.qty}</Td>
                  <Td right>{r.margin}%</Td>
                  <Td right>{inr(r.gross)}</Td>
                  <Td right className="font-semibold">
                    {inr(r.payable)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {consignment && bySku.length > 0 && (
        <div className="mt-6">
          <CopyBlock
            title="Settlement email to Finance"
            subject={`Consignment settlement – ${name} – ${monthLabel} – ${inr(t.payable)}`}
            body={`Hi Finance Team,

Consignment sales at ${name} (${code}) for ${monthLabel}:

Units sold: ${t.qty}
Sales at MSP: ${inr(t.gross)}
Partner margin: ${inr(t.gross - t.payable)}
Payable to Frido: ${inr(t.payable)} (taxable ${inr(t.taxable)} + GST ${inr(t.payable - t.taxable)})

SKU-wise detail is in the attached Excel. Please raise the invoice to the partner.

Thanks,
STF Team, Frido`}
          />
        </div>
      )}
    </>
  );
}
