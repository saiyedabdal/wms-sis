"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { StockLineEditor, type OutLine } from "@/components/StockLineEditor";
import { Alert, Badge, Button, Card, CopyBlock, Empty, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bucketLabel, type Bucket } from "@/lib/types";
import { COURIERS, trackingUrl } from "@/lib/couriers";
import { dateTime, errMsg } from "@/lib/format";

interface Ret {
  id: number;
  return_no: string;
  created_at: string;
  facility_id: number;
  to_facility_id: number | null;
  origin: string;
  status: string;
  courier: string | null;
  awb_no: string | null;
  carton_count: number | null;
  notes: string | null;
  wh_return_lines: { sku: string; bucket: Bucket; qty: number; reason: string | null; items: { name: string } | null }[];
}

const SELECT = "id,return_no,created_at,facility_id,to_facility_id,origin,status,courier,awb_no,carton_count,notes,wh_return_lines(sku,bucket,qty,reason,items(name))";
const ORIGIN: Record<string, string> = { stock: "From stock", rejected_at_inward: "Refused at inward", quarantine: "Quarantine (Frido decision)" };

export default function ReturnsPage() {
  const { facility, facilities, isOps } = useApp();
  const grnId = Number(useSearchParams().get("grn")) || null;
  const destinations = facilities.filter((f) => (f.type === "warehouse" || f.type === "super_stockist") && f.is_active && f.id !== facility?.id);
  const defaultTo = facility?.fulfiller_ss_id ?? destinations.find((f) => f.type === "warehouse")?.id ?? destinations[0]?.id;
  const [lines, setLines] = useState<OutLine[]>([]);
  const [h, setH] = useState({ to_facility_id: String(defaultTo ?? ""), courier: "", awb_no: "", carton_count: "", notes: "" });
  const [outgoing, setOutgoing] = useState<Ret[]>([]);
  const [incoming, setIncoming] = useState<Ret[]>([]);
  const [open, setOpen] = useState<Ret | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const name = (id: number | null) => facilities.find((f) => f.id === id)?.name ?? "Frido WH";

  const load = useCallback(async (): Promise<Ret[]> => {
    if (!facility) return [];
    const sb = supabaseBrowser();
    const [{ data: out }, { data: inc }] = await Promise.all([
      sb.from("wh_returns").select(SELECT).eq("facility_id", facility.id).order("created_at", { ascending: false }).limit(30),
      // what is on its way to me (a super stockist), or for Frido everything heading to a warehouse
      isOps
        ? sb.from("wh_returns").select(SELECT).eq("status", "in_transit").in("to_facility_id", facilities.filter((f) => f.type === "warehouse").map((f) => f.id)).order("created_at")
        : sb.from("wh_returns").select(SELECT).eq("to_facility_id", facility.id).order("created_at", { ascending: false }).limit(30),
    ]);
    const rows = (out ?? []) as unknown as Ret[];
    setOutgoing(rows);
    setIncoming((inc ?? []) as unknown as Ret[]);
    return rows;
  }, [facility, facilities, isOps]);
  useEffect(() => {
    load();
  }, [load]);

  // "Return items from this receipt" pre-fills what that receipt booked into stock
  useEffect(() => {
    if (!grnId) return;
    supabaseBrowser()
      .from("grn_lines")
      .select("sku,bucket,received_qty,quarantine_qty,damaged_qty,items(name)")
      .eq("grn_id", grnId)
      .then(({ data }) => {
        const pre: OutLine[] = [];
        for (const l of (data ?? []) as unknown as { sku: string; bucket: Bucket; received_qty: number; quarantine_qty: number; damaged_qty: number; items: { name: string } | null }[]) {
          const good = l.received_qty - l.quarantine_qty;
          if (l.damaged_qty > 0) pre.push({ sku: l.sku, name: l.items?.name ?? l.sku, bucket: "damaged", qty: l.damaged_qty, msp: 0, reason: "Damaged on arrival" });
          if (good > 0) pre.push({ sku: l.sku, name: l.items?.name ?? l.sku, bucket: l.bucket, qty: good, msp: 0 });
        }
        setLines(() => pre);
        setKey((k) => k + 1);
      });
  }, [grnId]);

  const submit = async () => {
    if (!facility) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabaseBrowser().rpc("create_wh_return", {
      p_facility_id: facility.id,
      p_header: { ...h, carton_count: h.carton_count === "" ? null : Number(h.carton_count) },
      p_lines: lines.map((l) => ({ sku: l.sku, bucket: l.bucket, qty: l.qty, reason: l.reason || null })),
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setLines(() => []);
    setKey((k) => k + 1);
    const rows = await load();
    setOpen(rows.find((r) => r.id === data) ?? null);
  };

  const receive = async (r: Ret) => {
    setErr(null);
    const { error } = await supabaseBrowser().rpc("receive_return", { p_return_id: r.id });
    if (error) setErr(errMsg(error));
    load();
  };

  const mail = (r: Ret) => {
    const body = `Hi Team,

${name(r.facility_id)} is returning the following stock to ${name(r.to_facility_id)} (${r.return_no}, ${dateTime(r.created_at)}).

${r.wh_return_lines.map((l, i) => `${i + 1}. ${l.sku} – ${l.items?.name ?? ""} × ${l.qty} (${bucketLabel(l.bucket)}${l.reason ? `: ${l.reason}` : ""})`).join("\n")}

Cartons: ${r.carton_count ?? "—"}${r.courier ? `\nCourier: ${r.courier}` : ""}${r.awb_no ? `\nAWB / docket: ${r.awb_no}` : ""}${r.notes ? `\nNotes: ${r.notes}` : ""}

Please acknowledge on receipt.

Thanks,
STF Team, Frido`;
    return { subject: `Stock return ${r.return_no} – ${name(r.facility_id)}`, body };
  };

  const list = (rows: Ret[], mode: "out" | "in") => (
    <Table>
      <thead>
        <tr>
          <Th>Return</Th>
          <Th>{mode === "out" ? "To" : "From"}</Th>
          <Th>When</Th>
          <Th>Items</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const url = trackingUrl(r.courier, r.awb_no);
          return (
            <tr key={r.id}>
              <Td>
                <div className="font-medium">{r.return_no}</div>
                <div className="text-xs text-n800">{ORIGIN[r.origin]}</div>
              </Td>
              <Td>{mode === "out" ? name(r.to_facility_id) : name(r.facility_id)}</Td>
              <Td>{dateTime(r.created_at)}</Td>
              <Td className="text-xs">
                {r.wh_return_lines.map((l) => `${l.sku} × ${l.qty}`).join(", ")}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer" className="ml-2 text-blue hover:underline">
                    track
                  </a>
                )}
              </Td>
              <Td>
                <StatusBadge status={r.status} />
              </Td>
              <Td right>
                {mode === "in" && r.status === "in_transit" ? (
                  <Button size="sm" onClick={() => receive(r)}>
                    Receive
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setOpen(r)}>
                    Email
                  </Button>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );

  if (!facility) return null;
  return (
    <>
      <PageHeader title="Returns" subtitle="Send damaged, slow-moving or wrong stock back to Frido WH or your super stockist. Stock leaves this facility when you save." />
      {grnId && <Alert tone="blue">Pre-filled from the receipt. Remove what you're keeping.</Alert>}
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <Card title="Items to return" className="lg:col-span-2">
          <StockLineEditor
            key={key}
            facilityId={facility.id}
            lines={lines}
            setLines={setLines}
            buckets={isOps ? ["damaged", "sellable", "display", "in_use", "quarantine"] : ["damaged", "sellable", "display", "in_use"]}
            defaultBucket="damaged"
            withReason
          />
        </Card>
        <Card title="Shipment">
          <div className="grid gap-4">
            <Field label="Return to">
              <Select value={h.to_facility_id} onChange={(e) => setH({ ...h, to_facility_id: e.target.value })}>
                {destinations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.type === "super_stockist" ? "(super stockist)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Courier">
                <Select value={h.courier} onChange={(e) => setH({ ...h, courier: e.target.value })}>
                  <option value="">—</option>
                  {COURIERS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="AWB / docket">
                <Input value={h.awb_no} onChange={(e) => setH({ ...h, awb_no: e.target.value })} />
              </Field>
            </div>
            <Field label="Cartons">
              <Input type="number" min={0} value={h.carton_count} onChange={(e) => setH({ ...h, carton_count: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
            </Field>
            {err && <Alert>{err}</Alert>}
            <Button onClick={submit} disabled={busy || !lines.length}>
              {busy ? "Saving…" : "Create return"}
            </Button>
          </div>
        </Card>
      </div>
      {open && (
        <div className="mt-6">
          <CopyBlock title={`Email for ${open.return_no}`} {...mail(open)} />
        </div>
      )}
      {(isOps || facility.type === "super_stockist") && (
        <Card
          title={
            <span className="flex items-center gap-2">
              {isOps ? "Coming back to Frido WH" : "Coming back to you"}
              {incoming.filter((r) => r.status === "in_transit").length > 0 && <Badge tone="yellow">{incoming.filter((r) => r.status === "in_transit").length} to receive</Badge>}
            </span>
          }
          pad={false}
          className="mt-6"
        >
          {incoming.length === 0 ? <Empty title="Nothing on its way" /> : list(incoming, "in")}
        </Card>
      )}
      <Card title="Sent from this facility" pad={false} className="mt-6">
        {outgoing.length === 0 ? <Empty title="No returns yet" /> : list(outgoing, "out")}
      </Card>
    </>
  );
}
