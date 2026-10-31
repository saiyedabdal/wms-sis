"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Empty, LinkButton, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { paths } from "@/lib/paths";
import { REQUEST_SOURCES } from "@/lib/types";
import { dateTime, inr } from "@/lib/format";

interface Row {
  id: number;
  request_no: string;
  status: string;
  source: string;
  facility_id: number;
  created_at: string;
  sent_for_approval_by: string | null;
  order_request_lines: { qty: number; unit_price: number }[];
}

const SELECT = "id,request_no,status,source,facility_id,created_at,sent_for_approval_by,order_request_lines(qty,unit_price)";

/** Step 6: assigned ops review and send; the manager approves. */
export default function ApprovalsPage() {
  const { facilities, profile, isManager } = useApp();
  const [pending, setPending] = useState<Row[]>([]);
  const [review, setReview] = useState<Row[]>([]);
  const [mine, setMine] = useState(true);
  const [myFacilities, setMyFacilities] = useState<number[] | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from("facility_ops")
      .select("facility_id")
      .eq("user_id", profile.id)
      .then(({ data }) => setMyFacilities((data ?? []).map((d) => d.facility_id)));
    sb.from("order_requests")
      .select(SELECT)
      .eq("status", "pending_approval")
      .order("sent_for_approval_at")
      .then(({ data }) => setPending((data ?? []) as Row[]));
    sb.from("order_requests")
      .select(SELECT)
      .in("status", ["submitted", "draft", "rejected"])
      .order("created_at")
      .then(({ data }) => setReview((data ?? []) as Row[]));
  }, [profile.id]);

  const name = (id: number) => facilities.find((f) => f.id === id)?.name ?? id;
  const value = (r: Row) => r.order_request_lines.reduce((s, l) => s + l.qty * Number(l.unit_price), 0);
  const filteredReview = mine && myFacilities?.length ? review.filter((r) => myFacilities.includes(r.facility_id)) : review;

  const table = (rows: Row[], action: string) => (
    <Table>
      <thead>
        <tr>
          <Th>Request</Th>
          <Th>Facility</Th>
          <Th>From</Th>
          <Th>Since</Th>
          <Th right>Units</Th>
          <Th right>Value</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>
              <Link href={paths.request(r.id)} className="font-semibold hover:underline">
                {r.request_no}
              </Link>
            </Td>
            <Td>{name(r.facility_id)}</Td>
            <Td>{REQUEST_SOURCES[r.source]}</Td>
            <Td>{dateTime(r.created_at)}</Td>
            <Td right>{r.order_request_lines.reduce((s, l) => s + l.qty, 0)}</Td>
            <Td right>{inr(value(r))}</Td>
            <Td>
              <StatusBadge status={r.status} />
            </Td>
            <Td right>
              <LinkButton href={paths.request(r.id)} size="sm" variant={action === "Approve" ? "primary" : "secondary"}>
                {action}
              </LinkButton>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="Approvals" subtitle="Requests from the demand plan and from facilities: ops review and send, the manager approves." />
      <div className="flex flex-col gap-6">
        <Card title={`Waiting for manager approval · ${pending.length}`} pad={false}>
          {pending.length === 0 ? (
            <Empty title="Nothing waiting" />
          ) : (
            table(pending, isManager ? "Approve" : "Open")
          )}
          {isManager && pending.some((r) => r.sent_for_approval_by === profile.id) && (
            <p className="border-t border-n300 px-4 py-3 text-xs text-n800">Requests you sent yourself need another manager or admin to approve.</p>
          )}
        </Card>
        <Card
          title={`To review & send · ${filteredReview.length}`}
          pad={false}
          actions={
            myFacilities && myFacilities.length > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[#131313]" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                Only my facilities ({myFacilities.length})
              </label>
            ) : (
              <span className="text-xs text-n800">Assign yourself to facilities under Facilities → Details to filter this list</span>
            )
          }
        >
          {filteredReview.length === 0 ? <Empty title="Nothing to review" /> : table(filteredReview, "Review")}
        </Card>
      </div>
    </>
  );
}
