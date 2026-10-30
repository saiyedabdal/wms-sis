"use client";

import { RiImageLine, RiSearchLine, RiStethoscopeLine } from "@remixicon/react";
import { inr0 } from "@/lib/format";
import type { CatalogItem } from "@/lib/types";
import { Badge, Chip, Empty, cx } from "../ui";

export function stockBadge(item: CatalogItem, inCart = 0) {
  if (item.is_service) return <Badge tone="blue">Service</Badge>;
  if (!item.sale_ready) return <Badge tone="red">{item.msp == null ? "No price" : !item.hsn_code ? "No HSN" : "Fix GST"}</Badge>;
  const left = item.sellable_qty - inCart;
  if (left <= 0) return <Badge tone="red">{inCart ? "All in cart" : "Out of stock"}</Badge>;
  if (left <= 2) return <Badge tone="yellow">Only {left} left</Badge>;
  return <Badge tone="green">{left} in stock</Badge>;
}

/** Searchable, filterable product grid for tablets; one tap adds to the cart. */
export function ProductGrid({ items, query, category, onCategory, onAdd, inCart }: {
  items: CatalogItem[];
  query: string;
  category: string;
  onCategory: (c: string) => void;
  onAdd: (item: CatalogItem) => void;
  inCart: Record<string, number>;
}) {
  const cats = ["All", ...Array.from(new Set(items.map((i) => i.category_name ?? "Other"))).sort()];
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) =>
    (category === "All" || (i.category_name ?? "Other") === category) &&
    (!q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.size ?? "").toLowerCase() === q || (i.color ?? "").toLowerCase().includes(q)));

  return (
    <div className="flex flex-col gap-3">
      <div className="no-scrollbar -mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1">
        {cats.map((c) => <Chip key={c} active={c === category} onClick={() => onCategory(c)}>{c}</Chip>)}
      </div>
      {shown.length === 0 ? (
        <Empty icon={<RiSearchLine />} title={q ? `Nothing matches “${query}”` : "No products here"}>
          {q ? "Check the barcode or try part of the name. Only this clinic's assortment can be sold." : "This clinic's assortment is empty. Frido ops add SKUs in the Partner Hub."}
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((i) => {
            const blocked = !i.sale_ready || (!i.is_service && i.sellable_qty - (inCart[i.sku] ?? 0) <= 0);
            return (
              <button key={i.sku} type="button" onClick={() => onAdd(i)}
                className={cx("group flex flex-col overflow-hidden rounded-lg border bg-white text-left shadow-[var(--shadow-card)] transition active:scale-[0.98]",
                  blocked ? "border-n300 opacity-60" : "border-n300 hover:border-ink", !!inCart[i.sku] && "ring-2 ring-yellow")}>
                <div className="relative flex aspect-[4/3] items-center justify-center bg-n100">
                  {i.is_service ? <RiStethoscopeLine className="h-10 w-10 text-n600" /> : <RiImageLine className="h-10 w-10 text-n600" />}
                  {i.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  )}
                  {inCart[i.sku] ? <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-ink px-2 text-xs font-bold text-yellow">×{inCart[i.sku]}</span> : null}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">{i.name}</span>
                  <span className="text-xs text-n800">{[i.size && `Size ${i.size}`, i.color].filter(Boolean).join(" · ") || i.sku}</span>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                    <span className="tabular text-base font-semibold">{i.msp != null ? inr0(i.msp) : "—"}</span>
                    {stockBadge(i, inCart[i.sku] ?? 0)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
