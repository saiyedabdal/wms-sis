"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiArrowLeftRightLine, RiDownload2Line, RiHistoryLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { Alert, Button, Card, Empty, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, bucketLabel, type Bucket } from "@/lib/types";
import { dateTime, errMsg, inr, num } from "@/lib/format";
import { downloadXlsx } from "@/lib/export";

interface Row {
  facility_code?: string;
  sku: string;
  item_name: string;
  category_name: string | null;
  bucket: Bucket;
  qty: number;
  msp: number;
  value_msp: number;
  min_qty: number | null;
  enabled: boolean;
}

interface Ledger {
  id: number;
  bucket: Bucket;
  qty_delta: number;
  movement: string;
  ref_no: string | null;
  note: string | null;
  created_at: string;
}

export default function StockPage() {
  const { facility, isOps } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<"all" | Bucket>("all");
  const [hist, setHist] = useState<{ sku: string; rows: Ledger[] } | null>(null);
  const [move, setMove] = useState<{ sku: string; from: Bucket; to: Bucket; qty: number; note: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [allFac, setAllFac] = useState(false);

  const load = useCallback(async () => {
    if (!facility) return;
    let query = supabaseBrowser().from("v_stock").select("facility_id,facility_code,sku,item_name,category_name,bucket,qty,msp,value_msp,min_qty,enabled").gt("qty", 0).order("item_name");
    if (!allFac) query = query.eq("facility_id", facility.id);
    const { data } = await query;
    setRows((data ?? []) as Row[]);
  }, [facility, allFac]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const t = q.toLowerCase();
    return rows.filter((r) => (bucket === "all" || r.bucket === bucket) && (!t || r.sku.toLowerCase().includes(t) || r.item_name.toLowerCase().includes(t)));
  }, [rows, q, bucket]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.bucket] = (t[r.bucket] ?? 0) + r.qty;
    return t;
  }, [rows]);

  const openHistory = async (sku: string) => {
    if (!facility) return;
    const { data } = await supabaseBrowser().from("stock_ledger").select("id,bucket,qty_delta,movement,ref_no,note,created_at").eq("facility_id", facility.id).eq("sku", sku).order("created_at", { ascending: false }).limit(100);
    setHist({ sku, rows: (data ?? []) as Ledger[] });
  };

  const doMove = async () => {
    if (!facility || !move) return;
    setErr(null);
    const { error } = await supabaseBrowser().rpc("move_stock", { p_facility_id: facility.id, p_sku: move.sku, p_from: move.from, p_to: move.to, p_qty: move.qty, p_note: (move.note || null) as string });
    if (error) return setErr(errMsg(error));
    setMove(null);
    load();
  };

  const quarantine = rows.filter((r) => r.bucket === "quarantine");

  const resolve = async (r: Row, action: "accept" | "return", qty: number) => {
    if (!facility) return;
    setErr(null);
    const { error } = await supabaseBrowser().rpc("resolve_quarantine", {
      p_facility_id: facility.id,
      p_sku: r.sku,
      p_qty: qty,
      p_action: action,
      p_bucket: "sellable",
      p_to_facility_id: null as unknown as number,
      p_note: null as unknown as string,
    });
    if (error) return setErr(errMsg(error));
    load();
  };

  if (!facility) return null;
  return (
    <>
      <PageHeader
        title="Stock on hand"
        subtitle={allFac ? "All facilities" : facility.name}
        actions={
          <>
            {isOps && (
              <Button variant="ghost" onClick={() => setAllFac((x) => !x)}>
                {allFac ? "This facility only" : "All facilities"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                downloadXlsx(`stock-${allFac ? "all" : facility.code}-${new Date().toISOString().slice(0, 10)}`, {
                  Stock: shown.map((r) => ({
                    Facility: r.facility_code,
                    SKU: r.sku,
                    Product: r.item_name,
                    Category: r.category_name,
                    Bucket: bucketLabel(r.bucket),
                    Qty: r.qty,
                    MSP: Number(r.msp),
                    "Value (MSP)": Number(r.value_msp),
                  })),
                })
              }
            >
              <RiDownload2Line size={16} /> Excel
            </Button>
          </>
        }
      />
      {!allFac && quarantine.length > 0 && (
        <Card
          title={`Quarantine · ${quarantine.reduce((s, r) => s + r.qty, 0)} units outside a shipment`}
          className="mb-6 border-y75"
          pad={false}
        >
          <Table>
            <tbody>
              {quarantine.map((r) => (
                <tr key={r.sku}>
                  <Td>
                    <div className="font-medium">{r.item_name}</div>
                    <div className="text-xs text-n800">{r.sku}</div>
                  </Td>
                  <Td right className="font-semibold">
                    {r.qty}
                  </Td>
                  <Td right>
                    {isOps ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => resolve(r, "accept", r.qty)}>
                          Accept into stock
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => resolve(r, "return", r.qty)}>
                          Send back
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-n800">Waiting for Frido to decide</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {BUCKETS.map((b) => (
          <Stat key={b.value} label={b.label} value={num(totals[b.value])} tone={b.value === "sellable" ? "yellow" : undefined} />
        ))}
      </div>
      {err && (
        <div className="mb-4">
          <Alert>{err}</Alert>
        </div>
      )}
      {move && (
        <Card title={`Move ${move.sku}`} className="mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <Select value={move.from} onChange={(e) => setMove({ ...move, from: e.target.value as Bucket })} className="w-40">
              {BUCKETS.map((b) => (
                <option key={b.value} value={b.value}>
                  From {b.label}
                </option>
              ))}
            </Select>
            <Select value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value as Bucket })} className="w-40">
              {BUCKETS.map((b) => (
                <option key={b.value} value={b.value}>
                  To {b.label}
                </option>
              ))}
            </Select>
            <Input type="number" min={1} value={move.qty} onChange={(e) => setMove({ ...move, qty: Number(e.target.value) })} className="w-24" />
            <Input value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} placeholder="Note (e.g. put on display)" className="w-64" />
            <Button onClick={doMove}>Move</Button>
            <Button variant="ghost" onClick={() => setMove(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {hist && (
        <Card title={`Movements · ${hist.sku}`} className="mb-6" pad={false} actions={<Button variant="ghost" size="sm" onClick={() => setHist(null)}>Close</Button>}>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Movement</Th>
                <Th>Bucket</Th>
                <Th right>Qty</Th>
                <Th>Document</Th>
              </tr>
            </thead>
            <tbody>
              {hist.rows.map((l) => (
                <tr key={l.id}>
                  <Td>{dateTime(l.created_at)}</Td>
                  <Td className="capitalize">{l.movement.replace(/_/g, " ")}</Td>
                  <Td>{bucketLabel(l.bucket)}</Td>
                  <Td right className={l.qty_delta > 0 ? "text-green-a" : "text-red-a"}>
                    {l.qty_delta > 0 ? `+${l.qty_delta}` : l.qty_delta}
                  </Td>
                  <Td>
                    {l.ref_no ?? "—"}
                    {l.note && <div className="text-xs text-n800">{l.note}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Card
        pad={false}
        actions={
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-48" />
            <Select value={bucket} onChange={(e) => setBucket(e.target.value as typeof bucket)} className="h-9 w-40">
              <option value="all">All buckets</option>
              {BUCKETS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </>
        }
        title={`${shown.length} lines`}
      >
        {shown.length === 0 ? (
          <Empty title="No stock">Receive a shipment or post an opening stock count.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                {allFac && <Th>Facility</Th>}
                <Th>Product</Th>
                <Th>Bucket</Th>
                <Th right>Qty</Th>
                <Th right>MSP</Th>
                <Th right>Value</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.facility_code}${r.sku}${r.bucket}`}>
                  {allFac && <Td>{r.facility_code}</Td>}
                  <Td>
                    <div className="font-medium">{r.item_name}</div>
                    <div className="text-xs text-n800">
                      {r.sku} · {r.category_name ?? "—"}
                    </div>
                  </Td>
                  <Td>{bucketLabel(r.bucket)}</Td>
                  <Td right className={r.bucket === "sellable" && r.min_qty && r.qty < r.min_qty ? "font-semibold text-red-a" : "font-semibold"}>
                    {r.qty}
                  </Td>
                  <Td right>{inr(r.msp)}</Td>
                  <Td right>{inr(r.value_msp)}</Td>
                  <Td right>
                    {!allFac && (
                      <div className="flex justify-end gap-3">
                        <button className="text-n700 hover:text-ink" title="Move between buckets" onClick={() => setMove({ sku: r.sku, from: r.bucket, to: r.bucket === "sellable" ? "display" : "sellable", qty: 1, note: "" })}>
                          <RiArrowLeftRightLine size={16} />
                        </button>
                        <button className="text-n700 hover:text-ink" title="Movement history" onClick={() => openHistory(r.sku)}>
                          <RiHistoryLine size={16} />
                        </button>
                      </div>
                    )}
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
