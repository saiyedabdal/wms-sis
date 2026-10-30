"use client";

import { useEffect, useState } from "react";
import { RiCheckboxCircleFill, RiFileCopyLine, RiMessage2Line, RiPrinterLine, RiTimeLine, RiWhatsappLine } from "@remixicon/react";
import { sb } from "@/lib/supabase";
import { inr, modeLabel } from "@/lib/format";
import type { InvoiceSummary } from "@/lib/types";
import { Alert, Badge, Button, Field, Input, Modal } from "../ui";

export const docUrl = (token: string, format?: "80mm" | "a4") =>
  `${location.origin}/doc/?t=${token}${format ? `&format=${format}` : ""}`;

export function shareLinks(token: string, phone: string | null | undefined, what: string, clinic: string) {
  const url = docUrl(token);
  const text = `Thank you for choosing Frido at ${clinic}. Your ${what}: ${url}`;
  return {
    url,
    whatsapp: `https://wa.me/${phone ? `91${phone}` : ""}?text=${encodeURIComponent(text)}`,
    sms: `sms:${phone ? `+91${phone}` : ""}?&body=${encodeURIComponent(text)}`,
  };
}

export function ShareButtons({ token, phone, what, clinic, printer }: { token: string; phone?: string | null; what: string; clinic: string; printer?: string }) {
  const [copied, setCopied] = useState(false);
  const s = shareLinks(token, phone, what, clinic);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Button variant={printer === "a4" ? "secondary" : "primary"} onClick={() => window.open(`${docUrl(token, "80mm")}&print=1`, "_blank")}><RiPrinterLine /> 80 mm</Button>
      <Button variant={printer === "a4" ? "primary" : "secondary"} onClick={() => window.open(`${docUrl(token, "a4")}&print=1`, "_blank")}><RiPrinterLine /> A4</Button>
      <Button variant="secondary" onClick={() => window.open(s.whatsapp, "_blank")}><RiWhatsappLine /> WhatsApp</Button>
      <Button variant="secondary" onClick={() => { location.href = s.sms; }}><RiMessage2Line /> SMS</Button>
      <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-4" onClick={() => { navigator.clipboard?.writeText(s.url); setCopied(true); }}>
        <RiFileCopyLine className="h-4 w-4" /> {copied ? "Link copied" : "Copy invoice link"}
      </Button>
    </div>
  );
}

/** After checkout: paid -> print / share; unpaid (bank transfer, Razorpay) -> wait for the money without losing the sale. */
export function DoneSheet({ result, phone, clinic, printer, change, onNew, call, staffToken }: {
  result: InvoiceSummary | null;
  phone: string | null;
  clinic: string;
  printer?: string;
  change: number;
  onNew: () => void;
  call: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  staffToken: string;
}) {
  const [inv, setInv] = useState<InvoiceSummary | null>(result);
  const [utr, setUtr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrErr, setQrErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { setInv(result); setUtr(""); setErr(null); setQr(null); setQrErr(null); }, [result]);

  // a Razorpay payment finishes the invoice through the webhook; watch for it
  const pendingRzp = inv?.payments.find((p) => p.mode === "upi_razorpay" && p.status === "pending");
  useEffect(() => {
    if (!inv || inv.status !== "awaiting_payment" || !pendingRzp) return;
    const t = setInterval(async () => {
      const { data } = await sb().from("pos_invoices").select("status,invoice_no").eq("id", inv.id);
      const row = data?.[0] as { status: InvoiceSummary["status"]; invoice_no: string | null } | undefined;
      if (row && row.status !== "awaiting_payment") setInv({ ...inv, ...row });
    }, 4000);
    return () => clearInterval(t);
  }, [inv, pendingRzp]);

  if (!inv) return null;
  const pendingBank = inv.payments.find((p) => p.mode === "bank_transfer" && p.status === "pending");

  const confirm = async () => {
    if (!pendingBank) return;
    setBusy(true); setErr(null);
    try { setInv(await call<InvoiceSummary>("pos_confirm_payment", { p_payment_id: pendingBank.id, p_staff_token: staffToken, p_reference: utr })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const showQr = async () => {
    setQrErr(null);
    const { data, error } = await sb().functions.invoke("pos-razorpay-qr", { body: { payment_id: pendingRzp!.id } });
    if (error) setQrErr("Razorpay isn't connected for this clinic yet. Use static UPI or cash, or ask Frido to add the Razorpay keys.");
    else setQr((data as { image_url: string }).image_url);
  };

  return (
    <Modal open title={inv.status === "paid" ? "Sale complete" : inv.status === "needs_attention" ? "Needs attention" : "Waiting for payment"} onClose={onNew} wide>
      {inv.status === "paid" ? (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <RiCheckboxCircleFill className="h-16 w-16 text-green-b" />
          <div className="text-sm text-n800">Tax invoice</div>
          <div className="tabular text-2xl font-semibold tracking-tight">{inv.invoice_no}</div>
          <div className="tabular text-lg">{inr(inv.grand_total)} · {inv.payments.filter((p) => p.status === "confirmed").map((p) => modeLabel[p.mode]).join(" + ")}</div>
          {inv.is_new_customer && <Badge tone="yellow">New customer</Badge>}
          {inv.replay && <Alert tone="blue">This sale had already gone through; nothing was charged twice.</Alert>}
          {change > 0 && <Alert tone="green" className="mt-2"><span className="text-lg font-semibold">Give change: {inr(change)}</span></Alert>}
        </div>
      ) : inv.status === "needs_attention" ? (
        <Alert>The payment is recorded but the invoice could not be finished: {inv.attention_reason}. It is on the manager&apos;s Needs attention list; nothing is lost.</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3"><RiTimeLine className="h-8 w-8 text-y400" />
            <div><div className="text-lg font-semibold">{inr(inv.grand_total - inv.paid_total)} still to come</div>
              <div className="text-sm text-n800">The stock is held for this sale. It gets its invoice number as soon as the money arrives.</div></div>
          </div>
          {pendingBank && (
            <div className="flex items-end gap-2">
              <Field label="UTR of the bank transfer" className="flex-1"><Input value={utr} onChange={(e) => setUtr(e.target.value)} /></Field>
              <Button size="lg" disabled={busy || utr.trim().length < 4} onClick={confirm}>Money received</Button>
            </div>
          )}
          {pendingRzp && (qr
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr} alt="Razorpay UPI QR" className="mx-auto h-56 w-56" />
            : <Button variant="dark" size="lg" onClick={showQr}>Show Razorpay QR</Button>)}
          {qrErr && <Alert tone="yellow">{qrErr}</Alert>}
          {err && <Alert>{err}</Alert>}
          <p className="text-xs text-n800">You can start the next sale; this one stays under Invoices → Unpaid until it is paid or cancelled.</p>
        </div>
      )}
      {inv.status === "paid" && <div className="mt-5"><ShareButtons token={inv.share_token} phone={phone} what={`invoice ${inv.invoice_no}`} clinic={clinic} printer={printer} /></div>}
      <Button size="xl" variant="dark" className="mt-4 w-full" onClick={onNew}>New sale</Button>
    </Modal>
  );
}
