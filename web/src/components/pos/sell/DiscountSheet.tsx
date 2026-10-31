"use client";

import { useEffect, useState } from "react";
import { inr, pct } from "@/lib/pos/format";
import { Alert, Button, Chip, Field, Input, Modal, Segmented } from "../ui";

/** Line or bill discount, as % or ₹. Shows the effect against the person's limit before they commit. */
export function DiscountSheet({ open, title, base, current, allowance, managerMax, onClose, onApply }: {
  open: boolean;
  title: string;
  base: number;
  current: { kind: "pct" | "amount"; value: number } | null;
  allowance: number;
  managerMax: number;
  onClose: () => void;
  onApply: (d: { kind: "pct" | "amount"; value: number } | null) => void;
}) {
  const [kind, setKind] = useState<"pct" | "amount">("pct");
  const [value, setValue] = useState("");
  useEffect(() => { if (open) { setKind(current?.kind ?? "pct"); setValue(current ? String(current.value) : ""); } }, [open, current]);

  const v = Number(value) || 0;
  const amount = kind === "pct" ? (base * Math.min(v, 100)) / 100 : Math.min(v, base);
  const effPct = base > 0 ? (amount * 100) / base : 0;

  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<div className="flex gap-2">
        {current && <Button variant="ghost" onClick={() => onApply(null)}>Remove discount</Button>}
        <Button className="ml-auto" size="lg" disabled={v <= 0} onClick={() => onApply({ kind, value: v })}>Apply</Button>
      </div>}>
      <div className="flex flex-col gap-4">
        <Segmented value={kind} onChange={(k) => { setKind(k); setValue(""); }} options={[{ value: "pct", label: "Percent %" }, { value: "amount", label: "Amount ₹" }]} />
        <Field label={kind === "pct" ? "Discount %" : "Discount ₹"} hint={`On ${inr(base)}`}>
          <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="h-14 text-2xl font-semibold" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(kind === "pct" ? [2, 5, 10] : [50, 100, 200, 500]).map((q) => (
            <Chip key={q} active={v === q} onClick={() => setValue(String(q))}>{kind === "pct" ? `${q}%` : `₹${q}`}</Chip>
          ))}
        </div>
        {v > 0 && (
          <Alert tone={effPct <= allowance ? "green" : effPct <= managerMax ? "yellow" : "red"}>
            − {inr(amount)} ({pct(effPct.toFixed(2))}).{" "}
            {effPct <= allowance ? "Within your limit." : effPct <= managerMax
              ? `Above your ${pct(allowance)} limit: a manager approves with their PIN at checkout.`
              : `Above the ${pct(managerMax)} manager limit: only a Frido admin can approve this.`}
          </Alert>
        )}
        <p className="text-xs text-n800">One discount source per bill. A bill discount is spread across the lines so GST is right on each.</p>
      </div>
    </Modal>
  );
}
