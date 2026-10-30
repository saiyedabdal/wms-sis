"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { StockLineEditor, type OutLine } from "@/components/StockLineEditor";
import { Alert, Button, Card, CopyBlock, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bucketLabel, type Bucket } from "@/lib/types";
import { dateTime, errMsg } from "@/lib/format";

interface Ret {
  id: number;
  return_no: string;
  created_at: string;
  courier: string | null;
  awb_no: string | null;
  carton_count: number | null;
  notes: string | null;
  wh_return_lines: { sku: string; bucket: Bucket; qty: number; reason: string | null; items: { name: string } | null }[];
}

export default function ReturnsPage() {
  const { facility, facilities } = useApp();
  const warehouses = facilities.filter((f) => f.type === "warehouse" && f.is_active);
  const [lines, setLines] = useState<OutLine[]>([]);
  const [h, setH] = useState({ warehouse_id: String(warehouses[0]?.id ?? ""), courier: "", awb_no: "", carton_count: "", notes: "" });
  const [past, setPast] = useState<Ret[]>([]);
  const [open, setOpen] = useState<Ret | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  const load = useCallback(async (): Promise<Ret[]> => {
    if (!facility) return [];
    const { data } = await supabaseBrowser()
      .from("wh_returns")
      .select("id,return_no,created_at,courier,awb_no,carton_count,notes,wh_return_lines(sku,bucket,qty,reason,items(name))")
      .eq("facility_id", facility.id)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as unknown as Ret[];
    setPast(rows);
    return rows;
  }, [facility]);
  useEffect(() => {
    load();
  }, [load]);

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

  const mail = (r: Ret) => {
    const body = `Hi Team,

${facility?.name} is returning the following stock to the warehouse (${r.return_no}, ${dateTime(r.created_at)}).

${r.wh_return_lines.map((l, i) => `${i + 1}. ${l.sku} – ${l.items?.name ?? ""} × ${l.qty} (${bucketLabel(l.bucket)}${l.reason ? `: ${l.reason}` : ""})`).join("\n")}

Cartons: ${r.carton_count ?? "—"}${r.courier ? `\nCourier: ${r.courier}` : ""}${r.awb_no ? `\nAWB / docket: ${r.awb_no}` : ""}${r.notes ? `\nNotes: ${r.notes}` : ""}

Please acknowledge on receipt.

Thanks,
STF Team, Frido`;
    return { subject: `Stock return ${r.return_no} – ${facility?.name}`, body };
  };

  if (!facility) return null;
  return (
    <>
      <PageHeader title="Return to warehouse" subtitle="Send back damaged or slow-moving stock. Stock leaves this facility when you save." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Items to return" className="lg:col-span-2">
          <StockLineEditor key={key} facilityId={facility.id} lines={lines} setLines={setLines} buckets={["damaged", "sellable", "display", "in_use"]} defaultBucket="damaged" withReason />
        </Card>
        <Card title="Shipment">
          <div className="grid gap-4">
            <Field label="To warehouse">
              <Select value={h.warehouse_id} onChange={(e) => setH({ ...h, warehouse_id: e.target.value })}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Courier">
                <Input value={h.courier} onChange={(e) => setH({ ...h, courier: e.target.value })} />
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
      <Card title="Past returns" pad={false} className="mt-6">
        {past.length === 0 ? (
          <Empty title="No returns yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Return</Th>
                <Th>When</Th>
                <Th>Items</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.return_no}</Td>
                  <Td>{dateTime(r.created_at)}</Td>
                  <Td className="text-xs">{r.wh_return_lines.map((l) => `${l.sku} × ${l.qty}`).join(", ")}</Td>
                  <Td right>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(r)}>
                      Email
                    </Button>
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
