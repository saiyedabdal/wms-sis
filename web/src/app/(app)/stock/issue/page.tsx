"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { StockLineEditor, type OutLine } from "@/components/StockLineEditor";
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ISSUE_PURPOSES, type IssuePurpose } from "@/lib/types";
import { dateTime, errMsg } from "@/lib/format";

interface Past {
  id: number;
  issue_no: string;
  purpose: IssuePurpose;
  issued_to: string | null;
  created_at: string;
  stock_issue_lines: { sku: string; qty: number }[];
}

export default function IssuePage() {
  const { facility } = useApp();
  const [lines, setLines] = useState<OutLine[]>([]);
  const [purpose, setPurpose] = useState<IssuePurpose>("training");
  const [issuedTo, setIssuedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [past, setPast] = useState<Past[]>([]);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  const load = useCallback(async () => {
    if (!facility) return;
    const { data } = await supabaseBrowser()
      .from("stock_issues")
      .select("id,issue_no,purpose,issued_to,created_at,stock_issue_lines(sku,qty)")
      .eq("facility_id", facility.id)
      .order("created_at", { ascending: false })
      .limit(30);
    setPast((data ?? []) as Past[]);
  }, [facility]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!facility) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().rpc("create_stock_issue", {
      p_facility_id: facility.id,
      p_purpose: purpose,
      p_issued_to: (issuedTo || null) as string,
      p_notes: (notes || null) as string,
      p_lines: lines.map((l) => ({ sku: l.sku, bucket: l.bucket, qty: l.qty })),
    });
    setBusy(false);
    if (error) return setMsg({ tone: "red", text: errMsg(error) });
    setMsg({ tone: "green", text: "Issued" });
    setLines(() => []);
    setIssuedTo("");
    setNotes("");
    setKey((k) => k + 1);
    load();
  };

  if (!facility) return null;
  return (
    <>
      <PageHeader title="Issue stock" subtitle="Take stock out for trainings, demos and samples (STF), or write off lost / scrapped units." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Items" className="lg:col-span-2">
          <StockLineEditor key={key} facilityId={facility.id} lines={lines} setLines={setLines} buckets={["sellable", "display", "in_use", "damaged"]} />
        </Card>
        <Card title="Issue details">
          <div className="grid gap-4">
            <Field label="Purpose">
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value as IssuePurpose)}>
                {ISSUE_PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issued to">
              <Input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Trainer / doctor / event" />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button onClick={submit} disabled={busy || !lines.length}>
              {busy ? "Saving…" : "Issue stock"}
            </Button>
          </div>
        </Card>
      </div>
      <Card title="Recent issues" pad={false} className="mt-6">
        {past.length === 0 ? (
          <Empty title="Nothing issued yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Issue</Th>
                <Th>Purpose</Th>
                <Th>To</Th>
                <Th>Items</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {past.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.issue_no}</Td>
                  <Td>{ISSUE_PURPOSES.find((x) => x.value === p.purpose)?.label}</Td>
                  <Td>{p.issued_to ?? "—"}</Td>
                  <Td className="text-xs">{p.stock_issue_lines.map((l) => `${l.sku} × ${l.qty}`).join(", ")}</Td>
                  <Td>{dateTime(p.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
