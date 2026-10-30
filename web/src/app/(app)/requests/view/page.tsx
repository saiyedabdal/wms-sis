"use client";

import { paths, useIdParam } from "@/lib/paths";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RiDownload2Line, RiFilePdf2Line, RiTruckLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { Alert, Badge, Button, Card, CopyBlock, Empty, LinkButton, PageHeader, StatusBadge, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bucketLabel, type RequestLineView } from "@/lib/types";
import { date, errMsg, inr, num } from "@/lib/format";
import { downloadPoPdf, financePoEmail, poTotals, warehouseRequestEmail } from "@/lib/documents";
import { downloadXlsx } from "@/lib/export";

interface Req {
  id: number;
  request_no: string;
  po_no: string;
  status: string;
  notes: string | null;
  created_at: string;
  facility_id: number;
  warehouse_id: number | null;
}

interface Shipment {
  id: number;
  shipment_no: string;
  status: string;
  dispatched_at: string;
  uniware_ref: string | null;
  invoice_no: string | null;
  carton_count: number | null;
  shipment_lines: { sku: string; qty: number; is_substitute: boolean }[];
  grns: { id: number; grn_no: string; has_discrepancy: boolean }[] | { id: number; grn_no: string; has_discrepancy: boolean } | null;
}

export default function RequestDetail() {
  const id = useIdParam();
  const { facilities } = useApp();
  const [req, setReq] = useState<Req | null>(null);
  const [lines, setLines] = useState<RequestLineView[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [tab, setTab] = useState<"lines" | "warehouse" | "finance" | "shipments">("lines");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [r, l, s] = await Promise.all([
      sb.from("order_requests").select("*").eq("id", Number(id)).single(),
      sb.from("v_request_lines").select("*").eq("request_id", Number(id)).order("request_line_id"),
      sb.from("shipments").select("id,shipment_no,status,dispatched_at,uniware_ref,invoice_no,carton_count,shipment_lines(sku,qty,is_substitute),grns(id,grn_no,has_discrepancy)").eq("request_id", Number(id)).order("created_at"),
    ]);
    setReq(r.data as Req);
    setLines((l.data ?? []) as RequestLineView[]);
    setShipments((s.data ?? []) as Shipment[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const facility = facilities.find((f) => f.id === req?.facility_id);
  if (!req || !facility) return <Empty title="Loading…" />;

  const t = poTotals(lines);
  const disp = lines.reduce((s, l) => s + Number(l.dispatched_qty), 0);
  const recv = lines.reduce((s, l) => s + Number(l.received_qty), 0);
  const wh = warehouseRequestEmail(req, facility, lines);
  const fin = financePoEmail(req, facility, lines);
  const warehouse = facilities.find((f) => f.id === req.warehouse_id);
  const canDispatch = !["closed", "cancelled"].includes(req.status);

  const setState = async (status: "closed" | "cancelled" | "raised") => {
    setErr(null);
    const { error } = await supabaseBrowser().rpc("set_request_state", { p_request_id: req.id, p_status: status });
    if (error) setErr(errMsg(error));
    load();
  };

  const grnOf = (s: Shipment) => (Array.isArray(s.grns) ? s.grns[0] : s.grns);

  return (
    <>
      <PageHeader
        title={req.request_no}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {facility.name} · PO {req.po_no} · {date(req.created_at)} <StatusBadge status={req.status} />
          </span>
        }
        back={{ href: "/requests", label: "Order requests" }}
        actions={
          <>
            <Button variant="secondary" onClick={() => downloadPoPdf(req, facility, lines)}>
              <RiFilePdf2Line size={16} /> PO PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadXlsx(req.request_no, {
                  Request: lines.map((l, i) => ({
                    "#": i + 1,
                    SKU: l.sku,
                    Product: l.item_name,
                    Size: l.size,
                    Colour: l.color,
                    Purpose: bucketLabel(l.bucket),
                    Qty: l.requested_qty,
                    MSP: Number(l.msp),
                    "Margin %": Number(l.margin_pct),
                    "Unit price": Number(l.unit_price),
                    "GST %": Number(l.gst_pct),
                    Taxable: Number(l.line_taxable),
                    GST: Number(l.line_gst),
                    Total: Number(l.line_total),
                    Dispatched: Number(l.dispatched_qty),
                    Received: Number(l.received_qty),
                    Damaged: Number(l.damaged_qty),
                  })),
                })
              }
            >
              <RiDownload2Line size={16} /> Excel
            </Button>
            {canDispatch && (
              <LinkButton href={paths.dispatch(req.id)}>
                <RiTruckLine size={16} /> Record dispatch
              </LinkButton>
            )}
          </>
        }
      />
      {err && (
        <div className="mb-4">
          <Alert>{err}</Alert>
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requested" value={num(t.qty)} hint={`${lines.length} SKUs`} />
        <Stat label="Dispatched" value={num(disp)} hint={`${shipments.length} shipment${shipments.length === 1 ? "" : "s"}`} />
        <Stat label="Received good" value={num(recv)} />
        <Stat label="PO value" value={inr(t.total)} hint={`incl. ${inr(t.gst)} GST`} tone="yellow" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "lines", label: "Lines & tracking" },
          { value: "warehouse", label: "Email to warehouse" },
          { value: "finance", label: "PO email to Finance" },
          { value: "shipments", label: `Shipments (${shipments.length})` },
        ]}
      />

      {tab === "lines" && (
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Purpose</Th>
                <Th right>Req</Th>
                <Th right>Disp</Th>
                <Th right>Recv</Th>
                <Th right>Dmg</Th>
                <Th right>Pending</Th>
                <Th right>Unit price</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.request_line_id}>
                  <Td>
                    <div className="font-medium">{l.item_name}</div>
                    <div className="text-xs text-n800">
                      {l.sku} {Number(l.substituted_qty) > 0 && <Badge tone="yellow">{l.substituted_qty} substituted</Badge>}
                    </div>
                  </Td>
                  <Td>{bucketLabel(l.bucket)}</Td>
                  <Td right>{l.requested_qty}</Td>
                  <Td right>{l.dispatched_qty}</Td>
                  <Td right>{l.received_qty}</Td>
                  <Td right className={Number(l.damaged_qty) ? "text-red-a" : ""}>
                    {l.damaged_qty}
                  </Td>
                  <Td right className={Number(l.pending_dispatch_qty) ? "font-semibold" : "text-n700"}>
                    {l.pending_dispatch_qty}
                  </Td>
                  <Td right>
                    {inr(l.unit_price)}
                    <div className="text-xs text-n800">
                      MSP {inr(l.msp)} − {Number(l.margin_pct)}%
                    </div>
                  </Td>
                  <Td right>{inr(l.line_total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-n300 p-4">
            <p className="text-xs text-n800">{req.notes ? `Notes: ${req.notes}` : "Partner price = MSP − margin, GST inclusive."}</p>
            <div className="flex gap-2">
              {req.status === "raised" && (
                <Button variant="danger" size="sm" onClick={() => setState("cancelled")}>
                  Cancel request
                </Button>
              )}
              {["partially_dispatched", "dispatched", "received"].includes(req.status) && (
                <Button variant="ghost" size="sm" onClick={() => setState("closed")}>
                  Close (no more dispatches)
                </Button>
              )}
              {["closed", "cancelled"].includes(req.status) && (
                <Button variant="ghost" size="sm" onClick={() => setState("raised")}>
                  Reopen
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {tab === "warehouse" && <CopyBlock title="Paste into your mail to the warehouse" to={warehouse?.contact_email ?? ""} subject={wh.subject} body={wh.body} />}
      {tab === "finance" && (
        <div className="flex flex-col gap-4">
          <Alert tone="blue">Download the PO PDF above and attach it to this mail.</Alert>
          <CopyBlock title="Paste into your mail to Finance" subject={fin.subject} body={fin.body} />
        </div>
      )}

      {tab === "shipments" && (
        <Card pad={false}>
          {shipments.length === 0 ? (
            <Empty title="Nothing dispatched yet">Use “Record dispatch” once the warehouse ships from Uniware.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Shipment</Th>
                  <Th>Dispatched</Th>
                  <Th>Uniware / invoice</Th>
                  <Th right>Units</Th>
                  <Th right>Cartons</Th>
                  <Th>Receipt</Th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => {
                  const g = grnOf(s);
                  return (
                    <tr key={s.id}>
                      <Td className="font-medium">
                        {s.shipment_no}
                        {s.shipment_lines.some((x) => x.is_substitute) && (
                          <span className="ml-2">
                            <Badge tone="yellow">has substitutes</Badge>
                          </span>
                        )}
                      </Td>
                      <Td>{date(s.dispatched_at)}</Td>
                      <Td>{[s.uniware_ref, s.invoice_no].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td right>{s.shipment_lines.reduce((a, x) => a + x.qty, 0)}</Td>
                      <Td right>{s.carton_count ?? "—"}</Td>
                      <Td>
                        {g ? (
                          <Link href={paths.grn(g.id)} className="hover:underline">
                            {g.grn_no} {g.has_discrepancy ? <Badge tone="red">discrepancy</Badge> : <Badge tone="green">ok</Badge>}
                          </Link>
                        ) : (
                          <StatusBadge status={s.status} />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
