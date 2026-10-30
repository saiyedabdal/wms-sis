"use client";

import { paths } from "@/lib/paths";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { date, statusLabel } from "@/lib/format";
import { REQUEST_SOURCES, type RequestStatus } from "@/lib/types";

interface Row {
  id: number;
  request_no: string;
  po_no: string | null;
  source: string;
  status: string;
  created_at: string;
  facility_id: number;
  order_request_lines: { qty: number }[];
}

const STATUSES = ["open", "draft", "submitted", "pending_approval", "approved", "rejected", "partially_dispatched", "dispatched", "received", "closed", "cancelled", "all"];
const OPEN: RequestStatus[] = ["draft", "submitted", "pending_approval", "approved", "rejected", "partially_dispatched", "dispatched"];

export default function RequestsPage() {
  const { facilities, isOps } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("open");
  const [fac, setFac] = useState<string>("all");

  useEffect(() => {
    let q = supabaseBrowser()
      .from("order_requests")
      .select("id,request_no,po_no,source,status,created_at,facility_id,order_request_lines(qty)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status === "open") q = q.in("status", OPEN);
    else if (status !== "all") q = q.eq("status", status as RequestStatus);
    if (fac !== "all") q = q.eq("facility_id", Number(fac));
    q.then(({ data }) => setRows((data ?? []) as Row[]));
  }, [status, fac]);

  const fname = (id: number) => facilities.find((f) => f.id === id)?.name ?? id;

  return (
    <>
      <PageHeader
        title="Tracking"
        subtitle="Every request from draft to received. Open one to see its approval, routing, shipments and courier tracking."
        actions={<LinkButton href="/requests/new">{isOps ? "New request" : "Request stock"}</LinkButton>}
      />
      <Card
        pad={false}
        actions={
          <>
            {isOps && <Select value={fac} onChange={(e) => setFac(e.target.value)} className="h-9 w-52">
              <option value="all">All facilities</option>
              {facilities
                .filter((f) => f.type !== "warehouse")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>}
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
                    <div className="text-xs text-n800">{[REQUEST_SOURCES[r.source], r.po_no].filter(Boolean).join(" · ")}</div>
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
