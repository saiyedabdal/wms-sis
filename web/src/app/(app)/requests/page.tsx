"use client";

import { paths } from "@/lib/paths";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { date, statusLabel } from "@/lib/format";
import type { RequestStatus } from "@/lib/types";

interface Row {
  id: number;
  request_no: string;
  po_no: string;
  status: string;
  created_at: string;
  facility_id: number;
  order_request_lines: { qty: number }[];
}

const STATUSES = ["open", "raised", "partially_dispatched", "dispatched", "received", "closed", "cancelled", "all"];

export default function RequestsPage() {
  const { facilities } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("open");
  const [fac, setFac] = useState<string>("all");

  useEffect(() => {
    let q = supabaseBrowser()
      .from("order_requests")
      .select("id,request_no,po_no,status,created_at,facility_id,order_request_lines(qty)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status === "open") q = q.in("status", ["raised", "partially_dispatched", "dispatched"]);
    else if (status !== "all") q = q.eq("status", status as RequestStatus);
    if (fac !== "all") q = q.eq("facility_id", Number(fac));
    q.then(({ data }) => setRows((data ?? []) as Row[]));
  }, [status, fac]);

  const fname = (id: number) => facilities.find((f) => f.id === id)?.name ?? id;

  return (
    <>
      <PageHeader title="Order requests" subtitle="Stock requested from the warehouse. Each request carries its PO for Finance." actions={<LinkButton href="/requests/new">New request</LinkButton>} />
      <Card
        pad={false}
        actions={
          <>
            <Select value={fac} onChange={(e) => setFac(e.target.value)} className="h-9 w-52">
              <option value="all">All facilities</option>
              {facilities
                .filter((f) => f.type !== "warehouse")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-48 capitalize">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </>
        }
        title="Requests"
      >
        {rows.length === 0 ? (
          <Empty title="No requests">Create one to send stock to a clinic or the STF store.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Facility</Th>
                <Th>Date</Th>
                <Th right>SKUs</Th>
                <Th right>Units</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-n50">
                  <Td>
                    <Link href={paths.request(r.id)} className="font-semibold hover:underline">
                      {r.request_no}
                    </Link>
                    <div className="text-xs text-n800">{r.po_no}</div>
                  </Td>
                  <Td>{fname(r.facility_id)}</Td>
                  <Td>{date(r.created_at)}</Td>
                  <Td right>{r.order_request_lines.length}</Td>
                  <Td right>{r.order_request_lines.reduce((s, l) => s + l.qty, 0)}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
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
