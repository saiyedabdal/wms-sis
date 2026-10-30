"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Select, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { paths } from "@/lib/paths";
import { date } from "@/lib/format";

interface Fo {
  id: number;
  fo_no: string;
  status: string;
  created_at: string;
  fulfiller_id: number;
  facility_id: number;
  request_id: number;
  order_requests: { request_no: string } | null;
  fulfilment_order_lines: { qty: number }[];
}

/** Step 7: approved demand waiting to be shipped, per fulfiller (Frido WH or a super stockist). */
export default function FulfilmentPage() {
  const { facilities, isOps, facility, audience } = useApp();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [from, setFrom] = useState<string>("all");
  const [rows, setRows] = useState<Fo[]>([]);
  const fulfillers = facilities.filter((f) => f.type === "warehouse" || f.type === "super_stockist");
  const name = (id: number) => facilities.find((f) => f.id === id)?.name ?? id;

  useEffect(() => {
    let q = supabaseBrowser()
      .from("fulfilment_orders")
      .select("id,fo_no,status,created_at,fulfiller_id,facility_id,request_id,order_requests(request_no),fulfilment_order_lines(qty)")
      .order("created_at", { ascending: tab === "open" })
      .limit(200);
    q = tab === "open" ? q.in("status", ["open", "partially_dispatched"]) : q.in("status", ["dispatched", "closed", "cancelled"]);
    if (!isOps && facility) q = q.eq("fulfiller_id", facility.id);
    else if (from !== "all") q = q.eq("fulfiller_id", Number(from));
    q.then(({ data }) => setRows((data ?? []) as unknown as Fo[]));
  }, [tab, from, isOps, facility]);

  const canDispatch = (fo: Fo) =>
    ["open", "partially_dispatched"].includes(fo.status) &&
    (facilities.find((f) => f.id === fo.fulfiller_id)?.type === "warehouse" ? isOps : isOps || (audience === "ss" && facility?.id === fo.fulfiller_id));

  return (
    <>
      <PageHeader
        title="Fulfilment"
        subtitle={isOps ? "Approved requests, split by who ships them. Frido WH dispatches are copied in from Uniware." : "Orders routed to you for your retailers."}
        actions={
          isOps && (
            <Select value={from} onChange={(e) => setFrom(e.target.value)} className="w-60">
              <option value="all">All fulfillers</option>
              {fulfillers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "open", label: "To dispatch" },
          { value: "done", label: "Done" },
        ]}
      />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty title={tab === "open" ? "Nothing waiting to ship" : "Nothing yet"} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Since</Th>
                <Th right>Units</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((fo) => (
                <tr key={fo.id}>
                  <Td>
                    <div className="font-semibold">{fo.fo_no}</div>
                    <Link href={paths.request(fo.request_id)} className="text-xs text-n800 hover:underline">
                      {fo.order_requests?.request_no}
                    </Link>
                  </Td>
                  <Td>{name(fo.fulfiller_id)}</Td>
                  <Td>{name(fo.facility_id)}</Td>
                  <Td>{date(fo.created_at)}</Td>
                  <Td right>{fo.fulfilment_order_lines.reduce((s, l) => s + l.qty, 0)}</Td>
                  <Td>
                    <StatusBadge status={fo.status} />
                  </Td>
                  <Td right>
                    {canDispatch(fo) && (
                      <LinkButton href={paths.dispatch(fo.id)} size="sm">
                        Dispatch
                      </LinkButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
