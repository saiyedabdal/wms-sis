"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RiDownload2Line, RiExternalLinkLine, RiFilePdf2Line, RiTruckLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { RequestLinesEditor, toPayload, type ReqLine } from "@/components/RequestLinesEditor";
import { Alert, Badge, Button, Card, CopyBlock, Empty, Input, LinkButton, PageHeader, StatusBadge, Stat, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { paths, useIdParam } from "@/lib/paths";
import { REQUEST_SOURCES, bucketLabel, type FoLineView, type RequestLineView } from "@/lib/types";
import { date, dateTime, errMsg, inr, num } from "@/lib/format";
import { downloadPoPdf, financePoEmail, poTotals, warehouseRequestEmail } from "@/lib/documents";
import { downloadXlsx } from "@/lib/export";
import { trackingUrl } from "@/lib/couriers";

interface Req {
  id: number;
  request_no: string;
  po_no: string | null;
  status: string;
  source: string;
  notes: string | null;
  created_at: string;
  submitted_at: string | null;
  sent_for_approval_at: string | null;
  sent_for_approval_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  closed_at: string | null;
  facility_id: number;
  warehouse_id: number | null;
}

interface Fo {
  id: number;
  fo_no: string;
  status: string;
  fulfiller_id: number;
  created_at: string;
}

interface Shipment {
  id: number;
  shipment_no: string;
  status: string;
  dispatched_at: string;
  created_at: string;
  courier: string | null;
  awb_no: string | null;
  uniware_ref: string | null;
  carton_count: number | null;
  fulfilment_order_id: number | null;
  shipment_lines: { qty: number; is_substitute: boolean }[];
  grns: { id: number; grn_no: string; has_discrepancy: boolean; received_at: string }[] | { id: number; grn_no: string; has_discrepancy: boolean; received_at: string } | null;
}

const PRE_APPROVAL = ["draft", "submitted", "pending_approval", "rejected"];
const grnOf = (s: Shipment) => (Array.isArray(s.grns) ? s.grns[0] : s.grns);

export default function RequestDetail() {
  const id = Number(useIdParam());
  const { facilities, profile, isOps, isManager, audience, facility: myFacility } = useApp();
  const [req, setReq] = useState<Req | null>(null);
  const [lines, setLines] = useState<RequestLineView[]>([]);
  const [fos, setFos] = useState<Fo[]>([]);
  const [foLines, setFoLines] = useState<FoLineView[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"lines" | "fulfilment" | "emails">("lines");
  const [editing, setEditing] = useState<ReqLine[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = supabaseBrowser();
    const [r, l, f, fl, s] = await Promise.all([
      sb.from("order_requests").select("*").eq("id", id).single(),
      sb.from("v_request_lines").select("*").eq("request_id", id).order("request_line_id"),
      sb.from("fulfilment_orders").select("id,fo_no,status,fulfiller_id,created_at").eq("request_id", id).order("id"),
      sb.from("v_fo_lines").select("*").eq("request_id", id).order("fo_line_id"),
      sb
        .from("shipments")
        .select("id,shipment_no,status,dispatched_at,created_at,courier,awb_no,uniware_ref,carton_count,fulfilment_order_id,shipment_lines(qty,is_substitute),grns(id,grn_no,has_discrepancy,received_at)")
        .eq("request_id", id)
        .order("created_at"),
    ]);
    const rq = r.data as unknown as Req;
    setReq(rq);
    setLines((l.data ?? []) as RequestLineView[]);
    setFos((f.data ?? []) as Fo[]);
    setFoLines((fl.data ?? []) as FoLineView[]);
    setShipments((s.data ?? []) as unknown as Shipment[]);
    // names for the timeline (Frido roles can read profiles; others just see the timestamps)
    const ids = [rq?.sent_for_approval_by, rq?.decided_by].filter(Boolean) as string[];
    if (ids.length) {
      const { data } = await sb.from("profiles").select("id,full_name,email").in("id", ids);
      setNames(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || p.email || ""])));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const facility = facilities.find((f) => f.id === req?.facility_id);
  const fac = (fid: number) => facilities.find((f) => f.id === fid);

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setErr(errMsg(error));
      return false;
    }
    setNote("");
    await load();
    return true;
  };
  const sb = supabaseBrowser();

  const timeline = useMemo(() => {
    if (!req) return [];
    const firstShip = shipments[0];
    const received = shipments.map(grnOf).filter(Boolean).sort((a, b) => (a!.received_at < b!.received_at ? 1 : -1))[0];
    const routed = fos
      .map((fo) => `${fac(fo.fulfiller_id)?.name ?? "?"}: ${foLines.filter((x) => x.fo_id === fo.id).reduce((s, x) => s + x.qty, 0)}`)
      .join(" · ");
    return [
      { label: "Created", at: req.created_at, detail: REQUEST_SOURCES[req.source] },
      req.source === "retailer" ? { label: "Submitted", at: req.submitted_at, detail: undefined } : null,
      {
        label: "Sent for approval",
        at: req.sent_for_approval_at,
        detail: req.sent_for_approval_by ? names[req.sent_for_approval_by] : undefined,
      },
      {
        label: req.status === "rejected" ? "Rejected" : "Approved",
        at: req.decided_at,
        detail: [req.decided_by && names[req.decided_by], req.decision_note].filter(Boolean).join(" · ") || undefined,
        bad: req.status === "rejected",
      },
      { label: "Routed", at: fos[0]?.created_at ?? null, detail: routed || undefined },
      { label: "Dispatched", at: firstShip?.created_at ?? null, detail: shipments.length ? `${shipments.length} shipment${shipments.length > 1 ? "s" : ""}` : undefined },
      { label: "Received", at: received?.received_at ?? null, detail: received?.grn_no },
      { label: req.status === "cancelled" ? "Cancelled" : "Closed", at: req.closed_at, bad: req.status === "cancelled" },
    ].filter(Boolean) as { label: string; at: string | null; detail?: string; bad?: boolean }[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, fos, foLines, shipments, names, facilities]);

  if (!req || !facility) return <Empty title="Loading…" />;

  const t = poTotals(lines);
  const disp = lines.reduce((s, l) => s + Number(l.dispatched_qty), 0);
  const recv = lines.reduce((s, l) => s + Number(l.received_qty), 0);
  const preApproval = PRE_APPROVAL.includes(req.status);
  const canEdit = isOps ? ["draft", "submitted", "rejected"].includes(req.status) : req.status === "submitted";
  const canSend = isOps && ["draft", "submitted", "rejected"].includes(req.status);
  const canDecide = isManager && req.status === "pending_approval" && req.sent_for_approval_by !== profile.id;
  const canCancel = !shipments.length && (isOps ? !["closed", "cancelled"].includes(req.status) : req.status === "submitted");
  const canClose = isOps && ["approved", "partially_dispatched", "dispatched", "received"].includes(req.status);
  const canDispatch = (fo: Fo) => {
    if (!["open", "partially_dispatched"].includes(fo.status)) return false;
    const f = fac(fo.fulfiller_id);
    if (f?.type === "warehouse") return isOps;
    return isOps || (audience === "ss" && myFacility?.id === fo.fulfiller_id);
  };

  const startEdit = () =>
    setEditing(
      lines.map((l) => ({
        sku: l.sku,
        name: l.item_name,
        category_name: l.category_name,
        gst_pct: l.gst_pct,
        mrp: null,
        msp: l.msp,
        margin_pct: l.margin_pct,
        bucket: l.bucket,
        qty: l.requested_qty,
        suggested_qty: l.suggested_qty,
      })),
    );

  const whFos = fos.filter((fo) => fac(fo.fulfiller_id)?.type === "warehouse");

  return (
    <>
      <PageHeader
        title={req.request_no}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {facility.name} · {REQUEST_SOURCES[req.source]} · {date(req.created_at)}
            {req.po_no && <> · PO {req.po_no}</>} <StatusBadge status={req.status} />
          </span>
        }
        back={{ href: "/requests", label: "Tracking" }}
        actions={
          req.po_no ? (
            <>
              <Button variant="secondary" onClick={() => downloadPoPdf(req, facility, lines)}>
                <RiFilePdf2Line size={16} /> PO PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  downloadXlsx(req.request_no, {
                    Request: lines.map((l, i) => ({
                      "#": i + 1,
                      SKU: l.sku,
                      Product: l.item_name,
                      Purpose: bucketLabel(l.bucket),
                      Suggested: l.suggested_qty,
                      Qty: l.requested_qty,
                      MSP: Number(l.msp),
                      "Margin %": Number(l.margin_pct),
                      "Unit price": Number(l.unit_price),
                      "GST %": Number(l.gst_pct),
                      Total: Number(l.line_total),
                      Dispatched: Number(l.dispatched_qty),
                      Received: Number(l.received_qty),
                      Damaged: Number(l.damaged_qty),
                      Refused: Number(l.rejected_qty),
                    })),
                  })
                }
              >
                <RiDownload2Line size={16} /> Excel
              </Button>
            </>
          ) : undefined
        }
      />

      {/* tracking timeline */}
      <Card className="mb-6">
        <ol className="grid gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {timeline.map((s, i) => {
            const done = !!s.at;
            const current = !done && (i === 0 || !!timeline[i - 1].at);
            return (
              <li key={s.label} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      done ? (s.bad ? "bg-red-b text-white" : "bg-ink text-yellow") : current ? "border-2 border-yellow bg-y50 text-ink" : "bg-n200 text-n700",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className={cx("text-sm font-semibold", !done && "text-n700")}>{s.label}</span>
                </div>
                {done && <span className="text-xs text-n800">{dateTime(s.at)}</span>}
                {s.detail && <span className="text-xs text-n800">{s.detail}</span>}
              </li>
            );
          })}
        </ol>
      </Card>

      {err && (
        <div className="mb-4">
          <Alert>{err}</Alert>
        </div>
      )}

      {/* what can be done next */}
      {(canSend || canDecide || canEdit || req.status === "pending_approval" || req.status === "rejected") && !editing && (
        <Card className="mb-6" title="Next step">
          <div className="flex flex-col gap-4">
            {req.status === "rejected" && req.decision_note && <Alert tone="red">Rejected: {req.decision_note}</Alert>}
            {req.status === "pending_approval" && !canDecide && (
              <Alert tone="yellow">
                Waiting for the manager&apos;s approval{req.sent_for_approval_by === profile.id ? " (you sent it, so another manager must approve)" : ""}.
              </Alert>
            )}
            {req.status === "submitted" && !isOps && <Alert tone="blue">Submitted to Frido. You can still edit or cancel it until Frido picks it up.</Alert>}
            {canDecide && (
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" className="md:max-w-md" />
                <Button disabled={busy} onClick={() => run(() => sb.rpc("approve_request", { p_request_id: req.id, p_note: (note || null) as string }))}>
                  Approve {inr(t.total)}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => run(() => sb.rpc("reject_request", { p_request_id: req.id, p_note: note }))}>
                  Reject
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="secondary" onClick={startEdit}>
                  Edit lines
                </Button>
              )}
              {canSend && (
                <Button disabled={busy} onClick={() => run(() => sb.rpc("send_for_approval", { p_request_id: req.id }))}>
                  Send for approval
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {editing ? (
        <Card
          title="Edit lines"
          pad={false}
          className="mb-6"
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(() =>
                    sb.rpc("update_request_lines", { p_request_id: req.id, p_lines: toPayload(editing), p_notes: null as unknown as string }),
                  );
                  if (ok) setEditing(null);
                }}
              >
                Save lines
              </Button>
            </>
          }
        >
          <RequestLinesEditor facility={facility} lines={editing} setLines={(fn) => setEditing((ls) => fn(ls ?? []))} />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Requested" value={num(t.qty)} hint={`${lines.length} SKUs`} />
            <Stat label="Dispatched" value={num(disp)} hint={`${shipments.length} shipment${shipments.length === 1 ? "" : "s"}`} />
            <Stat label="Received good" value={num(recv)} />
            <Stat label={req.po_no ? "PO value" : "Value"} value={inr(t.total)} hint={`incl. ${inr(t.gst)} GST`} tone="yellow" />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "lines", label: "Lines" },
              { value: "fulfilment", label: `Fulfilment (${fos.length})` },
              ...(isOps && !preApproval ? [{ value: "emails" as const, label: "Emails" }] : []),
            ]}
          />

          {tab === "lines" && (
            <Card pad={false}>
              <Table>
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th>Purpose</Th>
                    <Th right>Plan</Th>
                    <Th right>Req</Th>
                    <Th right>Disp</Th>
                    <Th right>Recv</Th>
                    <Th right>Dmg / refused</Th>
                    <Th right>Unit price</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.request_line_id}>
                      <Td>
                        <div className="font-medium">{l.item_name}</div>
                        <div className="text-xs text-n800">
                          {l.sku} {Number(l.substituted_qty) > 0 && <Badge tone="yellow">{l.substituted_qty} substituted</Badge>}
                        </div>
                      </Td>
                      <Td>{bucketLabel(l.bucket)}</Td>
                      <Td right className="text-n800">
                        {l.suggested_qty ?? "—"}
                      </Td>
                      <Td right className="font-semibold">
                        {l.requested_qty}
                      </Td>
                      <Td right>{l.dispatched_qty}</Td>
                      <Td right>{l.received_qty}</Td>
                      <Td right className={Number(l.damaged_qty) + Number(l.rejected_qty) ? "text-red-a" : "text-n700"}>
                        {l.damaged_qty} / {l.rejected_qty}
                      </Td>
                      <Td right>
                        {inr(l.unit_price)}
                        <div className="text-xs text-n800">
                          MSP {inr(l.msp)} − {Number(l.margin_pct)}%
                        </div>
                      </Td>
                      <Td right>{inr(l.line_total)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-n300 p-4">
                <p className="text-xs text-n800">{req.notes ? `Notes: ${req.notes}` : "Partner price = MSP − margin, GST inclusive."}</p>
                <div className="flex gap-2">
                  {canCancel && (
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => sb.rpc("set_request_state", { p_request_id: req.id, p_status: "cancelled" }))}>
                      Cancel request
                    </Button>
                  )}
                  {canClose && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => sb.rpc("set_request_state", { p_request_id: req.id, p_status: "closed" }))}>
                      Close (no more dispatches)
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {tab === "fulfilment" && (
            <div className="flex flex-col gap-6">
              {fos.length === 0 && (
                <Card>
                  <Empty title="Not routed yet">On approval each line goes to the facility&apos;s super stockist as far as its free stock allows, the rest to Frido WH.</Empty>
                </Card>
              )}
              {fos.map((fo) => {
                const f = fac(fo.fulfiller_id);
                const fl = foLines.filter((x) => x.fo_id === fo.id);
                const ships = shipments.filter((s) => s.fulfilment_order_id === fo.id);
                return (
                  <Card
                    key={fo.id}
                    pad={false}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {fo.fo_no} · from {f?.name ?? "?"} <StatusBadge status={fo.status} />
                      </span>
                    }
                    actions={
                      canDispatch(fo) && (
                        <LinkButton href={paths.dispatch(fo.id)} size="sm">
                          <RiTruckLine size={14} /> Record dispatch
                        </LinkButton>
                      )
                    }
                  >
                    <Table>
                      <thead>
                        <tr>
                          <Th>Product</Th>
                          <Th right>Allocated</Th>
                          <Th right>Dispatched</Th>
                          <Th right>Pending</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {fl.map((x) => (
                          <tr key={x.fo_line_id}>
                            <Td>
                              <div className="font-medium">{x.item_name}</div>
                              <div className="text-xs text-n800">{x.sku}</div>
                            </Td>
                            <Td right>{x.qty}</Td>
                            <Td right>{x.dispatched_qty}</Td>
                            <Td right className={x.pending_qty ? "font-semibold" : "text-n700"}>
                              {x.pending_qty}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                    {ships.length > 0 && (
                      <div className="border-t border-n300 p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-n800">Shipments</p>
                        <ul className="flex flex-col gap-2 text-sm">
                          {ships.map((s) => {
                            const g = grnOf(s);
                            const url = trackingUrl(s.courier, s.awb_no);
                            return (
                              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-medium">{s.shipment_no}</span>
                                <span className="text-n800">{date(s.dispatched_at)}</span>
                                <span className="text-n800">{s.shipment_lines.reduce((a, x) => a + x.qty, 0)} units</span>
                                {s.courier && (
                                  <span className="text-n800">
                                    {s.courier}
                                    {s.awb_no && ` · ${s.awb_no}`}
                                  </span>
                                )}
                                {url && (
                                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline">
                                    Track <RiExternalLinkLine size={12} />
                                  </a>
                                )}
                                {s.shipment_lines.some((x) => x.is_substitute) && <Badge tone="yellow">substitutes</Badge>}
                                {g ? (
                                  <Link href={paths.grn(g.id)} className="hover:underline">
                                    {g.grn_no} {g.has_discrepancy ? <Badge tone="red">discrepancy</Badge> : <Badge tone="green">received</Badge>}
                                  </Link>
                                ) : (
                                  <StatusBadge status={s.status} />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {tab === "emails" && (
            <div className="flex flex-col gap-6">
              {whFos.map((fo) => {
                const pending = foLines
                  .filter((x) => x.fo_id === fo.id && x.pending_qty > 0)
                  .map((x) => ({ sku: x.sku, item_name: x.item_name, requested_qty: x.pending_qty, bucket: x.bucket }));
                if (!pending.length) return null;
                const mail = warehouseRequestEmail({ ...req, fo_no: fo.fo_no }, facility, pending);
                return (
                  <CopyBlock key={fo.id} title={`Email to Frido WH · ${fo.fo_no}`} to={fac(fo.fulfiller_id)?.contact_email ?? ""} subject={mail.subject} body={mail.body} />
                );
              })}
              {req.po_no && (
                <>
                  <Alert tone="blue">Download the PO PDF above and attach it to this mail.</Alert>
                  <CopyBlock title="PO email to Finance" {...financePoEmail(req, facility, lines)} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
