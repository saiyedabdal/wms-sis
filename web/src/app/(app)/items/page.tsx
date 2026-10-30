"use client";

import Papa from "papaparse";
import { useEffect, useState } from "react";
import { RiUploadCloud2Line } from "@remixicon/react";
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Item } from "@/lib/types";
import { dateTime, errMsg, inr, num } from "@/lib/format";

interface ImportRow {
  id: number;
  file_name: string | null;
  total_rows: number;
  inserted: number;
  updated: number;
  disabled: number;
  status: string;
  created_at: string;
}

const CHUNK = 1500;

export default function ItemsPage() {
  const sb = supabaseBrowser();
  const [q, setQ] = useState("");
  const [enabled, setEnabled] = useState<"all" | "true" | "false">("true");
  const [items, setItems] = useState<Item[]>([]);
  const [count, setCount] = useState(0);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [disableMissing, setDisableMissing] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);

  const loadImports = async () => {
    const { data } = await sb.from("item_imports").select("*").order("created_at", { ascending: false }).limit(10);
    setImports((data ?? []) as ImportRow[]);
  };

  useEffect(() => {
    loadImports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = sb.from("items").select("sku,name,category_name,size,color,scan_identifier,ean,hsn_code,gst_pct,mrp,cost_price,item_type,enabled", { count: "exact" }).order("name").limit(100);
      const term = q.trim().replace(/[%,()]/g, " ");
      if (term) query = query.or(`sku.ilike.%${term}%,name.ilike.%${term}%,category_name.ilike.%${term}%`);
      if (enabled !== "all") query = query.eq("enabled", enabled === "true");
      const { data, count: c } = await query;
      setItems((data ?? []) as Item[]);
      setCount(c ?? 0);
    }, 250);
    return () => clearTimeout(t);
  }, [q, enabled, sb, progress]);

  const runImport = async () => {
    if (!file) return;
    setMsg(null);
    setProgress("Reading file…");
    const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve, reject) =>
      Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: resolve, error: reject }),
    );
    const rows = parsed.data;
    if (!rows.length || !("Product Code" in rows[0])) {
      setProgress(null);
      return setMsg({ tone: "red", text: "This doesn't look like a Uniware item master export (no “Product Code” column)." });
    }
    try {
      const { data: importId, error } = await sb.rpc("start_item_import", { p_file_name: file.name, p_total_rows: rows.length });
      if (error) throw error;
      // keep all rows of a SKU (bundle components) in one chunk
      const chunks: Record<string, string>[][] = [];
      let cur: Record<string, string>[] = [];
      let last = "";
      for (const r of rows) {
        if (cur.length >= CHUNK && r["Product Code"] !== last) {
          chunks.push(cur);
          cur = [];
        }
        cur.push(r);
        last = r["Product Code"];
      }
      if (cur.length) chunks.push(cur);
      for (let i = 0; i < chunks.length; i++) {
        setProgress(`Uploading ${i + 1} / ${chunks.length}…`);
        const { error: e } = await sb.rpc("import_items_chunk", { p_import_id: importId, p_rows: chunks[i] });
        if (e) throw e;
      }
      setProgress("Finishing…");
      const { data: res, error: e2 } = await sb.rpc("finish_item_import", { p_import_id: importId, p_disable_missing: disableMissing });
      if (e2) throw e2;
      const r = res as unknown as ImportRow;
      setMsg({ tone: "green", text: `Done: ${num(r.inserted)} new, ${num(r.updated)} updated, ${num(r.disabled)} disabled.` });
      setFile(null);
    } catch (e) {
      setMsg({ tone: "red", text: errMsg(e) });
    }
    setProgress(null);
    loadImports();
  };

  return (
    <>
      <PageHeader title="Item master" subtitle="Synced from the Uniware item master export. SKUs are never deleted; missing ones are disabled." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Upload Uniware export" className="lg:col-span-1">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-n800">Uniware → Products → Export “Item Master” as CSV, then upload it here each morning.</p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-n500 bg-n50 px-4 py-8 text-center hover:border-ink">
              <RiUploadCloud2Line className="text-n800" />
              <span className="text-sm font-medium">{file ? file.name : "Choose CSV file"}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[#131313]" checked={disableMissing} onChange={(e) => setDisableMissing(e.target.checked)} />
              Full export: disable SKUs not in this file
            </label>
            <Button onClick={runImport} disabled={!file || !!progress}>
              {progress ?? "Import"}
            </Button>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">Recent imports</p>
              <ul className="flex flex-col gap-2 text-xs">
                {imports.map((i) => (
                  <li key={i.id} className="rounded-sm bg-n100 px-3 py-2">
                    <div className="font-medium">{dateTime(i.created_at)} · {i.status}</div>
                    <div className="truncate text-n800">{i.file_name}</div>
                    <div className="text-n800">
                      +{num(i.inserted)} new · {num(i.updated)} updated · {num(i.disabled)} disabled
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
        <Card
          title={`${num(count)} SKUs`}
          pad={false}
          className="lg:col-span-2"
          actions={
            <>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name, category" className="h-9 w-56" />
              <Select value={enabled} onChange={(e) => setEnabled(e.target.value as typeof enabled)} className="h-9 w-32">
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
                <option value="all">All</option>
              </Select>
            </>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th>HSN / GST</Th>
                <Th right>MRP</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.sku}>
                  <Td className="font-medium">{i.sku}</Td>
                  <Td className="max-w-80 truncate">{i.name}</Td>
                  <Td>{i.category_name ?? "—"}</Td>
                  <Td className="text-xs">
                    {i.hsn_code ?? "—"} · {i.gst_pct != null ? `${Number(i.gst_pct)}%` : "—"}
                  </Td>
                  <Td right>{inr(i.mrp)}</Td>
                  <Td>
                    {i.item_type === "BUNDLE" && <Badge tone="blue">Bundle</Badge>} {!i.enabled && <Badge tone="red">Disabled</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {count > items.length && <p className="px-4 py-3 text-xs text-n800">Showing first {items.length}. Refine the search to narrow down.</p>}
        </Card>
      </div>
    </>
  );
}
