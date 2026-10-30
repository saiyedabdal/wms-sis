"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiSearchLine } from "@remixicon/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Bucket, Item } from "@/lib/types";
import { inr } from "@/lib/format";
import { Badge, Input } from "./ui";

export type PickedItem = Item & { default_bucket?: Bucket; msp?: number | null; margin_pct?: number | null };

const ITEM_COLS = "sku,name,category_name,size,color,scan_identifier,ean,hsn_code,gst_pct,mrp,cost_price,item_type,enabled";

/** Assortment of a facility joined with item details (small list, loaded once). */
export function useAssortment(facilityId: number | null | undefined) {
  const [rows, setRows] = useState<PickedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    if (!facilityId) return setRows([]);
    setLoading(true);
    const { data } = await supabaseBrowser()
      .from("facility_assortment")
      .select(`default_bucket,msp,margin_pct,min_qty,max_qty,is_active,items(${ITEM_COLS})`)
      .eq("facility_id", facilityId)
      .eq("is_active", true);
    setRows(
      (data ?? []).map((r: Record<string, unknown>) => ({
        ...(r.items as Item),
        default_bucket: r.default_bucket as Bucket,
        msp: r.msp as number | null,
        margin_pct: r.margin_pct as number | null,
      })),
    );
    setLoading(false);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId]);
  return { rows, loading, reload };
}

/** Resolve a scanned barcode / typed code to an item (scan identifier, SKU or EAN). */
export async function findByCode(code: string): Promise<Item | null> {
  const c = code.trim();
  if (!c) return null;
  const sb = supabaseBrowser();
  const { data } = await sb.from("items").select(ITEM_COLS).or(`scan_identifier.eq.${c},sku.eq.${c},ean.eq.${c}`).limit(1);
  return (data?.[0] as Item) ?? null;
}

/**
 * Search box for SKUs. With `options` it filters that list locally (e.g. a facility assortment);
 * otherwise it searches the whole enabled item master.
 */
export function SkuPicker({
  onPick,
  options,
  placeholder = "Search SKU or product name",
  excludeCategories,
}: {
  onPick: (item: PickedItem) => void;
  options?: PickedItem[];
  placeholder?: string;
  excludeCategories?: string[];
}) {
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<PickedItem[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (options || q.trim().length < 2) {
      setRemote([]);
      return;
    }
    const t = setTimeout(async () => {
      const term = q.trim().replace(/[%,()]/g, " ");
      let query = supabaseBrowser()
        .from("items")
        .select(ITEM_COLS)
        .eq("enabled", true)
        .or(`sku.ilike.%${term}%,name.ilike.%${term}%`)
        .order("name")
        .limit(30);
      if (excludeCategories?.length) query = query.not("category_name", "in", `(${excludeCategories.map((c) => `"${c}"`).join(",")})`);
      const { data } = await query;
      setRemote((data ?? []) as PickedItem[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q, options, excludeCategories]);

  const results = useMemo(() => {
    if (!options) return remote;
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => o.sku.toLowerCase().includes(t) || o.name.toLowerCase().includes(t)) : options;
    return list.slice(0, 50);
  }, [options, remote, q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <RiSearchLine size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-n700" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="pl-9"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-md border border-n300 bg-white shadow-lg">
          {results.map((it) => (
            <li key={it.sku}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-y50"
                onClick={() => {
                  onPick(it);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{it.name}</span>
                  <span className="block text-xs text-n800">
                    {it.sku}
                    {it.category_name ? ` · ${it.category_name}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-n800">
                  {inr(it.msp ?? it.mrp)}
                  {!it.enabled && (
                    <span className="ml-1">
                      <Badge tone="red">disabled</Badge>
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && options && q && results.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-n300 bg-white px-3 py-3 text-sm text-n800 shadow-lg">
          Not in this facility&apos;s assortment. Add it under Facilities → Assortment.
        </div>
      )}
    </div>
  );
}
