"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiDeleteBinLine } from "@remixicon/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, type Bucket } from "@/lib/types";
import { inr } from "@/lib/format";
import { findByCode, SkuPicker, type PickedItem } from "./SkuPicker";
import { ScanInput } from "./ScanInput";
import { Alert, Empty, Input, Select, Table, Td, Th } from "./ui";

export interface StockRow {
  sku: string;
  item_name: string;
  bucket: Bucket;
  qty: number;
  msp: number;
}

export interface OutLine {
  sku: string;
  name: string;
  bucket: Bucket;
  qty: number;
  msp: number;
  reason?: string;
}

export function useStock(facilityId: number | null | undefined) {
  const [rows, setRows] = useState<StockRow[]>([]);
  const reload = useCallback(async () => {
    if (!facilityId) return setRows([]);
    const { data } = await supabaseBrowser().from("v_stock").select("sku,item_name,bucket,qty,msp").eq("facility_id", facilityId).gt("qty", 0).order("item_name");
    setRows((data ?? []) as StockRow[]);
  }, [facilityId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { rows, reload };
}

/**
 * Pick SKUs out of a facility's stock (sales, issues, returns). Quantities are capped at what is on hand
 * in the chosen bucket; the database rejects anything that would go negative anyway.
 */
export function StockLineEditor({
  facilityId,
  lines,
  setLines,
  buckets = ["sellable", "display", "in_use"],
  defaultBucket = "sellable",
  withReason,
  showPrice,
}: {
  facilityId: number;
  lines: OutLine[];
  setLines: (fn: (ls: OutLine[]) => OutLine[]) => void;
  buckets?: Bucket[];
  defaultBucket?: Bucket;
  withReason?: boolean;
  showPrice?: boolean;
}) {
  const { rows } = useStock(facilityId);
  const [flash, setFlash] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const onHand = useCallback((sku: string, b: Bucket) => rows.find((r) => r.sku === sku && r.bucket === b)?.qty ?? 0, [rows]);

  const options = useMemo(() => {
    const seen = new Map<string, PickedItem>();
    for (const r of rows) {
      if (!buckets.includes(r.bucket) || seen.has(r.sku)) continue;
      seen.set(r.sku, { sku: r.sku, name: r.item_name, mrp: r.msp, msp: r.msp } as PickedItem);
    }
    return [...seen.values()];
  }, [rows, buckets]);

  const add = useCallback(
    (sku: string, name: string) => {
      const inBuckets = buckets.filter((b) => onHand(sku, b) > 0);
      if (!inBuckets.length) {
        setFlash({ tone: "red", text: `${sku} is not in stock here` });
        return;
      }
      const bucket = inBuckets.includes(defaultBucket) ? defaultBucket : inBuckets[0];
      const msp = rows.find((r) => r.sku === sku)?.msp ?? 0;
      setLines((ls) => {
        const i = ls.findIndex((l) => l.sku === sku && l.bucket === bucket);
        if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: Math.min(l.qty + 1, onHand(sku, bucket)) } : l));
        return [...ls, { sku, name, bucket, qty: 1, msp: Number(msp) }];
      });
      setFlash({ tone: "green", text: `+1 ${sku}` });
    },
    [buckets, defaultBucket, onHand, rows, setLines],
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onScan = useCallback(
    async (code: string) => {
      const local = rowsRef.current.find((r) => r.sku === code);
      if (local) return add(local.sku, local.item_name);
      const item = await findByCode(code);
      if (!item) return setFlash({ tone: "red", text: `Unknown barcode ${code}` });
      add(item.sku, item.name);
    },
    [add],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ScanInput onScan={onScan} />
        <SkuPicker options={options} onPick={(it) => add(it.sku, it.name)} placeholder={`Search ${options.length} SKUs in stock`} />
      </div>
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      {lines.length === 0 ? (
        <Empty title="No items yet">Scan a barcode or search stock above.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>From</Th>
              <Th right>On hand</Th>
              <Th right>Qty</Th>
              {showPrice && <Th right>MSP</Th>}
              {withReason && <Th>Reason</Th>}
              <Th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const max = onHand(l.sku, l.bucket);
              return (
                <tr key={l.sku + l.bucket}>
                  <Td>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-n800">{l.sku}</div>
                  </Td>
                  <Td>
                    <Select
                      className="h-9 w-36"
                      value={l.bucket}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, bucket: e.target.value as Bucket, qty: Math.min(x.qty, onHand(x.sku, e.target.value as Bucket)) } : x)))}
                    >
                      {BUCKETS.filter((b) => buckets.includes(b.value)).map((b) => (
                        <option key={b.value} value={b.value} disabled={onHand(l.sku, b.value) === 0}>
                          {b.label} ({onHand(l.sku, b.value)})
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td right>{max}</Td>
                  <Td right>
                    <Input
                      type="number"
                      min={1}
                      max={max}
                      value={l.qty}
                      className="ml-auto h-9 w-20 text-right"
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.min(Number(e.target.value), max)) } : x)))}
                    />
                  </Td>
                  {showPrice && <Td right>{inr(l.msp * l.qty)}</Td>}
                  {withReason && (
                    <Td>
                      <Input value={l.reason ?? ""} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} className="h-9 w-40" placeholder="Reason" />
                    </Td>
                  )}
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
    </div>
  );
}
