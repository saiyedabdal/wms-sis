"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RiMagicLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { Alert, Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CATEGORIES, facilityTypeLabel } from "@/lib/types";
import { dateTime, errMsg } from "@/lib/format";

interface Suggestion {
  sku: string;
  item_name: string;
  category_name: string | null;
  on_hand: number;
  in_transit: number;
  pending: number;
  sold_30d: number;
  velocity: number;
  lead_time_days: number;
  season_factor: number;
  min_qty: number;
  max_qty: number;
  target: number;
  suggested_qty: number;
}

interface Run {
  id: number;
  run_at: string;
  trigger: string;
  facilities_planned: number;
  drafts_created: number;
  lines_suggested: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Step 5: weekly drafts from sales velocity, lead time and seasonality; ops review them in Approvals. */
export default function DemandPage() {
  const { facilities, facility: current } = useApp();
  const planned = facilities.filter((f) => f.type !== "warehouse" && f.is_active);
  // preview the facility picked in the header, else the first one that is planned
  const [facId, setFacId] = useState<number | null>(current?.id ?? planned.find((f) => f.planning_enabled)?.id ?? planned[0]?.id ?? null);
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [factors, setFactors] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const fac = facilities.find((f) => f.id === facId);
  const sb = supabaseBrowser();

  const loadRuns = useCallback(async () => {
    const { data } = await sb.from("demand_runs").select("*").order("run_at", { ascending: false }).limit(8);
    setRuns((data ?? []) as Run[]);
  }, [sb]);

  useEffect(() => {
    loadRuns();
    sb.from("season_factors")
      .select("category_name,month,factor")
      .then(({ data }) => setFactors(Object.fromEntries((data ?? []).map((f) => [`${f.category_name}|${f.month}`, Number(f.factor)]))));
  }, [sb, loadRuns]);

  useEffect(() => {
    if (!facId) return;
    sb.rpc("demand_suggestions", { p_facility_id: facId }).then(({ data, error }) => {
      if (error) setMsg({ tone: "red", text: errMsg(error) });
      setRows((data ?? []) as Suggestion[]);
    });
  }, [facId, sb]);

  const run = async (facilityId: number | null) => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await sb.rpc("run_demand_planning", { p_facility_id: facilityId as number });
    setBusy(false);
    if (error) return setMsg({ tone: "red", text: errMsg(error) });
    const { data: r } = await sb.from("demand_runs").select("*").eq("id", data).single();
    setMsg({
      tone: "green",
      text: (
        <>
          Planned {r?.facilities_planned} facilit{r?.facilities_planned === 1 ? "y" : "ies"}: {r?.drafts_created} draft request{r?.drafts_created === 1 ? "" : "s"} with{" "}
          {r?.lines_suggested} lines.{" "}
          <Link href="/approvals" className="font-semibold underline">
            Review in Approvals
          </Link>
        </>
      ),
    });
    loadRuns();
  };

  const saveFactor = async (category: string, month: number, value: string) => {
    const factor = Number(value) || 1;
    const k = `${category}|${month}`;
    if ((factors[k] ?? 1) === factor) return;
    setFactors((f) => ({ ...f, [k]: factor }));
    const { error } = await sb.from("season_factors").upsert({ category_name: category, month, factor });
    if (error) setMsg({ tone: "red", text: errMsg(error) });
  };

  const thisMonth = new Date().getMonth() + 1;

  return (
    <>
      <PageHeader
        title="Demand planning"
        subtitle="Runs every Monday 6 AM: one draft request per facility that needs stock. Retailers can also raise requests any time, pre-filled from the same plan."
        actions={
          <Button onClick={() => run(null)} disabled={busy}>
            <RiMagicLine size={16} /> {busy ? "Planning…" : "Run for all facilities now"}
          </Button>
        }
      />
      {msg && (
        <div className="mb-4">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="How quantities are worked out" className="lg:col-span-2">
          <div className="text-sm leading-relaxed text-n900">
            <p>
              <span className="font-semibold">Target</span> = units sold per day (last 30 days) × (lead time + review period + safety days) × season factor, kept
              within the SKU&apos;s min / max.
            </p>
            <p className="mt-2">
              <span className="font-semibold">Suggested</span> = target − on hand − on the way (in transit, approved but not dispatched, awaiting approval).
            </p>
            <p className="mt-2 text-n800">
              Lead time is the measured approval → receipt time for that facility (default from its settings until shipments exist). A super stockist plans for
              the combined sales of the retailers it supplies. New SKUs without sales fall back to min / max.
            </p>
          </div>
        </Card>
        <Card title="Recent runs" pad={false}>
          {runs.length === 0 ? (
            <Empty title="No runs yet" />
          ) : (
            <Table>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {dateTime(r.run_at)}
                      <div className="text-xs capitalize text-n800">{r.trigger}</div>
                    </Td>
                    <Td right>
                      {r.drafts_created} drafts
                      <div className="text-xs text-n800">{r.lines_suggested} lines</div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card
        className="mt-6"
        pad={false}
        title="Plan preview"
        actions={
          <>
            <Select value={facId ?? ""} onChange={(e) => setFacId(Number(e.target.value))} className="h-9 w-64">
              {planned.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {facilityTypeLabel(f.type)}
                  {f.planning_enabled ? "" : " (planning off)"}
                </option>
              ))}
            </Select>
            {fac && (
              <Button size="sm" variant="secondary" onClick={() => run(fac.id)} disabled={busy}>
                Draft for {fac.code}
              </Button>
            )}
          </>
        }
      >
        {rows.length === 0 ? (
          <Empty title="No SKUs to plan">Add SKUs to this facility&apos;s assortment (and min / max) under Facilities.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th right>Sold 30d</Th>
                <Th right>Per day</Th>
                <Th right>Lead</Th>
                <Th right>Season</Th>
                <Th right>Min / max</Th>
                <Th right>Target</Th>
                <Th right>On hand</Th>
                <Th right>On the way</Th>
                <Th right>Suggested</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <Td>
                    <div className="font-medium">{r.item_name}</div>
                    <div className="text-xs text-n800">
                      {r.sku} · {r.category_name ?? "—"}
                    </div>
                  </Td>
                  <Td right>{r.sold_30d}</Td>
                  <Td right>{Number(r.velocity).toFixed(2)}</Td>
                  <Td right>{Number(r.lead_time_days)}d</Td>
                  <Td right>×{Number(r.season_factor)}</Td>
                  <Td right>
                    {r.min_qty} / {r.max_qty || "—"}
                  </Td>
                  <Td right>{Number(r.target)}</Td>
                  <Td right>{r.on_hand}</Td>
                  <Td right>{r.in_transit + r.pending}</Td>
                  <Td right className={r.suggested_qty ? "font-semibold" : "text-n700"}>
                    {r.suggested_qty}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        className="mt-6"
        pad={false}
        title="Season factors"
        actions={<span className="text-xs text-n800">1 = normal month. Set by hand until a year of sales history exists.</span>}
      >
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              {MONTHS.map((m, i) => (
                <Th key={m} right className={i + 1 === thisMonth ? "bg-y50" : ""}>
                  {m}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c}>
                <Td className="font-medium">{c}</Td>
                {MONTHS.map((m, i) => (
                  <Td key={m} right className={i + 1 === thisMonth ? "bg-y50" : ""}>
                    <Input
                      type="number"
                      step="0.1"
                      min={0.1}
                      defaultValue={factors[`${c}|${i + 1}`] ?? ""}
                      key={`${c}|${i}|${factors[`${c}|${i + 1}`] ?? ""}`}
                      placeholder="1"
                      className="ml-auto h-8 w-14 px-1 text-right text-xs"
                      onBlur={(e) => saveFactor(c, i + 1, e.target.value)}
                    />
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
