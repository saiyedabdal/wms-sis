"use client";

import { useCallback, useEffect, useState } from "react";
import { uuid } from "./format";
import type { CartLine, Customer } from "./types";

export interface Cart {
  lines: CartLine[];
  cart_discount: { kind: "pct" | "amount"; value: number } | null;
  customer: Customer | null;
  therapist_id: number | null;
  approval: { id: number; pct: number; approver: string } | null;
  /** exchange: a credit note to spend on this sale */
  credit_note: { id: number; credit_no: string; balance: number } | null;
  /** idempotency key for this sale; reused on retries, replaced once the sale is done */
  client_ref: string;
}

const empty = (): Cart => ({ lines: [], cart_discount: null, customer: null, therapist_id: null, approval: null, credit_note: null, client_ref: uuid() });

/** The sale being rung up, kept in this device's storage so a reload or a dropped connection never loses it. */
export function useCart(registerId: number | null | undefined) {
  const key = `pos.cart.${registerId ?? 0}`;
  const [cart, setCart] = useState<Cart>(empty);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setCart(raw ? { ...empty(), ...JSON.parse(raw) } : empty());
    } catch { setCart(empty()); }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, JSON.stringify(cart)); } catch { /* storage full or blocked */ }
  }, [cart, key, loaded]);

  const update = useCallback((f: (c: Cart) => Cart) => setCart((c) => f(c)), []);

  return {
    cart,
    loaded,
    add: (sku: string, qty = 1) => update((c) => {
      const i = c.lines.findIndex((l) => l.sku === sku);
      if (i >= 0) return { ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l)) };
      return { ...c, lines: [...c.lines, { sku, qty }] };
    }),
    setQty: (sku: string, qty: number) => update((c) => ({
      ...c, lines: qty <= 0 ? c.lines.filter((l) => l.sku !== sku) : c.lines.map((l) => (l.sku === sku ? { ...l, qty } : l)),
    })),
    remove: (sku: string) => update((c) => ({ ...c, lines: c.lines.filter((l) => l.sku !== sku) })),
    setLineDiscount: (sku: string, kind: "pct" | "amount" | null, value: number | null) => update((c) => ({
      ...c, lines: c.lines.map((l) => (l.sku === sku ? { ...l, disc_kind: kind, disc_value: value } : l)),
    })),
    setCartDiscount: (d: Cart["cart_discount"]) => update((c) => ({ ...c, cart_discount: d })),
    setCustomer: (customer: Customer | null) => update((c) => ({ ...c, customer })),
    setTherapist: (therapist_id: number | null) => update((c) => ({ ...c, therapist_id })),
    setApproval: (approval: Cart["approval"]) => update((c) => ({ ...c, approval })),
    setCreditNote: (credit_note: Cart["credit_note"]) => update((c) => ({ ...c, credit_note })),
    clear: () => setCart(empty()),
  };
}
