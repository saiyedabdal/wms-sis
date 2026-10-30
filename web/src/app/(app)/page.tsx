"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { date, inr, num } from "@/lib/format";

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
  const { facility, isOps } = useApp();
  const [d, setD] = useState<Dash | null>(null);

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
        subtitle={`${facility.code} · ${facility.type === "partner_clinic" ? "Partner clinic" : facility.type === "internal" ? "Frido internal" : "Warehouse"}${facility.is_consignment ? " · Consignment" : ""}`}
        actions={
          <>
            {isOps && <LinkButton href="/requests/new">New request</LinkButton>}
            <LinkButton href="/sales/new" variant="secondary">
              Record sale
            </LinkButton>
          </>
        }
      />
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
                      <Link className="font-medium hover:underline" href={`/receive/${s.id}`}>
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
        <Card title="Open requests" pad={false} actions={isOps ? <LinkButton href="/requests" variant="ghost" size="sm">All</LinkButton> : undefined}>
          {d?.requests.length ? (
            <Table>
              <tbody>
                {d.requests.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {isOps ? (
                        <Link className="font-medium hover:underline" href={`/requests/${r.id}`}>
                          {r.request_no}
                        </Link>
                      ) : (
                        r.request_no
                      )}
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
