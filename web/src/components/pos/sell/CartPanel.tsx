"use client";

import { RiAddLine, RiCoupon3Line, RiDeleteBinLine, RiShoppingCartLine, RiStethoscopeLine, RiSubtractLine, RiUserAddLine, RiUserLine } from "@remixicon/react";
import { inr, inr0, pct } from "@/lib/pos/format";
import type { Cart } from "@/lib/pos/cart";
import type { CatalogItem, PosContext, Priced } from "@/lib/pos/types";
import { Alert, Badge, Button, Empty, Select, Spinner, cx } from "../ui";

export function CartPanel({ cart, priced, pricing, catalog, ctx, allowance, onQty, onRemove, onLineDiscount, onCartDiscount, onCustomer,
  onTherapist, onClear, onCharge, online }: {
  cart: Cart;
  priced: Priced | null;
  pricing: boolean;
  catalog: Record<string, CatalogItem>;
  ctx: PosContext;
  allowance: number;
  onQty: (sku: string, qty: number) => void;
  onRemove: (sku: string) => void;
  onLineDiscount: (sku: string) => void;
  onCartDiscount: () => void;
  onCustomer: () => void;
  onTherapist: (id: number | null) => void;
  onClear: () => void;
  onCharge: () => void;
  online: boolean;
}) {
  const lineOf = (sku: string) => priced?.lines.find((l) => l.sku === sku);
  const problems = priced?.problems ?? [];
  const blocking = problems.length > 0;
  const over = priced && priced.max_disc_pct > allowance;
  const approved = over && cart.approval && cart.approval.pct >= (priced?.max_disc_pct ?? 0);
  const items = cart.lines.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-n300 bg-white shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between border-b border-n300 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><RiShoppingCartLine className="h-5 w-5" /> Current sale {items > 0 && <Badge tone="black">{items}</Badge>}</h2>
        {cart.lines.length > 0 && <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>}
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-n300 p-3">
        <button type="button" onClick={onCustomer}
          className={cx("flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition hover:border-ink",
            cart.customer ? "border-ink bg-y50" : "border-dashed border-n600")}>
          {cart.customer ? <RiUserLine className="h-5 w-5 shrink-0" /> : <RiUserAddLine className="h-5 w-5 shrink-0 text-n800" />}
          <span className="min-w-0">
            <span className="block truncate font-semibold">{cart.customer ? cart.customer.name || cart.customer.phone : "Add customer"}</span>
            <span className="block truncate text-xs text-n800">
              {cart.customer ? `${cart.customer.phone}${cart.customer.gstin ? " · B2B" : ""}${cart.customer.visits ? ` · ${cart.customer.visits} visit${cart.customer.visits > 1 ? "s" : ""}` : " · new"}`
                : ctx.settings?.require_customer ? "Required" : "Optional"}
            </span>
          </span>
        </button>
        <label className="relative flex min-h-12 items-center rounded-md border border-n500 px-3 text-sm focus-within:border-ink">
          <RiStethoscopeLine className="mr-2 h-5 w-5 shrink-0 text-n800" />
          <Select aria-label="Referred by" value={cart.therapist_id ?? ""} onChange={(e) => onTherapist(e.target.value ? Number(e.target.value) : null)}
            className="h-10 border-0 px-0 text-sm focus:ring-0">
            <option value="">Referred by: none</option>
            {ctx.therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cart.lines.length === 0 ? (
          <Empty icon={<RiShoppingCartLine />} title="Scan a product to start">Or tap a product on the left. Prices come from this clinic&apos;s Frido price list.</Empty>
        ) : (
          <ul className="divide-y divide-n300">
            {cart.lines.map((l) => {
              const item = catalog[l.sku];
              const p = lineOf(l.sku);
              const prob = problems.filter((x) => x.sku === l.sku);
              return (
                <li key={l.sku} className={cx("px-4 py-3", prob.length > 0 && "bg-red-c/50")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-snug">{item?.name ?? l.sku}</div>
                      <div className="text-xs text-n800">{[item?.size && `Size ${item.size}`, item?.color, l.sku].filter(Boolean).join(" · ")}</div>
                      <button type="button" onClick={() => onLineDiscount(l.sku)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue hover:underline">
                        <RiCoupon3Line className="h-3.5 w-3.5" />
                        {p && p.line_discount > 0 ? `− ${inr(p.line_discount)} (${pct(l.disc_kind === "pct" ? l.disc_value : (p.line_discount * 100) / p.gross)})` : "Discount"}
                      </button>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-sm font-semibold">{p ? inr(p.net_amount) : item?.msp ? inr(item.msp * l.qty) : "—"}</div>
                      {p && p.net_amount < p.gross && <div className="tabular text-xs text-n700 line-through">{inr(p.gross)}</div>}
                      {item?.mrp && <div className="tabular text-[11px] text-n800">MRP {inr0(item.mrp)}</div>}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-n500">
                      <button type="button" aria-label="One less" onClick={() => onQty(l.sku, l.qty - 1)} className="flex h-10 w-10 items-center justify-center hover:bg-n200"><RiSubtractLine className="h-4 w-4" /></button>
                      <span className="tabular w-8 text-center text-sm font-semibold">{l.qty}</span>
                      <button type="button" aria-label="One more" onClick={() => onQty(l.sku, l.qty + 1)} className="flex h-10 w-10 items-center justify-center hover:bg-n200"><RiAddLine className="h-4 w-4" /></button>
                    </div>
                    <span className="tabular text-xs text-n800">@ {item?.msp != null ? inr(item.msp) : "—"}</span>
                    <button type="button" aria-label={`Remove ${item?.name ?? l.sku}`} onClick={() => onRemove(l.sku)} className="ml-auto flex h-10 w-10 items-center justify-center rounded-md text-n800 hover:bg-red-c hover:text-red-a"><RiDeleteBinLine className="h-4 w-4" /></button>
                  </div>
                  {prob.map((x, i) => <p key={i} className="mt-1 text-xs font-medium text-red-a">{x.message}</p>)}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {cart.lines.length > 0 && (
        <div className="border-t border-n300 p-4">
          <dl className="tabular space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-n800">Items at MSP</dt><dd>{priced ? inr(priced.gross_total) : "…"}</dd></div>
            <div className="flex items-center justify-between">
              <dt><button type="button" onClick={onCartDiscount} className="inline-flex items-center gap-1 font-semibold text-blue hover:underline"><RiCoupon3Line className="h-4 w-4" />{cart.cart_discount ? "Bill discount" : "Add bill discount"}</button></dt>
              <dd>{priced && priced.discount_total > 0 ? `− ${inr(priced.discount_total)}` : "—"}</dd>
            </div>
            <div className="flex justify-between text-xs text-n800"><dt>GST included (CGST + SGST{priced?.igst_total ? " / IGST" : ""})</dt><dd>{priced ? inr(priced.cgst_total + priced.sgst_total + priced.igst_total) : "…"}</dd></div>
            {priced && priced.round_off !== 0 && <div className="flex justify-between text-xs text-n800"><dt>Round off</dt><dd>{inr(priced.round_off)}</dd></div>}
          </dl>
          {over && (
            <Alert tone={approved ? "green" : "yellow"} className="mt-3">
              {approved ? <>Discount {pct(priced!.max_disc_pct)} approved by {cart.approval!.approver}.</>
                : <>Discount reaches {pct(priced!.max_disc_pct)} on a line. Your limit is {pct(allowance)}, so {priced!.max_disc_pct > (ctx.settings?.manager_max_disc_pct ?? 0) ? "a Frido admin" : "a manager"} approves with their PIN at checkout.</>}
            </Alert>
          )}
          {blocking && <Alert className="mt-3">Fix the highlighted lines before charging.</Alert>}
          {cart.credit_note && <Alert tone="blue" className="mt-3">Exchange: credit note {cart.credit_note.credit_no} ({inr(cart.credit_note.balance)}) will be applied at payment.</Alert>}
          <Button size="xl" className="mt-3 w-full justify-between" disabled={!priced || pricing || blocking || !online} onClick={onCharge}>
            <span>{online ? "Charge" : "Offline"}</span>
            <span className="tabular flex items-center gap-2">{pricing && <Spinner className="h-4 w-4 border-ink/30 border-t-ink" />}{priced ? inr0(priced.grand_total) : "…"}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
