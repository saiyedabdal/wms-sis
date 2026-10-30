"use client";

import { paths } from "@/lib/paths";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { date, dateTime } from "@/lib/format";

interface Ship {
  id: number;
  shipment_no: string;
  dispatched_at: string;
  uniware_ref: string | null;
  invoice_no: string | null;
  carton_count: number | null;
  order_requests: { request_no: string } | null;
  shipment_lines: { qty: number }[];
}
interface Grn {
  id: number;
  grn_no: string;
  received_at: string;
  has_discrepancy: boolean;
  shipments: { shipment_no: string } | null;
}

export default function ReceivePage() {
  const { facility } = useApp();
  const [ships, setShips] = useState<Ship[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);

  useEffect(() => {
    if (!facility) return;
    const sb = supabaseBrowser();
    sb.from("shipments")
      .select("id,shipment_no,dispatched_at,uniware_ref,invoice_no,carton_count,order_requests(request_no),shipment_lines(qty)")
      .eq("facility_id", facility.id)
      .eq("status", "in_transit")
      .order("dispatched_at")
      .then(({ data }) => setShips((data ?? []) as unknown as Ship[]));
    sb.from("grns")
      .select("id,grn_no,received_at,has_discrepancy,shipments(shipment_no)")
      .eq("facility_id", facility.id)
      .order("received_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setGrns((data ?? []) as unknown as Grn[]));
  }, [facility]);

  return (
    <>
      <PageHeader title="Receive stock" subtitle={`Shipments on the way to ${facility?.name ?? ""}`} />
      <div className="flex flex-col gap-6">
        <Card title="In transit" pad={false}>
          {ships.length === 0 ? (
            <Empty title="Nothing to receive">When ops records a dispatch it shows up here.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Shipment</Th>
                  <Th>Dispatched</Th>
                  <Th>Uniware / invoice</Th>
                  <Th right>Units</Th>
                  <Th right>Cartons</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {ships.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <div className="font-semibold">{s.shipment_no}</div>
                      <div className="text-xs text-n800">{s.order_requests?.request_no}</div>
                    </Td>
                    <Td>{date(s.dispatched_at)}</Td>
                    <Td>{[s.uniware_ref, s.invoice_no].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td right>{s.shipment_lines.reduce((a, l) => a + l.qty, 0)}</Td>
                    <Td right>{s.carton_count ?? "—"}</Td>
                    <Td right>
                      <LinkButton href={paths.receiveShipment(s.id)} size="sm">
                        Receive
                      </LinkButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Recent receipts" pad={false}>
          {grns.length === 0 ? (
            <Empty title="No receipts yet" />
          ) : (
            <Table>
              <tbody>
                {grns.map((g) => (
                  <tr key={g.id}>
                    <Td>
                      <Link href={paths.grn(g.id)} className="font-semibold hover:underline">
                        {g.grn_no}
                      </Link>
                    </Td>
                    <Td>{g.shipments?.shipment_no}</Td>
                    <Td>{dateTime(g.received_at)}</Td>
                    <Td right>{g.has_discrepancy ? <Badge tone="red">discrepancy</Badge> : <Badge tone="green">matched</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
