"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiLockUnlockLine } from "@remixicon/react";
import { discountAllowance, usePos } from "@/lib/pos/context";
import { useCart } from "@/lib/pos/cart";
import { sb, RpcError } from "@/lib/pos/supabase";
import { inr, pct } from "@/lib/pos/format";
import type { CatalogItem, InvoiceSummary, Priced } from "@/lib/pos/types";
import { Alert, Button, Card, Chip, Field, Input, useToast } from "@/components/pos/ui";
import { ScanField } from "@/components/pos/ScanField";
import { PinPad } from "@/components/pos/PinPad";
import { ProductGrid } from "@/components/pos/sell/ProductGrid";
import { CartPanel } from "@/components/pos/sell/CartPanel";
import { CustomerSheet } from "@/components/pos/sell/CustomerSheet";
import { DiscountSheet } from "@/components/pos/sell/DiscountSheet";
import { PaymentSheet, type PaymentDraft } from "@/components/pos/sell/PaymentSheet";
import { DoneSheet } from "@/components/pos/sell/DoneSheet";

function OpenShift() {
  const { register, staff, facilityId, call, refresh } = usePos();
  const [float, setFloat] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true); setErr(null);
    try {
      await call("pos_open_shift", { p_facility_id: facilityId, p_register_id: register!.id, p_staff_token: staff!.token, p_opening_float: Number(float || 0) });
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return (
    <div className="flex justify-center p-6">
      <Card className="w-full max-w-md" title={<span className="flex items-center gap-2"><RiLockUnlockLine /> Open {register?.name}</span>}>
        <p className="text-sm text-n800">Count the cash in the drawer before the first sale. At the end of the day the drawer is counted again and any difference is recorded.</p>
        <Field label="Opening cash float (₹)" className="mt-5">
          <Input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ""))} className="h-14 text-2xl font-semibold" placeholder="0" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">{[0, 500, 1000, 2000].map((v) => <Chip key={v} active={float === String(v)} onClick={() => setFloat(String(v))}>{inr(v)}</Chip>)}</div>
        {err && <Alert className="mt-4">{err}</Alert>}
        <Button size="xl" className="mt-5 w-full" disabled={busy} onClick={open}>Open shift</Button>
      </Card>
    </div>
  );
}

export default function SellPage() {
  const pos = usePos();
  const { ctx, register, staff, facilityId, call } = pos;
  const toast = useToast();
  const c = useCart(register?.id);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [priced, setPriced] = useState<Priced | null>(null);
  const [pricing, setPricing] = useState(false);
  const [sheet, setSheet] = useState<null | "customer" | "cart_discount" | "approval" | "pay" | { line: string }>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ inv: InvoiceSummary; phone: string | null; change: number } | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!facilityId) return;
    const { data } = await sb().from("pos_v_catalog").select("*").eq("facility_id", facilityId).order("name");
    setCatalog((data as CatalogItem[]) ?? []);
  }, [facilityId]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const bySku = useMemo(() => Object.fromEntries(catalog.map((i) => [i.sku, i])), [catalog]);
  const inCart = useMemo(() => Object.fromEntries(c.cart.lines.map((l) => [l.sku, l.qty])), [c.cart.lines]);

  // server is the only price authority: re-price on every change (debounced)
  const seq = useRef(0);
  useEffect(() => {
    if (!facilityId || !c.loaded) return;
    if (c.cart.lines.length === 0) { setPriced(null); return; }
    const n = ++seq.current;
    setPricing(true);
    const t = setTimeout(async () => {
      try {
        const p = await call<Priced>("pos_price_cart", { p_facility_id: facilityId, p_cart: { lines: c.cart.lines, cart_discount: c.cart.cart_discount } });
        if (n === seq.current) setPriced(p);
      } catch (e) { if (n === seq.current && !(e instanceof RpcError && e.hint === "offline")) toast(e instanceof Error ? e.message : String(e), "red"); }
      if (n === seq.current) setPricing(false);
    }, 200);
    return () => clearTimeout(t);
  }, [c.cart.lines, c.cart.cart_discount, facilityId, c.loaded, call, toast]);

  const add = (item: CatalogItem) => {
    if (!item.sale_ready) return toast(`${item.name}: ${item.msp == null ? "no selling price set" : !item.hsn_code ? "HSN code missing in the item master" : "GST rate is not valid"}. Ask Frido ops to fix it.`, "red");
    if (!item.is_service && item.sellable_qty - (inCart[item.sku] ?? 0) <= 0) return toast(`${item.name} is out of stock here.`, "red");
    c.add(item.sku);
    setQuery("");
    navigator.vibrate?.(30);
  };
  const onScan = (code: string) => {
    const k = code.trim().toLowerCase();
    const hit = catalog.find((i) => i.sku.toLowerCase() === k || i.scan_identifier?.toLowerCase() === k);
    if (hit) return add(hit);
    const matches = catalog.filter((i) => i.name.toLowerCase().includes(k) || i.sku.toLowerCase().includes(k));
    if (matches.length === 1) return add(matches[0]);
    if (matches.length === 0) toast(`No product with barcode “${code}” at this clinic.`, "red");
  };

  if (!register?.open_shift) return <OpenShift />;
  if (!ctx || !staff || !facilityId) return null;

  const allowance = discountAllowance(ctx, staff);
  const managerMax = ctx.settings?.manager_max_disc_pct ?? 10;
  const needAdmin = (priced?.max_disc_pct ?? 0) > managerMax;
  const approvers = ctx.staff.filter((s) => (needAdmin ? s.pos_role === "admin" : s.pos_role !== "cashier"));

  const charge = () => {
    if (!priced) return;
    if (ctx.settings?.require_customer && !c.cart.customer) return setSheet("customer");
    if (priced.max_disc_pct > allowance && !(c.cart.approval && c.cart.approval.pct >= priced.max_disc_pct)) return setSheet("approval");
    setPayErr(null);
    setSheet("pay");
  };

  const checkout = async (payments: PaymentDraft[]) => {
    setPaying(true); setPayErr(null);
    try {
      const inv = await call<InvoiceSummary>("pos_checkout", {
        p_client_ref: c.cart.client_ref, p_facility_id: facilityId, p_register_id: register.id, p_staff_token: staff.token,
        p_cart: { lines: c.cart.lines, cart_discount: c.cart.cart_discount, customer_id: c.cart.customer?.id ?? null,
                  therapist_id: c.cart.therapist_id, approval_id: c.cart.approval?.id ?? null },
        p_payments: payments,
      });
      const change = payments.filter((p) => p.mode === "cash" && p.tendered).reduce((s, p) => s + (p.tendered! - p.amount), 0);
      setDone({ inv, phone: c.cart.customer?.phone ?? null, change });
      setSheet(null);
      c.clear();
      loadCatalog();
    } catch (e) {
      const err = e as RpcError;
      if (err.hint === "approval_required") { c.setApproval(null); setSheet("approval"); }
      else if (err.hint === "customer_required") setSheet("customer");
      else if (err.hint === "shift_required") pos.refresh();
      setPayErr(err.hint === "offline" ? "Connection lost. Your sale is safe: tap Complete sale again when you're back online. It will not be charged twice." : err.message);
    }
    setPaying(false);
  };

  const lineSku = typeof sheet === "object" && sheet ? sheet.line : null;
  const lineBase = lineSku ? (priced?.lines.find((l) => l.sku === lineSku)?.gross ?? 0) : 0;
  const lineCur = lineSku ? c.cart.lines.find((l) => l.sku === lineSku) : null;
  const items = c.cart.lines.reduce((n, l) => n + l.qty, 0);

  const panel = (
    <CartPanel cart={c.cart} priced={priced} pricing={pricing} catalog={bySku} ctx={ctx} allowance={allowance} online={pos.online}
      onQty={c.setQty} onRemove={c.remove} onLineDiscount={(sku) => setSheet({ line: sku })} onCartDiscount={() => setSheet("cart_discount")}
      onCustomer={() => setSheet("customer")} onTherapist={c.setTherapist} onClear={c.clear} onCharge={charge} />
  );

  return (
    <div className="grid h-[calc(100vh-4rem)] gap-4 p-3 md:p-4 lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_460px]">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-24 lg:pb-4">
        <ScanField value={query} onChange={setQuery} onScan={onScan} autoCamera={register.scan_mode === "camera"}
          trapFocus={register.scan_mode !== "camera" && sheet === null && !done} />
        <ProductGrid items={catalog} query={query} category={category} onCategory={setCategory} onAdd={add} inCart={inCart} />
      </div>
      <div className="hidden min-h-0 lg:block">{panel}</div>

      {/* phones and portrait tablets: the cart is a bottom sheet */}
      <div className="no-print fixed inset-x-0 bottom-16 z-30 p-3 md:bottom-0 lg:hidden">
        <Button size="xl" className="w-full justify-between" onClick={() => setCartOpen(true)} disabled={items === 0}>
          <span>Cart · {items} item{items === 1 ? "" : "s"}</span><span className="tabular">{priced ? inr(priced.grand_total) : ""}</span>
        </Button>
      </div>
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink/50 lg:hidden" onClick={(e) => e.target === e.currentTarget && setCartOpen(false)}>
          <div className="mt-auto h-[88vh] rounded-t-xl bg-white">{panel}</div>
        </div>
      )}

      <CustomerSheet open={sheet === "customer"} facilityId={facilityId} current={c.cart.customer} call={call}
        onClose={() => setSheet(null)} onSave={(cu) => { c.setCustomer(cu); setSheet(null); }} />
      <DiscountSheet open={sheet === "cart_discount"} title="Bill discount" base={(priced?.gross_total ?? 0) - (priced?.lines.reduce((s, l) => s + l.line_discount, 0) ?? 0)}
        current={c.cart.cart_discount} allowance={allowance} managerMax={managerMax} onClose={() => setSheet(null)}
        onApply={(d) => { c.setCartDiscount(d); c.setApproval(null); setSheet(null); }} />
      <DiscountSheet open={!!lineSku} title={`Discount · ${bySku[lineSku ?? ""]?.name ?? ""}`} base={lineBase}
        current={lineCur?.disc_kind ? { kind: lineCur.disc_kind, value: lineCur.disc_value ?? 0 } : null}
        allowance={allowance} managerMax={managerMax} onClose={() => setSheet(null)}
        onApply={(d) => { c.setLineDiscount(lineSku!, d?.kind ?? null, d?.value ?? null); c.setApproval(null); setSheet(null); }} />
      <PinPad open={sheet === "approval"} onClose={() => setSheet(null)} staff={approvers}
        title={needAdmin ? "Frido admin approval" : "Manager approval"} submitLabel="Approve discount" canSubmit={approvalReason.trim().length > 1}
        subtitle={<>This bill has a <b>{pct(priced?.max_disc_pct)}</b> discount; {staff.staff.display_name}&apos;s limit is {pct(allowance)}.
          {needAdmin ? ` Managers can approve up to ${pct(managerMax)}, so a Frido admin must enter their PIN.` : " A manager approves with their PIN; their name is saved on the invoice."}</>}
        onSubmit={async (uid, pin) => {
          const r = await call<{ ok: boolean; error?: string; approval_id: number; approved_pct: number; approver: string }>("pos_approve_discount",
            { p_facility_id: facilityId, p_requester_token: staff.token, p_approver_id: uid, p_pin: pin, p_pct: priced?.max_disc_pct, p_reason: approvalReason });
          if (!r.ok) return r.error ?? "Not approved";
          c.setApproval({ id: r.approval_id, pct: r.approved_pct, approver: r.approver });
          setApprovalReason("");
          setSheet("pay");
          return null;
        }}>
        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">Reason</div>
          <div className="flex flex-wrap gap-2">
            {["Regular patient", "Doctor's request", "Damaged box", "Bulk purchase"].map((r) => <Chip key={r} active={approvalReason === r} onClick={() => setApprovalReason(r)}>{r}</Chip>)}
          </div>
          <Input className="mt-2" placeholder="Or type a reason" value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} />
        </div>
      </PinPad>
      <PaymentSheet open={sheet === "pay"} total={priced?.grand_total ?? 0} ctx={ctx} creditNote={c.cart.credit_note} busy={paying} error={payErr}
        onClose={() => setSheet(null)} onComplete={checkout} />
      <DoneSheet result={done?.inv ?? null} phone={done?.phone ?? null} change={done?.change ?? 0} clinic={ctx.facility?.name ?? "Frido"}
        printer={register.printer} call={call} staffToken={staff.token} onNew={() => { setDone(null); pos.refresh(); }} />
      {!pos.online && c.cart.lines.length > 0 && <div className="sr-only" role="status">Offline: the cart is kept on this device.</div>}
    </div>
  );
}
