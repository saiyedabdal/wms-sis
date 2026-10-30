"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dateTime, inr } from "@/lib/format";

interface Line {
  sale_id: number;
  sale_no: string;
  sold_at: string;
  customer_name: string | null;
  bill_ref: string | null;
  sku: string;
  item_name: string;
  qty: number;
  gross_msp: number;
  payable_total: number;
}

export default function SalesPage() {
  const { facility } = useApp();
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!facility) return;
    supabaseBrowser()
      .from("v_sales_lines")
      .select("sale_id,sale_no,sold_at,customer_name,bill_ref,sku,item_name,qty,gross_msp,payable_total")
      .eq("facility_id", facility.id)
      .order("sold_at", { ascending: false })
      .limit(300)
      .then(({ data }) => setLines((data ?? []) as Line[]));
  }, [facility]);

  return (
    <>
      <PageHeader title="Sales" subtitle={facility?.is_consignment ? "Each sale adds to what the clinic owes Frido (MSP − margin)" : "Units sold from this facility"} actions={<LinkButton href="/sales/new">Record sale</LinkButton>} />
      <Card pad={false}>
        {lines.length === 0 ? (
          <Empty title="No sales yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Sale</Th>
                <Th>When</Th>
                <Th>Customer</Th>
                <Th>Product</Th>
                <Th right>Qty</Th>
                <Th right>MSP value</Th>
                {facility?.is_consignment && <Th right>Payable to Frido</Th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <Td className="font-medium">{l.sale_no}</Td>
                  <Td>{dateTime(l.sold_at)}</Td>
                  <Td>
                    {l.customer_name || "—"}
                    {l.bill_ref && <div className="text-xs text-n800">Bill {l.bill_ref}</div>}
                  </Td>
                  <Td>
                    <div>{l.item_name}</div>
                    <div className="text-xs text-n800">{l.sku}</div>
                  </Td>
                  <Td right>{l.qty}</Td>
                  <Td right>{inr(l.gross_msp)}</Td>
                  {facility?.is_consignment && <Td right>{inr(l.payable_total)}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
