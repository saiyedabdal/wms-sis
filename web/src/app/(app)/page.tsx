"use client";

import { paths } from "@/lib/paths";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { date, inr, num } from "@/lib/format";
import { facilityTypeLabel } from "@/lib/types";

interface Dash {
  units: Record<string, number>;
  valueMsp: number;
  low: { sku: string; item_name: string; qty: number; min_qty: number }[];
  requests: { id: number; request_no: string; status: string; created_at: string }[];
  inTransit: { id: number; shipment_no: string; dispatched_at: string; carton_count: number | null; order_requests: { request_no: string } | null }[];
  monthSales: number;
  monthPayable: number;
}

export default function Dashboard() {
  const { facility, isOps, isManager, audience, profile } = useApp();
  const [d, setD] = useState<Dash | null>(null);
  const [todo, setTodo] = useState<{ label: string; count: number; href: string }[]>([]);

  // the few things waiting on this person, across facilities
  useEffect(() => {
    const sb = supabaseBrowser();
    const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    (async () => {
      const items: { label: string; count: number; href: string }[] = [];
      if (isManager) {
        items.push({
          label: "Waiting for your approval",
          count: await count(sb.from("order_requests").select("id", { count: "exact", head: true }).eq("status", "pending_approval").neq("sent_for_approval_by", profile.id)),
          href: "/approvals",
        });
      }
      if (isOps) {
        items.push({
          label: "Requests to review & send",
          count: await count(sb.from("order_requests").select("id", { count: "exact", head: true }).in("status", ["submitted", "draft", "rejected"])),
          href: "/approvals",
        });
        items.push({
          label: "Orders to dispatch",
          count: await count(sb.from("fulfilment_orders").select("id", { count: "exact", head: true }).in("status", ["open", "partially_dispatched"])),
          href: "/fulfilment",
        });
      }
      if (audience === "ss" && facility) {
        items.push({
          label: "Orders to fulfil for your retailers",
          count: await count(sb.from("fulfilment_orders").select("id", { count: "exact", head: true }).eq("fulfiller_id", facility.id).in("status", ["open", "partially_dispatched"])),
          href: "/fulfilment",
        });
      }
      setTodo(items);
    })();
  }, [isOps, isManager, audience, facility, profile.id]);

  useEffect(() => {
    if (!facility) return;
    const sb = supabaseBrowser();
    const month = new Date().toISOString().slice(0, 7);
    (async () => {
      const [stock, reqs, ships, sales] = await Promise.all([
        sb.from("v_stock").select("sku,item_name,bucket,qty,value_msp,min_qty").eq("facility_id", facility.id),
        sb.from("order_requests").select("id,request_no,status,created_at").eq("facility_id", facility.id).not("status", "in", "(closed,cancelled,received)").order("created_at", { ascending: false }).limit(8),
        sb.from("shipments").select("id,shipment_no,dispatched_at,carton_count,order_requests(request_no)").eq("facility_id", facility.id).eq("status", "in_transit").order("dispatched_at"),
        sb.from("v_sales_lines").select("qty,payable_total").eq("facility_id", facility.id).eq("period", month),
      ]);
      const units: Record<string, number> = {};
      const bySku: Record<string, { sku: string; item_name: string; qty: number; min_qty: number }> = {};
      let valueMsp = 0;
      type S = { sku: string; item_name: string; bucket: string; qty: number; value_msp: number; min_qty: number | null };
      for (const r of (stock.data ?? []) as S[]) {
        units[r.bucket] = (units[r.bucket] ?? 0) + r.qty;
        valueMsp += Number(r.value_msp);
        if (r.bucket === "sellable") bySku[r.sku] = { sku: r.sku, item_name: r.item_name, qty: r.qty, min_qty: r.min_qty ?? 0 };
      }
      setD({
        units,
        valueMsp,
        low: Object.values(bySku).filter((x) => x.min_qty > 0 && x.qty < x.min_qty),
        requests: reqs.data ?? [],
        inTransit: (ships.data ?? []) as unknown as Dash["inTransit"],
        monthSales: (sales.data ?? []).reduce((s, r) => s + (r.qty ?? 0), 0),
        monthPayable: (sales.data ?? []).reduce((s, r) => s + Number(r.payable_total), 0),
      });
    })();
  }, [facility]);

  if (!facility) return null;
  return (
    <>
      <PageHeader
        title={facility.name}
        subtitle={`${facility.code} · ${facilityTypeLabel(facility.type)}${facility.region ? ` · ${facility.region}` : ""}${facility.is_consignment ? " · Consignment" : ""}`}
        actions={
          <>
            <LinkButton href="/requests/new">{isOps ? "New request" : "Request stock"}</LinkButton>
            <LinkButton href="/sales/new" variant="secondary">
              Record sale
            </LinkButton>
          </>
        }
      />
      {todo.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {todo.map((t) => (
            <Link key={t.label} href={t.href} className="rounded-lg border border-n300 bg-white p-5 hover:border-ink">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-n800">{t.label}</span>
              <span className={`mt-2 block text-[28px] font-semibold leading-none tabular ${t.count ? "" : "text-n600"}`}>{t.count}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Display / sale units" value={num(d?.units.sellable)} tone="yellow" />
        <Stat label="Display-only + in use" value={num((d?.units.display ?? 0) + (d?.units.in_use ?? 0))} hint={`${num(d?.units.damaged)} damaged`} />
        <Stat label="Stock value (MSP)" value={inr(d?.valueMsp)} />
        <Stat label="Sold this month" value={num(d?.monthSales)} hint={facility.is_consignment ? `${inr(d?.monthPayable)} payable to Frido` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Shipments to receive" pad={false} actions={<LinkButton href="/receive" variant="ghost" size="sm">All</LinkButton>}>
          {d?.inTransit.length ? (
            <Table>
              <tbody>
                {d.inTransit.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link className="font-medium hover:underline" href={paths.receiveShipment(s.id)}>
                        {s.shipment_no}
                      </Link>
                      <div className="text-xs text-n800">{s.order_requests?.request_no}</div>
                    </Td>
                    <Td>{date(s.dispatched_at)}</Td>
                    <Td right>{s.carton_count ?? "—"} cartons</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="Nothing in transit" />
          )}
        </Card>
        <Card title="Open requests" pad={false} actions={<LinkButton href="/requests" variant="ghost" size="sm">All</LinkButton>}>
          {d?.requests.length ? (
            <Table>
              <tbody>
                {d.requests.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="font-medium hover:underline" href={paths.request(r.id)}>
                        {r.request_no}
                      </Link>
                    </Td>
                    <Td>{date(r.created_at)}</Td>
                    <Td right>
                      <StatusBadge status={r.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No open requests" />
          )}
        </Card>
        {!!d?.low.length && (
          <Card title="Below minimum stock" pad={false} className="lg:col-span-2">
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th right>On hand</Th>
                  <Th right>Min</Th>
                </tr>
              </thead>
              <tbody>
                {d.low.map((l) => (
                  <tr key={l.sku}>
                    <Td className="font-medium">{l.sku}</Td>
                    <Td>{l.item_name}</Td>
                    <Td right className="text-red-a">{l.qty}</Td>
                    <Td right>{l.min_qty}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
