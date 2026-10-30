"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RiArrowLeftRightLine, RiDeleteBinLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { SkuPicker } from "@/components/SkuPicker";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { paths, useIdParam } from "@/lib/paths";
import { NON_FG_CATEGORIES, type FoLineView } from "@/lib/types";
import { COURIERS } from "@/lib/couriers";
import { errMsg } from "@/lib/format";

interface DLine {
  key: string;
  fo_line_id: number | null;
  sku: string;
  name: string;
  qty: number;
  substituteFor?: string;
}

/** Record what left a fulfiller against a fulfilment order: Frido WH (copied from Uniware) or a super stockist. */
export default function DispatchPage() {
  const foId = Number(useIdParam());
  const router = useRouter();
  const { facilities } = useApp();
  const [foLines, setFoLines] = useState<FoLineView[]>([]);
  const [lines, setLines] = useState<DLine[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [subFor, setSubFor] = useState<number | null>(null);
  const [extra, setExtra] = useState(false);
  const [h, setH] = useState({ dispatched_at: new Date().toISOString().slice(0, 10), uniware_ref: "", invoice_no: "", dc_no: "", dn_no: "", carton_count: "", courier: "", awb_no: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const first = foLines[0];
  const from = facilities.find((f) => f.id === first?.fulfiller_id);
  const to = facilities.find((f) => f.id === first?.facility_id);
  const fromSs = from?.type === "super_stockist";

  useEffect(() => {
    if (!foId) return;
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.from("v_fo_lines").select("*").eq("fo_id", foId).order("fo_line_id");
      const fl = (data ?? []) as FoLineView[];
      setFoLines(fl);
      setLines(fl.filter((l) => l.pending_qty > 0).map((l) => ({ key: `f${l.fo_line_id}`, fo_line_id: l.fo_line_id, sku: l.sku, name: l.item_name, qty: l.pending_qty })));
      // a super stockist ships from its own stock: show what it has
      if (fl[0]) {
        const { data: bal } = await sb.from("stock_balances").select("sku,qty").eq("facility_id", fl[0].fulfiller_id).eq("bucket", "sellable");
        setStock(Object.fromEntries((bal ?? []).map((b) => [b.sku, b.qty])));
      }
    })();
  }, [foId]);

  const set = (k: keyof typeof h, v: string) => setH((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().rpc("dispatch_fulfilment_order", {
      p_fo_id: foId,
      p_header: { ...h, carton_count: h.carton_count === "" ? null : Number(h.carton_count) },
      p_lines: lines.filter((l) => l.qty > 0).map((l) => ({ fo_line_id: l.fo_line_id, sku: l.sku, qty: l.qty })),
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(paths.request(first.request_id));
  };

  if (!first) return <Empty title="Loading…" />;
  const total = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const short = fromSs ? lines.filter((l) => l.qty > (stock[l.sku] ?? 0)) : [];

  return (
    <>
      <PageHeader
        title={`Dispatch ${first.fo_no}`}
        subtitle={`${from?.name} → ${to?.name} · request ${first.request_no}${fromSs ? "" : ". Copy the numbers from the Uniware gate pass / invoice."}`}
        back={{ href: paths.request(first.request_id), label: first.request_no }}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Shipment details" className="lg:col-span-1">
          <div className="grid gap-4">
            <Field label="Dispatch date">
              <Input type="date" value={h.dispatched_at} onChange={(e) => set("dispatched_at", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Courier">
                <Select value={h.courier} onChange={(e) => set("courier", e.target.value)}>
                  <option value="">—</option>
                  {COURIERS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="AWB / docket">
                <Input value={h.awb_no} onChange={(e) => set("awb_no", e.target.value)} />
              </Field>
            </div>
            {!fromSs && (
              <Field label="Uniware ref (STO / gate pass)">
                <Input value={h.uniware_ref} onChange={(e) => set("uniware_ref", e.target.value)} />
              </Field>
            )}
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
              + SKU not on the order
            </Button>
          }
        >
          {(subFor !== null || extra) && (
            <div className="border-b border-n300 bg-y50 p-4">
              <p className="mb-2 text-sm font-medium">
                {subFor !== null ? `Substitute for ${foLines.find((r) => r.fo_line_id === subFor)?.sku}` : "Extra SKU (not on the order)"}
              </p>
              <SkuPicker
                excludeCategories={NON_FG_CATEGORIES}
                onPick={(it) => {
                  const fl = foLines.find((r) => r.fo_line_id === subFor);
                  setLines((ls) => [...ls, { key: `x${Date.now()}`, fo_line_id: subFor, sku: it.sku, name: it.name, qty: 1, substituteFor: fl?.sku }]);
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
                <Th right>Allocated</Th>
                <Th right>Already sent</Th>
                {fromSs && <Th right>In stock</Th>}
                <Th right>Sending now</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const fl = foLines.find((r) => r.fo_line_id === l.fo_line_id);
                return (
                  <tr key={l.key}>
                    <Td>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-n800">
                        {l.sku} {l.substituteFor && <Badge tone="yellow">sub for {l.substituteFor}</Badge>}
                        {!l.fo_line_id && <Badge tone="red">not on order</Badge>}
                      </div>
                    </Td>
                    <Td right>{l.substituteFor ? "—" : fl?.qty ?? "—"}</Td>
                    <Td right>{l.substituteFor ? "—" : fl?.dispatched_qty ?? "—"}</Td>
                    {fromSs && (
                      <Td right className={l.qty > (stock[l.sku] ?? 0) ? "font-semibold text-red-a" : ""}>
                        {stock[l.sku] ?? 0}
                      </Td>
                    )}
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
                        {l.fo_line_id && !l.substituteFor && (
                          <button className="text-n700 hover:text-ink" title="Sending a different SKU instead" onClick={() => setSubFor(l.fo_line_id)}>
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
            <p className="text-xs text-n800">
              Set 0 for anything not shipped now; it stays pending on the order. Use ⇄ when another size/colour goes instead.
              {fromSs && " Units leave this super stockist's stock as soon as you save."}
            </p>
            {short.length > 0 && <Alert tone="yellow">Not enough stock for {short.map((l) => l.sku).join(", ")}. Reduce the quantity or count stock first.</Alert>}
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
