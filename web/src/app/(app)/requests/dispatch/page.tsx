"use client";

import { paths, useIdParam } from "@/lib/paths";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RiArrowLeftRightLine, RiDeleteBinLine } from "@remixicon/react";
import { SkuPicker } from "@/components/SkuPicker";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table, Td, Textarea, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { NON_FG_CATEGORIES, type RequestLineView } from "@/lib/types";
import { errMsg } from "@/lib/format";

interface DLine {
  key: string;
  request_line_id: number | null;
  sku: string;
  name: string;
  qty: number;
  substituteFor?: string;
}

export default function DispatchPage() {
  const id = useIdParam();
  const router = useRouter();
  const [reqNo, setReqNo] = useState("");
  const [reqLines, setReqLines] = useState<RequestLineView[]>([]);
  const [lines, setLines] = useState<DLine[]>([]);
  const [subFor, setSubFor] = useState<number | null>(null);
  const [extra, setExtra] = useState(false);
  const [h, setH] = useState({ dispatched_at: new Date().toISOString().slice(0, 10), uniware_ref: "", invoice_no: "", dc_no: "", dn_no: "", carton_count: "", courier: "", awb_no: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("v_request_lines")
      .select("*")
      .eq("request_id", Number(id))
      .order("request_line_id")
      .then(({ data }) => {
        const rl = (data ?? []) as RequestLineView[];
        setReqLines(rl);
        setReqNo(rl[0]?.request_no ?? "");
        setLines(
          rl
            .filter((l) => l.pending_dispatch_qty > 0)
            .map((l) => ({ key: `r${l.request_line_id}`, request_line_id: l.request_line_id, sku: l.sku, name: l.item_name, qty: l.pending_dispatch_qty })),
        );
      });
  }, [id]);

  const set = (k: keyof typeof h, v: string) => setH((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().rpc("create_shipment", {
      p_request_id: Number(id),
      p_header: { ...h, carton_count: h.carton_count === "" ? null : Number(h.carton_count) },
      p_lines: lines.filter((l) => l.qty > 0).map((l) => ({ request_line_id: l.request_line_id, sku: l.sku, qty: l.qty })),
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(paths.request(id));
  };

  const total = lines.reduce((s, l) => s + (l.qty || 0), 0);

  return (
    <>
      <PageHeader title="Record dispatch" subtitle={`Against ${reqNo}. Copy the numbers from the Uniware gate pass / invoice.`} back={{ href: paths.request(id), label: reqNo || "Request" }} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Shipment details" className="lg:col-span-1">
          <div className="grid gap-4">
            <Field label="Dispatch date">
              <Input type="date" value={h.dispatched_at} onChange={(e) => set("dispatched_at", e.target.value)} />
            </Field>
            <Field label="Uniware ref (STO / gate pass)">
              <Input value={h.uniware_ref} onChange={(e) => set("uniware_ref", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice no.">
                <Input value={h.invoice_no} onChange={(e) => set("invoice_no", e.target.value)} />
              </Field>
              <Field label="DC no.">
                <Input value={h.dc_no} onChange={(e) => set("dc_no", e.target.value)} />
              </Field>
              <Field label="DN no.">
                <Input value={h.dn_no} onChange={(e) => set("dn_no", e.target.value)} />
              </Field>
              <Field label="Cartons">
                <Input type="number" min={0} value={h.carton_count} onChange={(e) => set("carton_count", e.target.value)} />
              </Field>
              <Field label="Courier">
                <Input value={h.courier} onChange={(e) => set("courier", e.target.value)} />
              </Field>
              <Field label="AWB / docket">
                <Input value={h.awb_no} onChange={(e) => set("awb_no", e.target.value)} />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea value={h.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
            </Field>
          </div>
        </Card>

        <Card
          title={`Lines · ${total} units`}
          className="lg:col-span-2"
          pad={false}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setExtra((x) => !x)}>
              + SKU not on request
            </Button>
          }
        >
          {(subFor !== null || extra) && (
            <div className="border-b border-n300 bg-y50 p-4">
              <p className="mb-2 text-sm font-medium">
                {subFor !== null ? `Substitute for ${reqLines.find((r) => r.request_line_id === subFor)?.sku}` : "Extra SKU (not requested)"}
              </p>
              <SkuPicker
                excludeCategories={NON_FG_CATEGORIES}
                onPick={(it) => {
                  const rl = reqLines.find((r) => r.request_line_id === subFor);
                  setLines((ls) => [...ls, { key: `x${Date.now()}`, request_line_id: subFor, sku: it.sku, name: it.name, qty: 1, substituteFor: rl?.sku }]);
                  setSubFor(null);
                  setExtra(false);
                }}
              />
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th right>Requested</Th>
                <Th right>Already sent</Th>
                <Th right>Sending now</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const rl = reqLines.find((r) => r.request_line_id === l.request_line_id);
                return (
                  <tr key={l.key}>
                    <Td>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-n800">
                        {l.sku} {l.substituteFor && <Badge tone="yellow">sub for {l.substituteFor}</Badge>}
                        {!l.request_line_id && <Badge tone="red">not requested</Badge>}
                      </div>
                    </Td>
                    <Td right>{l.substituteFor ? "—" : rl?.requested_qty ?? "—"}</Td>
                    <Td right>{l.substituteFor ? "—" : rl?.dispatched_qty ?? "—"}</Td>
                    <Td right>
                      <Input
                        type="number"
                        min={0}
                        value={l.qty}
                        className="ml-auto h-9 w-20 text-right"
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value)) } : x)))}
                      />
                    </Td>
                    <Td right>
                      <div className="flex justify-end gap-3">
                        {l.request_line_id && !l.substituteFor && (
                          <button className="text-n700 hover:text-ink" title="Warehouse sent a different SKU" onClick={() => setSubFor(l.request_line_id)}>
                            <RiArrowLeftRightLine size={16} />
                          </button>
                        )}
                        <button className="text-n700 hover:text-red-a" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove">
                          <RiDeleteBinLine size={16} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="flex flex-col gap-3 border-t border-n300 p-4">
            <p className="text-xs text-n800">Set 0 for anything not shipped now — it stays pending on the request. Use ⇄ when the warehouse sent another size/colour instead.</p>
            {err && <Alert>{err}</Alert>}
            <Button onClick={submit} disabled={busy || total === 0} className="self-end">
              {busy ? "Saving…" : "Save dispatch"}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
