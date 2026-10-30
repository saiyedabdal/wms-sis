"use client";

import { useEffect, useMemo, useState } from "react";
import { RiBankCardLine, RiBankLine, RiCloseLine, RiExchangeLine, RiMoneyRupeeCircleLine, RiQrCodeLine, RiQrScan2Line } from "@remixicon/react";
import { inr, inr0, modeLabel, round2 } from "@/lib/format";
import type { PayMode, PosContext } from "@/lib/types";
import { Alert, Button, Field, Input, Modal, cx } from "../ui";

export interface PaymentDraft {
  mode: PayMode;
  amount: number;
  reference?: string;
  tendered?: number;
  credit_note_id?: number;
}

const ICON: Record<PayMode, typeof RiMoneyRupeeCircleLine> = {
  cash: RiMoneyRupeeCircleLine, upi_static: RiQrCodeLine, upi_razorpay: RiQrScan2Line, card_edc: RiBankCardLine,
  bank_transfer: RiBankLine, credit_note: RiExchangeLine,
};

function UpiQr({ vpa, payee, amount, note }: { vpa: string; payee: string; amount: number; note: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
    import("qrcode").then((q) => q.toDataURL(url, { margin: 1, width: 220 })).then(setSrc).catch(() => setSrc(null));
  }, [vpa, payee, amount, note]);
  return (
    <div className="flex items-center gap-4 rounded-md border border-n300 bg-n50 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={`UPI QR for ${inr(amount)}`} className="h-36 w-36 rounded-sm bg-white" /> : <div className="h-36 w-36 animate-pulse rounded-sm bg-n200" />}
      <div className="text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-n800">Scan with any UPI app</div>
        <div className="tabular mt-1 text-2xl font-semibold">{inr(amount)}</div>
        <div className="mt-1 text-n800">to {payee}<br />{vpa}</div>
      </div>
    </div>
  );
}

/** Split payments across the clinic's enabled modes until the bill is covered (Decision 4). */
export function PaymentSheet({ open, total, ctx, creditNote, busy, error, onClose, onComplete }: {
  open: boolean;
  total: number;
  ctx: PosContext;
  creditNote: { id: number; credit_no: string; balance: number } | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onComplete: (p: PaymentDraft[]) => void;
}) {
  const modes = useMemo(() => (ctx.settings?.payment_modes ?? []).filter((m) => m !== "upi_razorpay" || ctx.entity?.razorpay_enabled)
    .filter((m) => m !== "upi_static" || ctx.entity?.upi_vpa), [ctx]);
  const [list, setList] = useState<PaymentDraft[]>([]);
  const [mode, setMode] = useState<PayMode>("cash");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [tendered, setTendered] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const cn = creditNote ? [{ mode: "credit_note" as const, amount: round2(Math.min(creditNote.balance, total)), credit_note_id: creditNote.id, reference: creditNote.credit_no }] : [];
    setList(cn);
    setMode(modes[0] ?? "cash");
    setAmount(String(round2(total - cn.reduce((s, p) => s + p.amount, 0))));
    setRef(""); setTendered(""); setLocalErr(null);
  }, [open, total, creditNote, modes]);

  const paid = round2(list.reduce((s, p) => s + p.amount, 0));
  const remaining = round2(total - paid);
  const amt = round2(Number(amount) || 0);
  const tend = Number(tendered) || 0;

  const draft = (): PaymentDraft | string => {
    if (amt <= 0) return "Enter an amount";
    if (amt > remaining) return `Only ${inr(remaining)} is left to pay`;
    if (mode === "cash" && tendered && tend < amt) return "Cash handed over is less than the amount";
    if ((mode === "upi_static" || mode === "card_edc") && ref.trim().length < 4)
      return mode === "upi_static" ? "Enter the UTR from the customer's UPI app" : "Enter the approval code or RRN from the card slip";
    return { mode, amount: amt, reference: ref.trim() || undefined, tendered: mode === "cash" && tendered ? tend : undefined };
  };
  const addCurrent = () => {
    const d = draft();
    if (typeof d === "string") { setLocalErr(d); return null; }
    const next = [...list, d];
    setList(next);
    setAmount(String(round2(total - next.reduce((s, p) => s + p.amount, 0))));
    setRef(""); setTendered(""); setLocalErr(null);
    return next;
  };
  const complete = () => {
    if (remaining <= 0) return onComplete(list);
    const next = addCurrent();
    if (!next) return;
    if (round2(next.reduce((s, p) => s + p.amount, 0)) === total) onComplete(next);
  };
  const change = mode === "cash" && tend > amt ? tend - amt : 0;
  const cashSteps = [amt, Math.ceil(amt / 100) * 100, Math.ceil(amt / 500) * 500, Math.ceil(amt / 2000) * 2000].filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  return (
    <Modal open={open} onClose={onClose} title="Take payment" wide dismissable={!busy}>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-4">
          {remaining > 0 && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {modes.map((m) => {
                  const I = ICON[m];
                  return (
                    <button key={m} type="button" onClick={() => { setMode(m); setRef(""); setLocalErr(null); }}
                      className={cx("flex h-20 flex-col items-center justify-center gap-1 rounded-md border text-sm font-semibold transition",
                        mode === m ? "border-ink bg-y50 ring-2 ring-yellow" : "border-n500 bg-white hover:border-ink")}>
                      <I className="h-6 w-6" />{modeLabel[m]}
                    </button>
                  );
                })}
              </div>
              <Field label="Amount">
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="h-14 text-2xl font-semibold" />
              </Field>
              {mode === "cash" && (
                <>
                  <Field label="Cash handed over (optional)" hint={change > 0 ? undefined : "Tap a note to work out the change."}>
                    <Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {cashSteps.map((v, i) => <Button key={v} variant="secondary" size="sm" onClick={() => setTendered(String(v))}>{i === 0 ? "Exact" : inr0(v)}</Button>)}
                  </div>
                  {change > 0 && <Alert tone="green"><span className="text-base font-semibold">Give change: {inr(change)}</span></Alert>}
                </>
              )}
              {mode === "upi_static" && ctx.entity?.upi_vpa && (
                <>
                  <UpiQr vpa={ctx.entity.upi_vpa} payee={ctx.entity.upi_payee_name ?? ctx.entity.legal_name} amount={amt || 0} note={`Frido ${ctx.facility?.code ?? ""}`} />
                  <Field label="UTR / UPI reference" hint="Check the money has arrived, then type the 12-digit UTR shown in the customer's UPI app.">
                    <Input inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 431298765432" />
                  </Field>
                </>
              )}
              {mode === "card_edc" && (
                <Field label="Approval code or RRN" hint="Charge the amount on the card machine first, then copy the code from the slip.">
                  <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 004512 or 431298765432" />
                </Field>
              )}
              {mode === "bank_transfer" && <Alert tone="yellow">The sale is saved as unpaid and the stock is held. It gets its invoice number when you enter the UTR after the money arrives.</Alert>}
              {mode === "upi_razorpay" && <Alert tone="blue">After you complete, a Razorpay QR for this amount appears. The sale finishes by itself when the customer pays.</Alert>}
              {(localErr || error) && <Alert>{localErr ?? error}</Alert>}
            </>
          )}
          {remaining <= 0 && error && <Alert>{error}</Alert>}
        </div>

        <div className="flex flex-col rounded-md bg-n100 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-n800">Bill total</div>
          <div className="tabular text-3xl font-semibold tracking-tight">{inr(total)}</div>
          <ul className="mt-3 flex-1 space-y-2">
            {list.map((p, i) => {
              const I = ICON[p.mode];
              return (
                <li key={i} className="flex items-center gap-2 rounded-sm bg-white px-3 py-2 text-sm">
                  <I className="h-4 w-4 text-n800" />
                  <span className="flex-1">{modeLabel[p.mode]}{p.reference ? <span className="block text-xs text-n800">{p.reference}</span> : null}</span>
                  <span className="tabular font-semibold">{inr(p.amount)}</span>
                  {p.mode !== "credit_note" && (
                    <button type="button" aria-label="Remove payment" onClick={() => { const n = list.filter((_, j) => j !== i); setList(n); setAmount(String(round2(total - n.reduce((s, x) => s + x.amount, 0)))); }}
                      className="text-n700 hover:text-red-a"><RiCloseLine className="h-4 w-4" /></button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-n300 pt-3">
            <span className="text-sm text-n800">{remaining > 0 ? "Left to pay" : "Covered"}</span>
            <span className={cx("tabular text-xl font-semibold", remaining > 0 ? "text-ink" : "text-green-a")}>{inr(Math.max(remaining, 0))}</span>
          </div>
          {remaining > 0 && list.length >= 0 && amt > 0 && amt < remaining && (
            <Button variant="secondary" className="mt-3" onClick={addCurrent}>Add · split payment</Button>
          )}
          <Button size="xl" className="mt-3" disabled={busy} onClick={complete}>{busy ? "Saving…" : "Complete sale"}</Button>
        </div>
      </div>
    </Modal>
  );
}
