"use client";

import { useEffect, useMemo, useState } from "react";
import { RiDeleteBinLine, RiMagicLine } from "@remixicon/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, NON_FG_CATEGORIES, type Bucket, type Facility } from "@/lib/types";
import { errMsg, inr, priceSplit, suspiciousMrp } from "@/lib/format";
import { SkuPicker, useAssortment, type PickedItem } from "./SkuPicker";
import { Alert, Badge, Button, Empty, Input, Select, Table, Td, Th } from "./ui";

export interface ReqLine {
  sku: string;
  name: string;
  category_name: string | null;
  gst_pct: number | null;
  mrp: number | null;
  /** assortment overrides; null = item MRP / category margin */
  msp: number | null;
  margin_pct: number | null;
  bucket: Bucket;
  qty: number;
  suggested_qty: number | null;
  plan?: { on_hand: number; in_transit: number; pending: number; sold_30d: number };
}

interface Suggestion {
  sku: string;
  item_name: string;
  category_name: string | null;
  bucket: Bucket;
  on_hand: number;
  in_transit: number;
  pending: number;
  sold_30d: number;
  suggested_qty: number;
}

export const toPayload = (lines: ReqLine[]) =>
  lines.filter((l) => l.qty > 0).map((l) => ({ sku: l.sku, bucket: l.bucket, qty: l.qty, suggested_qty: l.suggested_qty }));

/**
 * Request lines with live partner pricing. "Fill from plan" loads the demand engine's suggestions
 * (velocity x lead/review/safety days x season, within min/max, net of stock on hand and on the way).
 */
export function RequestLinesEditor({
  facility,
  lines,
  setLines,
  autoFill,
}: {
  facility: Facility;
  lines: ReqLine[];
  setLines: (fn: (ls: ReqLine[]) => ReqLine[]) => void;
  autoFill?: boolean;
}) {
  const { rows: assortment } = useAssortment(facility.id);
  const [margins, setMargins] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ tone: "red" | "blue"; text: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  // a super stockist may stock anything its retailers carry, so it searches the full catalogue
  const restricted = facility.restrict_to_assortment && facility.type !== "super_stockist";

  useEffect(() => {
    supabaseBrowser()
      .from("facility_category_margins")
      .select("category_name,margin_pct")
      .eq("facility_id", facility.id)
      .then(({ data }) => setMargins(Object.fromEntries((data ?? []).map((m) => [m.category_name, Number(m.margin_pct)]))));
  }, [facility.id]);

  const fromItem = (it: PickedItem, qty: number, extra?: Partial<ReqLine>): ReqLine => {
    const a = assortment.find((x) => x.sku === it.sku);
    return {
      sku: it.sku,
      name: it.name,
      category_name: it.category_name ?? null,
      gst_pct: it.gst_pct ?? null,
      mrp: it.mrp ?? null,
      msp: a?.msp ?? null,
      margin_pct: a?.margin_pct ?? null,
      bucket: a?.default_bucket ?? "sellable",
      qty,
      suggested_qty: null,
      ...extra,
    };
  };

  const add = (it: PickedItem) =>
    setLines((ls) => {
      const line = fromItem(it, 1);
      const i = ls.findIndex((l) => l.sku === line.sku && l.bucket === line.bucket);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, line];
    });

  const fillFromPlan = async () => {
    setPlanning(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("demand_suggestions", { p_facility_id: facility.id });
    setPlanning(false);
    if (error) return setMsg({ tone: "red", text: errMsg(error) });
    const rows = ((data ?? []) as Suggestion[]).filter((s) => s.suggested_qty > 0);
    if (!rows.length) {
      return setMsg({ tone: "blue", text: "Nothing to request: stock on hand plus what's on the way covers the plan. Add SKUs manually if needed." });
    }
    const { data: items } = await supabaseBrowser()
      .from("items")
      .select("sku,name,category_name,gst_pct,mrp")
      .in("sku", rows.map((r) => r.sku));
    const bySku = new Map((items ?? []).map((i) => [i.sku, i]));
    setLines(() =>
      rows.map((r) => {
        const it = bySku.get(r.sku);
        return fromItem({ ...(it as PickedItem), sku: r.sku, name: r.item_name } as PickedItem, r.suggested_qty, {
          bucket: r.bucket,
          suggested_qty: r.suggested_qty,
          plan: { on_hand: r.on_hand, in_transit: r.in_transit, pending: r.pending, sold_30d: r.sold_30d },
        });
      }),
    );
  };

  useEffect(() => {
    if (autoFill && lines.length === 0) fillFromPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFill, facility.id]);

  const priceOf = (l: ReqLine) => {
    const msp = Number(l.msp ?? l.mrp ?? 0);
    const margin = Number(l.margin_pct ?? margins[l.category_name ?? ""] ?? facility.default_margin_pct ?? 0);
    return { msp, margin, gst: Number(l.gst_pct ?? 18) };
  };

  const totals = useMemo(
    () =>
      lines.reduce(
        (t, l) => {
          const p = priceOf(l);
          const s = priceSplit(p.msp, p.margin, p.gst, l.qty);
          return { qty: t.qty + l.qty, total: t.total + s.total };
        },
        { qty: 0, total: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, margins, facility],
  );

  const patch = (i: number, p: Partial<ReqLine>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-n300 p-5 md:flex-row md:items-center">
        <div className="flex-1">
          {restricted ? (
            <SkuPicker onPick={add} options={assortment} placeholder={`Search ${assortment.length} SKUs in this facility's assortment`} />
          ) : (
            <SkuPicker onPick={add} excludeCategories={NON_FG_CATEGORIES} />
          )}
        </div>
        <Button variant="secondary" onClick={fillFromPlan} disabled={planning}>
          <RiMagicLine size={16} /> {planning ? "Planning…" : "Fill from plan"}
        </Button>
      </div>
      {msg && (
        <div className="px-5 pt-4">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      {lines.length === 0 ? (
        <Empty title="No SKUs yet">
          {restricted && assortment.length === 0 ? "This facility has no assortment yet — add SKUs under Facilities first." : "Fill from the demand plan or search above."}
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Purpose</Th>
              <Th right>Plan</Th>
              <Th right>Qty</Th>
              <Th right>MSP − margin</Th>
              <Th right>Line total</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = priceOf(l);
              return (
                <tr key={l.sku + l.bucket}>
                  <Td>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-n800">
                      {l.sku} {suspiciousMrp(p.msp) && <Badge tone="red">check MSP</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <Select className="h-9 w-36" value={l.bucket} onChange={(e) => patch(i, { bucket: e.target.value as Bucket })}>
                      {BUCKETS.filter((b) => !["damaged", "quarantine"].includes(b.value)).map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td right>
                    {l.suggested_qty != null ? (
                      <>
                        <span className="font-medium">{l.suggested_qty}</span>
                        {l.plan && (
                          <div className="text-[11px] text-n800">
                            on hand {l.plan.on_hand} · coming {l.plan.in_transit + l.plan.pending} · sold {l.plan.sold_30d}/30d
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-n700">—</span>
                    )}
                  </Td>
                  <Td right>
                    <Input
                      type="number"
                      min={0}
                      value={l.qty}
                      className="ml-auto h-9 w-20 text-right"
                      onChange={(e) => patch(i, { qty: Math.max(0, Number(e.target.value)) })}
                    />
                  </Td>
                  <Td right>
                    {inr(p.msp)}
                    <div className="text-xs text-n800">− {p.margin}%</div>
                  </Td>
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
      {lines.length > 0 && (
        <div className="flex justify-end gap-6 border-t border-n300 px-5 py-3 text-sm">
          <span className="text-n800">
            {lines.length} SKUs · {totals.qty} units
          </span>
          <span className="font-semibold tabular">{inr(totals.total)} incl. GST</span>
        </div>
      )}
    </div>
  );
}
