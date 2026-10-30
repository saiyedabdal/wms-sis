"use client";

import { useIdParam } from "@/lib/paths";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import Link from "next/link";
import { Badge, Card, CopyBlock, Empty, LinkButton, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bucketLabel, type Bucket } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { discrepancyEmail, type GrnLineDoc } from "@/lib/documents";

interface Grn {
  id: number;
  grn_no: string;
  facility_id: number;
  dn_no: string | null;
  invoice_no: string | null;
  dc_no: string | null;
  gate_pass_no: string | null;
  cartons_received: number | null;
  notes: string | null;
  has_discrepancy: boolean;
  received_at: string;
  shipments: { shipment_no: string; uniware_ref: string | null; carton_count: number | null; order_requests: { request_no: string } | null } | null;
}

type Line = GrnLineDoc & { id: number; bucket: Bucket };

export default function GrnDetail() {
  const id = useIdParam();
  const { facilities } = useApp();
  const [g, setG] = useState<Grn | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [photos, setPhotos] = useState<{ url: string; line: number | null }[]>([]);
  const [ret, setRet] = useState<{ return_no: string; status: string; to_facility_id: number | null } | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const [{ data: grn }, { data: gl }, { data: ph }] = await Promise.all([
        sb.from("grns").select("*,shipments(shipment_no,uniware_ref,carton_count,order_requests(request_no))").eq("id", Number(id)).single(),
        sb.from("grn_lines").select("id,sku,bucket,expected_qty,received_qty,damaged_qty,rejected_qty,quarantine_qty,reason,notes,items(name)").eq("grn_id", Number(id)).order("id"),
        sb.from("grn_photos").select("storage_path,grn_line_id").eq("grn_id", Number(id)),
      ]);
      setG(grn as unknown as Grn);
      const { data: r } = await sb.from("wh_returns").select("return_no,status,to_facility_id").eq("grn_id", Number(id)).maybeSingle();
      setRet(r);
      setLines(((gl ?? []) as Record<string, unknown>[]).map((l) => ({ ...(l as unknown as Line), item_name: (l.items as { name: string } | null)?.name ?? (l.sku as string) })));
      if (ph?.length) {
        const { data: signed } = await sb.storage.from("grn-photos").createSignedUrls(ph.map((p) => p.storage_path), 3600);
        setPhotos((signed ?? []).map((s, i) => ({ url: s.signedUrl ?? "", line: ph[i].grn_line_id })));
      }
    })();
  }, [id]);

  const facility = facilities.find((f) => f.id === g?.facility_id);
  if (!g || !facility) return <Empty title="Loading…" />;

  const mail = discrepancyEmail(
    {
      grn_no: g.grn_no,
      shipment_no: g.shipments?.shipment_no ?? "",
      request_no: g.shipments?.order_requests?.request_no ?? "",
      uniware_ref: g.shipments?.uniware_ref ?? g.gate_pass_no,
      dn_no: g.dn_no,
      invoice_no: g.invoice_no,
      dc_no: g.dc_no,
      cartons_expected: g.shipments?.carton_count ?? null,
      cartons_received: g.cartons_received,
      received_at: g.received_at,
    },
    facility,
    lines,
  );

  return (
    <>
      <PageHeader
        title={g.grn_no}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {g.shipments?.shipment_no} · {g.shipments?.order_requests?.request_no} · {dateTime(g.received_at)}
            {g.has_discrepancy ? <Badge tone="red">discrepancy</Badge> : <Badge tone="green">matched</Badge>}
          </span>
        }
        back={{ href: "/receive", label: "Receive" }}
      />
      <div className="flex flex-col gap-6">
        <Card pad={false} title="Received lines">
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Into</Th>
                <Th right>Sent</Th>
                <Th right>Good</Th>
                <Th right>Damaged</Th>
                <Th right>Refused</Th>
                <Th right>Quarantine</Th>
                <Th>Result</Th>
                <Th>Photos</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <div className="font-medium">{l.item_name}</div>
                    <div className="text-xs text-n800">
                      {l.sku}
                      {l.notes ? ` · ${l.notes}` : ""}
                    </div>
                  </Td>
                  <Td>{bucketLabel(l.bucket)}</Td>
                  <Td right>{l.expected_qty}</Td>
                  <Td right>{l.received_qty}</Td>
                  <Td right>{l.damaged_qty}</Td>
                  <Td right className={l.rejected_qty ? "text-red-a" : "text-n700"}>
                    {l.rejected_qty ?? 0}
                  </Td>
                  <Td right className={l.quarantine_qty ? "font-semibold" : "text-n700"}>
                    {l.quarantine_qty ?? 0}
                  </Td>
                  <Td>
                    <StatusBadge status={l.reason} />
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {photos
                        .filter((p) => p.line === l.id)
                        .map((p) => (
                          <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="" className="size-10 rounded-xs object-cover" />
                          </a>
                        ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="grid gap-2 border-t border-n300 p-4 text-sm text-n800 md:grid-cols-4">
            <span>DN: {g.dn_no || "—"}</span>
            <span>Invoice: {g.invoice_no || "—"}</span>
            <span>DC: {g.dc_no || "—"}</span>
            <span>
              Cartons: {g.cartons_received ?? "—"} / {g.shipments?.carton_count ?? "—"}
            </span>
          </div>
        </Card>
        {ret && (
          <Card>
            <p className="text-sm">
              Refused units are on return <span className="font-semibold">{ret.return_no}</span> to{" "}
              {facilities.find((f) => f.id === ret.to_facility_id)?.name ?? "Frido WH"} · <StatusBadge status={ret.status} />{" "}
              <Link href="/returns" className="text-blue hover:underline">
                Returns
              </Link>
            </p>
          </Card>
        )}
        <Card title="Next">
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/returns/?grn=${g.id}`} variant="secondary">
              Return items from this receipt
            </LinkButton>
            <LinkButton href={`/stock/issue/?grn=${g.id}`} variant="secondary">
              Issue items (training / demo / sample)
            </LinkButton>
          </div>
        </Card>
        {g.has_discrepancy ? (
          <CopyBlock title="Discrepancy email to the sender" subject={mail.subject} body={mail.body} />
        ) : (
          <Card>
            <p className="text-sm text-n800">Everything matched the dispatch. No email needed.</p>
          </Card>
        )}
      </div>
    </>
  );
}
