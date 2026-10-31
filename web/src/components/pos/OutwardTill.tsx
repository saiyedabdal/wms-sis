"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, LinkButton, Stat } from "@/components/ui";
import { sb } from "@/lib/pos/supabase";

/** Outward → POS: is this facility on the till, and today's figures. Reads go through the POS tables' RLS. */
export type PosStatus = { state: "loading" } | { state: "off" } | { state: "on"; enabled: boolean };

export function usePosStatus(facilityId: number | undefined): PosStatus {
  const [status, setStatus] = useState<PosStatus>({ state: "loading" });
  useEffect(() => {
    if (!facilityId) return;
    setStatus({ state: "loading" });
    sb()
      .from("pos_settings")
      .select("is_enabled")
      .eq("facility_id", facilityId)
      .maybeSingle()
      .then(({ data }) => setStatus(data ? { state: "on", enabled: Boolean(data.is_enabled) } : { state: "off" }));
  }, [facilityId]);
  return status;
}

// whole rupees: a glanceable summary that fits a phone-width tile (the till and invoices keep paise)
const rupees = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(v));

export const tillHref = (facilityId: number, path = "") => `/till/${path}?facility=${facilityId}`;

interface Today {
  sales: number;
  invoices: number;
  returns: number;
  creditNotes: number;
  tills: number;
  openShifts: number;
  attention: number;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function OutwardTill({ facility, status, canSetUp }: { facility: { id: number; name: string }; status: PosStatus; canSetUp: boolean }) {
  const [today, setToday] = useState<Today | null>(null);

  useEffect(() => {
    if (status.state !== "on") return;
    const since = startOfToday();
    const db = sb();
    Promise.all([
      db.from("pos_invoices").select("grand_total").eq("facility_id", facility.id).eq("status", "paid").gte("invoiced_at", since).limit(2000),
      db.from("pos_credit_notes").select("grand_total").eq("facility_id", facility.id).gte("issued_at", since).limit(2000),
      db.from("pos_registers").select("id", { count: "exact", head: true }).eq("facility_id", facility.id).eq("is_active", true),
      db.from("pos_shifts").select("id", { count: "exact", head: true }).eq("facility_id", facility.id).eq("status", "open"),
      db.from("pos_invoices").select("id", { count: "exact", head: true }).eq("facility_id", facility.id).in("status", ["awaiting_payment", "needs_attention"]),
    ]).then(([inv, cn, reg, sh, att]) => {
      const sum = (rows: { grand_total: number }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.grand_total), 0);
      setToday({
        sales: sum(inv.data), invoices: inv.data?.length ?? 0,
        returns: sum(cn.data), creditNotes: cn.data?.length ?? 0,
        tills: reg.count ?? 0, openShifts: sh.count ?? 0, attention: att.count ?? 0,
      });
    });
  }, [facility.id, status.state]);

  if (status.state === "loading") return null;

  if (status.state === "off")
    return canSetUp ? (
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Point of sale is not set up for {facility.name}</div>
            <p className="mt-0.5 text-sm text-n800">Set the invoicing entity, invoice series, tills and staff PINs, then sell from the till.</p>
          </div>
          <LinkButton href={tillHref(facility.id, "admin/")} variant="secondary">Set up POS</LinkButton>
        </div>
      </Card>
    ) : null;

  const links = [
    { path: "invoices/", label: "Invoices" },
    { path: "cash/", label: "Cash & shifts" },
    { path: "reports/", label: "Reports" },
    { path: "admin/", label: "Admin" },
  ];

  return (
    <Card
      className="mb-6"
      title={<span className="flex items-center gap-2">Point of sale {!status.enabled && <Badge tone="red">Paused</Badge>}</span>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales today" value={today ? rupees(today.sales) : "…"} hint={today ? `${today.invoices} paid invoice${today.invoices === 1 ? "" : "s"}` : undefined} tone="yellow" />
        <Stat label="Returns today" value={today ? rupees(today.returns) : "…"} hint={today ? `${today.creditNotes} credit note${today.creditNotes === 1 ? "" : "s"}` : undefined} />
        <Stat label="Shifts open" value={today ? `${today.openShifts} of ${today.tills}` : "…"} hint="tills with an open shift" />
        <Stat label="Needs attention" value={today ? today.attention : "…"}
          hint={today && today.attention > 0 ? <Link className="font-semibold text-ink underline" href={tillHref(facility.id, "invoices/")}>Resolve in Invoices</Link> : "unpaid or unsettled bills"} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-n800">Till mode:</span>
        {links.map((l) => (
          <Link key={l.path} href={tillHref(facility.id, l.path)} className="font-medium text-ink underline-offset-4 hover:underline">{l.label}</Link>
        ))}
        <span className="ml-auto text-xs text-n800">POS bills post to the sales list below with their invoice number.</span>
      </div>
    </Card>
  );
}
