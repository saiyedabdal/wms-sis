"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { ScanInput } from "@/components/ScanInput";
import { findByCode, SkuPicker, useAssortment } from "@/components/SkuPicker";
import { Alert, Button, Card, Empty, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, NON_FG_CATEGORIES, bucketLabel, type Bucket } from "@/lib/types";
import { dateTime, errMsg } from "@/lib/format";

interface CLine {
  sku: string;
  name: string;
  bucket: Bucket;
  system: number;
  counted: number | null; // null = not counted yet
}

interface PastCount {
  id: number;
  count_no: string;
  posted_at: string;
  notes: string | null;
  stock_count_lines: { variance: number }[];
}

export default function StockCountPage() {
  const { facility } = useApp();
  const { rows: assortment } = useAssortment(facility?.id);
  const [lines, setLines] = useState<CLine[]>([]);
  const [bucket, setBucket] = useState<Bucket>("sellable");
  const [notes, setNotes] = useState("");
  const [onlyCounted, setOnlyCounted] = useState(false);
  const [past, setPast] = useState<PastCount[]>([]);
  const [flash, setFlash] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!facility) return;
    const sb = supabaseBrowser();
    const [{ data: bal }, { data: pc }] = await Promise.all([
      sb.from("v_stock").select("sku,item_name,bucket,qty").eq("facility_id", facility.id),
      sb.from("stock_counts").select("id,count_no,posted_at,notes,stock_count_lines(variance)").eq("facility_id", facility.id).order("posted_at", { ascending: false }).limit(10),
    ]);
    const map = new Map<string, CLine>();
    for (const b of (bal ?? []) as { sku: string; item_name: string; bucket: Bucket; qty: number }[]) map.set(`${b.sku}|${b.bucket}`, { sku: b.sku, name: b.item_name, bucket: b.bucket, system: b.qty, counted: null });
    for (const a of assortment) {
      const k = `${a.sku}|${a.default_bucket ?? "sellable"}`;
      if (!map.has(k)) map.set(k, { sku: a.sku, name: a.name, bucket: a.default_bucket ?? "sellable", system: 0, counted: null });
    }
    // keep anything already counted on screen (this reloads when the assortment arrives)
    setLines((prev) => {
      const counted = new Map(prev.filter((l) => l.counted !== null).map((l) => [`${l.sku}|${l.bucket}`, l]));
      for (const [k, l] of counted) map.set(k, { ...(map.get(k) ?? l), counted: l.counted });
      return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
    });
    setPast((pc ?? []) as PastCount[]);
  }, [facility, assortment]);

  useEffect(() => {
    load();
  }, [load]);

  const linesRef = useRef(lines);
  linesRef.current = lines;
  const bump = useCallback(
    (sku: string, name: string) => {
      setLines((ls) => {
        const i = ls.findIndex((l) => l.sku === sku && l.bucket === bucket);
        if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, counted: (l.counted ?? 0) + 1 } : l));
        return [...ls, { sku, name, bucket, system: 0, counted: 1 }];
      });
      setFlash({ tone: "green", text: `+1 ${sku} (${bucketLabel(bucket)})` });
    },
    [bucket],
  );

  const onScan = useCallback(
    async (code: string) => {
      const local = linesRef.current.find((l) => l.sku === code);
      if (local) return bump(local.sku, local.name);
      const item = await findByCode(code);
      if (!item) return setFlash({ tone: "red", text: `Unknown barcode ${code}` });
      bump(item.sku, item.name);
    },
    [bump],
  );

  const counted = lines.filter((l) => l.counted !== null);
  const variances = counted.filter((l) => l.counted !== l.system);
  const shown = useMemo(() => (onlyCounted ? counted : lines), [onlyCounted, counted, lines]);

  const post = async () => {
    if (!facility || !counted.length) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("post_stock_count", {
      p_facility_id: facility.id,
      p_notes: (notes || null) as string,
      p_lines: counted.map((l) => ({ sku: l.sku, bucket: l.bucket, counted_qty: l.counted })),
    });
    setBusy(false);
    if (error) return setFlash({ tone: "red", text: errMsg(error) });
    setFlash({ tone: "green", text: `Count posted. ${variances.length} line${variances.length === 1 ? "" : "s"} adjusted.` });
    setNotes("");
    setLines((ls) => ls.map((l) => ({ ...l, counted: null })));
    load();
  };

  if (!facility) return null;
  return (
    <>
      <PageHeader title="Stock count" subtitle="Open count: expected quantities are visible and stock is corrected as soon as you post. Use it for opening stock too." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Scan to count">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-sm text-n800">Counting into</span>
              <Select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)} className="h-9 w-44">
                {BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
            <ScanInput onScan={onScan} />
            <div className="mt-3">
              <SkuPicker excludeCategories={NON_FG_CATEGORIES} onPick={(it) => bump(it.sku, it.name)} placeholder="Or add a SKU by search" />
            </div>
            {flash && (
              <div className="mt-3">
                <Alert tone={flash.tone}>{flash.text}</Alert>
              </div>
            )}
          </Card>
          <Card
            title={`${counted.length} of ${lines.length} lines counted`}
            pad={false}
            actions={
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[#131313]" checked={onlyCounted} onChange={(e) => setOnlyCounted(e.target.checked)} />
                Counted only
              </label>
            }
          >
            {shown.length === 0 ? (
              <Empty title="Nothing to count yet">Scan items or add SKUs to the facility assortment.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th>Bucket</Th>
                    <Th right>Expected</Th>
                    <Th right>Counted</Th>
                    <Th right>Variance</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const v = l.counted === null ? null : l.counted - l.system;
                    return (
                      <tr key={l.sku + l.bucket}>
                        <Td>
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-n800">{l.sku}</div>
                        </Td>
                        <Td>{bucketLabel(l.bucket)}</Td>
                        <Td right>{l.system}</Td>
                        <Td right>
                          <Input
                            type="number"
                            min={0}
                            value={l.counted ?? ""}
                            placeholder="—"
                            className="ml-auto h-9 w-20 text-right"
                            onChange={(e) =>
                              setLines((ls) => ls.map((x) => (x.sku === l.sku && x.bucket === l.bucket ? { ...x, counted: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) } : x)))
                            }
                          />
                        </Td>
                        <Td right className={v ? (v > 0 ? "font-semibold text-green-a" : "font-semibold text-red-a") : "text-n700"}>
                          {v === null ? "" : v > 0 ? `+${v}` : v}
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
          <Card title="Post count">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-n800">
                {counted.length} counted · <span className={variances.length ? "font-semibold text-red-a" : ""}>{variances.length} with variance</span>. Lines left blank are not changed.
              </p>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (e.g. Opening stock 27 Oct delivery)" rows={2} />
              <Button onClick={post} disabled={busy || !counted.length}>
                {busy ? "Posting…" : "Post count"}
              </Button>
            </div>
          </Card>
          <Card title="Previous counts" pad={false}>
            {past.length === 0 ? (
              <Empty title="No counts yet" />
            ) : (
              <Table>
                <tbody>
                  {past.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <div className="font-medium">{p.count_no}</div>
                        <div className="text-xs text-n800">{dateTime(p.posted_at)}</div>
                      </Td>
                      <Td right>
                        {p.stock_count_lines.length} lines
                        <div className="text-xs text-n800">{p.stock_count_lines.filter((x) => x.variance !== 0).length} adjusted</div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
