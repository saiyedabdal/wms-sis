"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { StockLineEditor, type OutLine } from "@/components/StockLineEditor";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg, inr } from "@/lib/format";

export default function NewSalePage() {
  const router = useRouter();
  const { facility } = useApp();
  const [lines, setLines] = useState<OutLine[]>([]);
  const [h, setH] = useState({ customer_name: "", customer_phone: "", bill_ref: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!facility) return null;

  const total = lines.reduce((s, l) => s + l.msp * l.qty, 0);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabaseBrowser().rpc("create_sale", {
      p_facility_id: facility.id,
      p_header: h,
      p_lines: lines.map((l) => ({ sku: l.sku, bucket: l.bucket, qty: l.qty })),
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push("/sales");
  };

  return (
    <>
      <PageHeader title="Record sale" subtitle={`${facility.name} · scan each product handed to the patient`} back={{ href: "/sales", label: "Sales" }} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Items" className="lg:col-span-2">
          <StockLineEditor facilityId={facility.id} lines={lines} setLines={setLines} buckets={["sellable", "display"]} showPrice />
        </Card>
        <Card title="Customer">
          <div className="grid gap-4">
            <Field label="Patient / customer name">
              <Input value={h.customer_name} onChange={(e) => setH({ ...h, customer_name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={h.customer_phone} onChange={(e) => setH({ ...h, customer_phone: e.target.value })} />
            </Field>
            <Field label="Clinic bill / receipt no.">
              <Input value={h.bill_ref} onChange={(e) => setH({ ...h, bill_ref: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between border-t border-n300 pt-4">
              <span className="text-sm text-n800">Total at MSP</span>
              <span className="text-xl font-semibold tabular">{inr(total)}</span>
            </div>
            {err && <Alert>{err}</Alert>}
            <Button onClick={submit} disabled={busy || !lines.length}>
              {busy ? "Saving…" : "Save sale"}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
