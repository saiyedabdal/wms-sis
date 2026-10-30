"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiCameraLine } from "@remixicon/react";
import { ScanInput } from "@/components/ScanInput";
import { findByCode } from "@/components/SkuPicker";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, REASONS, type Bucket, type Reason } from "@/lib/types";
import { date, errMsg } from "@/lib/format";

interface Ship {
  id: number;
  shipment_no: string;
  facility_id: number;
  status: string;
  dispatched_at: string;
  uniware_ref: string | null;
  invoice_no: string | null;
  dc_no: string | null;
  dn_no: string | null;
  carton_count: number | null;
  order_requests: { request_no: string } | null;
}

interface GLine {
  key: string;
  shipment_line_id: number | null;
  sku: string;
  name: string;
  expected: number;
  received: number;
  damaged: number;
  bucket: Bucket;
  reason: Reason | "";
  notes: string;
  substitute: boolean;
  photos: File[];
}

const autoReason = (l: GLine): Reason => {
  if (!l.shipment_line_id) return "wrong_sku";
  if (l.damaged > 0) return "damaged";
  if (l.received + l.damaged < l.expected) return "short";
  if (l.received + l.damaged > l.expected) return "excess";
  return "ok";
};

export default function ReceiveShipment() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const router = useRouter();
  const [ship, setShip] = useState<Ship | null>(null);
  const [lines, setLines] = useState<GLine[]>([]);
  const [h, setH] = useState({ dn_no: "", invoice_no: "", dc_no: "", gate_pass_no: "", cartons_received: "", notes: "" });
  const [flash, setFlash] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: s } = await sb
        .from("shipments")
        .select("id,shipment_no,facility_id,status,dispatched_at,uniware_ref,invoice_no,dc_no,dn_no,carton_count,order_requests(request_no)")
        .eq("id", Number(shipmentId))
        .single();
      if (!s) return;
      setH((x) => ({ ...x, dn_no: s.dn_no ?? "", invoice_no: s.invoice_no ?? "", dc_no: s.dc_no ?? "", gate_pass_no: s.uniware_ref ?? "" }));
      const { data: sl } = await sb
        .from("shipment_lines")
        .select("id,sku,qty,is_substitute,items(name),order_request_lines(bucket)")
        .eq("shipment_id", Number(shipmentId))
        .order("id");
      setLines(
        (sl ?? []).map((l: Record<string, unknown>) => ({
          key: `s${l.id}`,
          shipment_line_id: l.id as number,
          sku: l.sku as string,
          name: (l.items as { name: string } | null)?.name ?? (l.sku as string),
          expected: l.qty as number,
          received: 0,
          damaged: 0,
          bucket: ((l.order_request_lines as { bucket: Bucket } | null)?.bucket ?? "sellable") as Bucket,
          reason: "",
          notes: "",
          substitute: l.is_substitute as boolean,
          photos: [],
        })),
      );
      setShip(s as unknown as Ship);
    })();
  }, [shipmentId]);

  const patch = (key: string, p: Partial<GLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const linesRef = useRef<GLine[]>([]);
  linesRef.current = lines;

  const onScan = useCallback(async (code: string) => {
    const bump = (sku: string) => setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, received: l.received + 1 } : l)));
    if (linesRef.current.some((l) => l.sku === code)) {
      bump(code);
      return setFlash({ tone: "green", text: `+1 ${code}` });
    }
    const item = await findByCode(code);
    if (!item) return setFlash({ tone: "red", text: `Unknown barcode ${code}` });
    if (linesRef.current.some((l) => l.sku === item.sku)) bump(item.sku);
    else
      setLines((ls) => [
        ...ls,
        { key: `x${item.sku}`, shipment_line_id: null, sku: item.sku, name: item.name, expected: 0, received: 1, damaged: 0, bucket: "sellable", reason: "", notes: "", substitute: false, photos: [] },
      ]);
    setFlash({ tone: "green", text: `+1 ${item.sku}` });
  }, []);

  const submit = async () => {
    if (!ship) return;
    setBusy(true);
    setErr(null);
    const sb = supabaseBrowser();
    const { data: grnId, error } = await sb.rpc("post_grn", {
      p_shipment_id: ship.id,
      p_header: { ...h, cartons_received: h.cartons_received === "" ? null : Number(h.cartons_received) },
      p_lines: lines.map((l) => ({
        shipment_line_id: l.shipment_line_id,
        sku: l.sku,
        bucket: l.bucket,
        received_qty: l.received,
        damaged_qty: l.damaged,
        reason: l.reason || null,
        notes: l.notes || null,
      })),
    });
    if (error) {
      setBusy(false);
      return setErr(errMsg(error));
    }
    // attach photos to their GRN lines
    const withPhotos = lines.filter((l) => l.photos.length);
    if (withPhotos.length) {
      const { data: gl } = await sb.from("grn_lines").select("id,sku,shipment_line_id").eq("grn_id", grnId);
      for (const l of withPhotos) {
        const target = gl?.find((g) => (l.shipment_line_id ? g.shipment_line_id === l.shipment_line_id : g.sku === l.sku && !g.shipment_line_id));
        for (const f of l.photos) {
          const path = `${ship.facility_id}/${grnId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, "_")}`;
          const up = await sb.storage.from("grn-photos").upload(path, f);
          if (!up.error) await sb.rpc("add_grn_photo", { p_grn_id: grnId, p_grn_line_id: (target?.id ?? null) as number, p_path: path });
        }
      }
    }
    router.push(`/receive/grn/${grnId}`);
  };

  if (!ship) return <Empty title="Loading…" />;
  if (ship.status !== "in_transit") return <Empty title="This shipment has already been received" />;

  const sent = lines.reduce((s, l) => s + l.expected, 0);
  const got = lines.reduce((s, l) => s + l.received + l.damaged, 0);

  return (
    <>
      <PageHeader
        title={`Receive ${ship.shipment_no}`}
        subtitle={`${ship.order_requests?.request_no} · dispatched ${date(ship.dispatched_at)}${ship.carton_count != null ? ` · ${ship.carton_count} cartons` : ""}`}
        back={{ href: "/receive", label: "Receive" }}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Scan items">
            <ScanInput onScan={onScan} />
            {flash && (
              <div className="mt-3">
                <Alert tone={flash.tone}>{flash.text}</Alert>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-n800">
                Counted <span className="font-semibold text-ink tabular">{got}</span> of {sent} dispatched
              </p>
              <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.map((l) => (l.shipment_line_id ? { ...l, received: l.expected, damaged: 0 } : l)))}>
                Fill all as dispatched
              </Button>
            </div>
          </Card>

          <Card title="Lines" pad={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th right>Sent</Th>
                  <Th right>Good</Th>
                  <Th right>Damaged</Th>
                  <Th>Into</Th>
                  <Th>Issue</Th>
                  <Th>Note / photo</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const r = l.reason || autoReason(l);
                  return (
                    <tr key={l.key} className={r !== "ok" ? "bg-red-c/40" : ""}>
                      <Td>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-n800">
                          {l.sku} {l.substitute && <Badge tone="yellow">substitute</Badge>}
                          {!l.shipment_line_id && <Badge tone="red">not dispatched</Badge>}
                        </div>
                      </Td>
                      <Td right>{l.expected}</Td>
                      <Td right>
                        <Input type="number" min={0} value={l.received} onChange={(e) => patch(l.key, { received: Math.max(0, Number(e.target.value)) })} className="ml-auto h-9 w-20 text-right" />
                      </Td>
                      <Td right>
                        <Input type="number" min={0} value={l.damaged} onChange={(e) => patch(l.key, { damaged: Math.max(0, Number(e.target.value)) })} className="ml-auto h-9 w-20 text-right" />
                      </Td>
                      <Td>
                        <Select value={l.bucket} onChange={(e) => patch(l.key, { bucket: e.target.value as Bucket })} className="h-9 w-32">
                          {BUCKETS.filter((b) => b.value !== "damaged").map((b) => (
                            <option key={b.value} value={b.value}>
                              {b.label}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        <Select value={l.reason} onChange={(e) => patch(l.key, { reason: e.target.value as Reason | "" })} className="h-9 w-32">
                          <option value="">Auto: {REASONS.find((x) => x.value === autoReason(l))?.label}</option>
                          {REASONS.map((x) => (
                            <option key={x.value} value={x.value}>
                              {x.label}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Input value={l.notes} onChange={(e) => patch(l.key, { notes: e.target.value })} className="h-9 w-36" placeholder="Note" />
                          <label className="flex cursor-pointer items-center gap-1 text-xs text-n800 hover:text-ink" title="Add photos">
                            <RiCameraLine size={16} />
                            {l.photos.length > 0 && l.photos.length}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              className="hidden"
                              onChange={(e) => patch(l.key, { photos: [...l.photos, ...Array.from(e.target.files ?? [])] })}
                            />
                          </label>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card title="Receipt details">
          <div className="grid gap-4">
            <Field label="DN no.">
              <Input value={h.dn_no} onChange={(e) => setH({ ...h, dn_no: e.target.value })} />
            </Field>
            <Field label="Invoice no.">
              <Input value={h.invoice_no} onChange={(e) => setH({ ...h, invoice_no: e.target.value })} />
            </Field>
            <Field label="DC no.">
              <Input value={h.dc_no} onChange={(e) => setH({ ...h, dc_no: e.target.value })} />
            </Field>
            <Field label="Gate pass no.">
              <Input value={h.gate_pass_no} onChange={(e) => setH({ ...h, gate_pass_no: e.target.value })} />
            </Field>
            <Field label="Cartons received" hint={ship.carton_count != null ? `${ship.carton_count} dispatched` : undefined}>
              <Input type="number" min={0} value={h.cartons_received} onChange={(e) => setH({ ...h, cartons_received: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
            </Field>
            {err && <Alert>{err}</Alert>}
            <Button onClick={submit} disabled={busy}>
              {busy ? "Posting…" : "Post receipt"}
            </Button>
            <p className="text-xs text-n800">Good units go into stock; damaged units go to the Damaged bucket for return.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
