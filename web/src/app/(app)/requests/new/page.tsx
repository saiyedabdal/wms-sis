"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RiDeleteBinLine, RiMagicLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { SkuPicker, useAssortment, type PickedItem } from "@/components/SkuPicker";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, NON_FG_CATEGORIES, type Bucket } from "@/lib/types";
import { errMsg, inr, priceSplit, suspiciousMrp } from "@/lib/format";

interface Line {
  item: PickedItem;
  bucket: Bucket;
  qty: number;
}

export default function NewRequestPage() {
  const router = useRouter();
  const { facilities, facility: current } = useApp();
  const targets = facilities.filter((f) => f.type !== "warehouse" && f.is_active);
  const warehouses = facilities.filter((f) => f.type === "warehouse" && f.is_active);
  const [facilityId, setFacilityId] = useState<number | null>(current?.id ?? targets[0]?.id ?? null);
  const [warehouseId, setWarehouseId] = useState<number | null>(warehouses[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [margins, setMargins] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const facility = facilities.find((f) => f.id === facilityId);
  const { rows: assortment } = useAssortment(facilityId);

  useEffect(() => {
    setLines([]);
    if (!facilityId) return;
    supabaseBrowser()
      .from("facility_category_margins")
      .select("category_name,margin_pct")
      .eq("facility_id", facilityId)
      .then(({ data }) => setMargins(Object.fromEntries((data ?? []).map((m) => [m.category_name, Number(m.margin_pct)]))));
  }, [facilityId]);

  const priceOf = (it: PickedItem) => {
    const msp = Number(it.msp ?? it.mrp ?? 0);
    const margin = it.margin_pct ?? margins[it.category_name ?? ""] ?? Number(facility?.default_margin_pct ?? 0);
    return { msp, margin: Number(margin), gst: Number(it.gst_pct ?? 18) };
  };

  const addItem = (it: PickedItem, qty = 1) => {
    // assortment entries carry price overrides; prefer them when picking from the full master
    const a = assortment.find((x) => x.sku === it.sku);
    const item = a ?? it;
    const bucket = item.default_bucket ?? "sellable";
    setLines((ls) => {
      const i = ls.findIndex((l) => l.item.sku === item.sku && l.bucket === bucket);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l));
      return [...ls, { item, bucket, qty }];
    });
  };

  const suggest = async () => {
    if (!facilityId) return;
    const sb = supabaseBrowser();
    const [{ data: mm }, { data: bal }, { data: open }] = await Promise.all([
      sb.from("facility_assortment").select("sku,max_qty,default_bucket").eq("facility_id", facilityId).eq("is_active", true).gt("max_qty", 0),
      sb.from("stock_balances").select("sku,bucket,qty").eq("facility_id", facilityId),
      sb.from("v_request_lines").select("sku,bucket,requested_qty,received_qty,damaged_qty,request_status").eq("facility_id", facilityId).in("request_status", ["raised", "partially_dispatched", "dispatched"]),
    ]);
    const next: Line[] = [];
    for (const m of mm ?? []) {
      const onHand = (bal ?? []).filter((b) => b.sku === m.sku && b.bucket === m.default_bucket).reduce((s, b) => s + b.qty, 0);
      const pending = (open ?? []).filter((o) => o.sku === m.sku && o.bucket === m.default_bucket).reduce((s, o) => s + Math.max((o.requested_qty ?? 0) - (o.received_qty ?? 0) - (o.damaged_qty ?? 0), 0), 0);
      const need = m.max_qty - onHand - pending;
      const it = assortment.find((a) => a.sku === m.sku);
      if (need > 0 && it) next.push({ item: it, bucket: m.default_bucket, qty: need });
    }
    setLines(next);
    if (!next.length) setErr("Everything is at or above max (including stock already on the way). Set min/max in Facilities → Assortment.");
  };

  const totals = useMemo(
    () =>
      lines.reduce(
        (t, l) => {
          const p = priceOf(l.item);
          const s = priceSplit(p.msp, p.margin, p.gst, l.qty);
          return { qty: t.qty + l.qty, total: t.total + s.total, gst: t.gst + s.gst };
        },
        { qty: 0, total: 0, gst: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, margins, facility],
  );

  const submit = async () => {
    if (!facilityId || !lines.length) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabaseBrowser().rpc("create_order_request", {
      p_facility_id: facilityId,
      p_warehouse_id: warehouseId as number,
      p_notes: (notes || null) as string,
      p_lines: lines.map((l) => ({ sku: l.item.sku, bucket: l.bucket, qty: l.qty })),
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(`/requests/${data}`);
  };

  const restricted = facility?.restrict_to_assortment;

  return (
    <>
      <PageHeader title="New order request" subtitle="Creates the request for the warehouse and the PO for Finance" back={{ href: "/requests", label: "Order requests" }} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Request for">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Facility">
                <Select value={facilityId ?? ""} onChange={(e) => setFacilityId(Number(e.target.value))}>
                  {targets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} · {f.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From warehouse">
                <Select value={warehouseId ?? ""} onChange={(e) => setWarehouseId(Number(e.target.value) || null)}>
                  {warehouses.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card
            title="SKUs"
            actions={
              restricted && (
                <Button variant="ghost" size="sm" onClick={suggest}>
                  <RiMagicLine size={14} /> Suggest from min/max
                </Button>
              )
            }
            pad={false}
          >
            <div className="border-b border-n300 p-5">
              {restricted ? (
                <SkuPicker onPick={(it) => addItem(it)} options={assortment} placeholder={`Search ${assortment.length} SKUs in this facility's assortment`} />
              ) : (
                <SkuPicker onPick={(it) => addItem(it)} excludeCategories={NON_FG_CATEGORIES} />
              )}
            </div>
            {lines.length === 0 ? (
              <Empty title="No SKUs added">{restricted && assortment.length === 0 ? "This facility has no assortment yet — add SKUs under Facilities first." : "Search above to add SKUs."}</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th>Purpose</Th>
                    <Th right>Qty</Th>
                    <Th right>MSP</Th>
                    <Th right>Margin</Th>
                    <Th right>Line total</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const p = priceOf(l.item);
                    return (
                      <tr key={l.item.sku + l.bucket}>
                        <Td>
                          <div className="font-medium">{l.item.name}</div>
                          <div className="text-xs text-n800">
                            {l.item.sku} {suspiciousMrp(p.msp) && <Badge tone="red">check MSP</Badge>}
                          </div>
                        </Td>
                        <Td>
                          <Select className="h-9 w-36" value={l.bucket} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, bucket: e.target.value as Bucket } : x)))}>
                            {BUCKETS.filter((b) => b.value !== "damaged").map((b) => (
                              <option key={b.value} value={b.value}>
                                {b.label}
                              </option>
                            ))}
                          </Select>
                        </Td>
                        <Td right>
                          <Input
                            type="number"
                            min={1}
                            value={l.qty}
                            className="ml-auto h-9 w-20 text-right"
                            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))}
                          />
                        </Td>
                        <Td right>{inr(p.msp)}</Td>
                        <Td right>{p.margin}%</Td>
                        <Td right>{inr(priceSplit(p.msp, p.margin, p.gst, l.qty).total)}</Td>
                        <Td right>
                          <button className="text-n700 hover:text-red-a" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove">
                            <RiDeleteBinLine size={16} />
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Summary">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-n800">SKUs</dt>
                <dd className="font-medium tabular">{lines.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-n800">Units</dt>
                <dd className="font-medium tabular">{totals.qty}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-n800">GST included</dt>
                <dd className="font-medium tabular">{inr(totals.gst)}</dd>
              </div>
              <div className="flex justify-between border-t border-n300 pt-3 text-base">
                <dt className="font-semibold">PO value</dt>
                <dd className="font-semibold tabular">{inr(totals.total)}</dd>
              </div>
            </dl>
            <Field label="Notes for warehouse" className="mt-5">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. deliver before Saturday" />
            </Field>
            {err && (
              <div className="mt-4">
                <Alert>{err}</Alert>
              </div>
            )}
            <Button className="mt-5 w-full" onClick={submit} disabled={busy || !lines.length}>
              {busy ? "Creating…" : "Create request + PO"}
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}
