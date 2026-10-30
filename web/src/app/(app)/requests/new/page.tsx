"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { RequestLinesEditor, toPayload, type ReqLine } from "@/components/RequestLinesEditor";
import { Alert, Button, Card, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { paths } from "@/lib/paths";
import { facilityTypeLabel } from "@/lib/types";
import { errMsg } from "@/lib/format";

export default function NewRequestPage() {
  const router = useRouter();
  const { facilities, facility: current, isOps } = useApp();
  const targets = facilities.filter((f) => f.type !== "warehouse" && f.is_active);
  const [facilityId, setFacilityId] = useState<number | null>(current?.id ?? targets[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReqLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const facility = facilities.find((f) => f.id === facilityId);
  const ss = facilities.find((f) => f.id === facility?.fulfiller_ss_id);

  useEffect(() => setLines([]), [facilityId]);

  const submit = async () => {
    if (!facility) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabaseBrowser().rpc("create_order_request", {
      p_facility_id: facility.id,
      p_warehouse_id: null as unknown as number,
      p_notes: (notes || null) as string,
      p_lines: toPayload(lines),
      // a super admin in the retailer / SS view submits like the facility would
      p_submit: !isOps,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    router.push(paths.request(data));
  };

  if (!facility) return null;
  return (
    <>
      <PageHeader
        title="Request stock"
        subtitle={
          isOps
            ? "Creates a draft. Review it, then send it to the manager for approval."
            : "Pre-filled from the demand plan. Adjust and submit; Frido reviews and approves it."
        }
        back={{ href: "/requests", label: "Tracking" }}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {isOps && (
            <Card title="Request for">
              <Field label="Facility">
                <Select value={facilityId ?? ""} onChange={(e) => setFacilityId(Number(e.target.value))}>
                  {targets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} · {f.code} · {facilityTypeLabel(f.type)}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
          )}
          <Card title="SKUs" pad={false}>
            <RequestLinesEditor key={facility.id} facility={facility} lines={lines} setLines={setLines} autoFill={!isOps} />
          </Card>
        </div>
        <Card title="Submit">
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-n800">
              Fulfilled by{" "}
              <span className="font-medium text-ink">
                {facility.type === "super_stockist" ? "Frido WH" : ss ? `${ss.name} (as far as its stock goes), rest from Frido WH` : "Frido WH"}
              </span>
              .
            </p>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. needed before Saturday camp" />
            </Field>
            {err && <Alert>{err}</Alert>}
            <Button onClick={submit} disabled={busy || !lines.some((l) => l.qty > 0)}>
              {busy ? "Saving…" : isOps ? "Create draft" : "Submit to Frido"}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
