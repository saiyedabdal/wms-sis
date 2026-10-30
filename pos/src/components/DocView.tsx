import { amountInWords, inr, modeLabel, STATE_NAMES } from "@/lib/format";
import type { PublicDoc } from "@/lib/types";

const dt = (v: string) => new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const n2 = (v: number | undefined | null) => Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** GST summary by rate, as required on a tax invoice. */
function byRate(d: PublicDoc) {
  const m = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of d.lines) {
    const r = m.get(l.gst_pct) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += l.taxable; r.cgst += l.cgst; r.sgst += l.sgst; r.igst += l.igst;
    m.set(l.gst_pct, r);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export function DocView({ doc, format }: { doc: PublicDoc; format: "80mm" | "a4" }) {
  const s = doc.supplier;
  const isInv = doc.type === "invoice";
  const title = isInv ? "Tax Invoice" : "Credit Note";
  const pos = `${STATE_NAMES[doc.place_of_supply] ?? s.state_name} (${doc.place_of_supply})`;
  const supplierLine = s.kind === "frido" ? `Sold at ${s.facility_name} (${s.facility_code}), ${s.facility_address}` : null;

  if (format === "80mm") {
    return (
      <div className="doc-80 mx-auto bg-white p-[4mm] text-black">
        <div className="text-center">
          <div className="text-[15px] font-bold lowercase">frido<span>.</span></div>
          <div className="font-semibold">{s.legal_name}</div>
          <div>{s.address}</div>
          {s.gstin && <div>GSTIN: {s.gstin}</div>}
          <div>State: {s.state_name} ({s.state_code})</div>
          {supplierLine && <div className="mt-1">{supplierLine}</div>}
        </div>
        <div className="my-2 border-y border-dashed border-black py-1 text-center text-[13px] font-bold uppercase">{title}</div>
        <div className="flex justify-between"><span>No: <b>{doc.number}</b></span></div>
        <div>Date: {dt(doc.date)}</div>
        {!isInv && <div>Against invoice {doc.against} dated {doc.against_date ? dt(doc.against_date) : ""}</div>}
        {(doc.customer.name || doc.customer.phone) && <div>Customer: {[doc.customer.name, doc.customer.phone].filter(Boolean).join(" · ")}</div>}
        {doc.customer.gstin && <div>Buyer GSTIN: {doc.customer.gstin}{doc.customer.company ? ` · ${doc.customer.company}` : ""}</div>}
        <div>Place of supply: {pos}</div>
        <table className="mt-2 w-full border-t border-dashed border-black">
          <thead><tr className="text-left"><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="py-0.5 pr-1">
                  <div className="font-semibold">{l.name}{l.size ? ` (${l.size})` : ""}</div>
                  <div className="text-[10px]">{l.sku} · HSN {l.hsn} · GST {l.gst_pct}%{l.unit_price ? ` · @${n2(l.unit_price)}` : ""}{l.mrp ? ` · MRP ${n2(l.mrp)}` : ""}</div>
                  {l.discount ? <div className="text-[10px]">Discount −{n2(l.discount)}</div> : null}
                </td>
                <td className="text-right">{l.qty}</td>
                <td className="text-right">{n2(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 border-t border-dashed border-black pt-1">
          {isInv && doc.discount_total ? <div className="flex justify-between"><span>Discount</span><span>−{n2(doc.discount_total)}</span></div> : null}
          <div className="flex justify-between"><span>Taxable value</span><span>{n2(doc.taxable_total)}</span></div>
          {doc.intra_state ? (
            <><div className="flex justify-between"><span>CGST</span><span>{n2(doc.cgst_total)}</span></div>
              <div className="flex justify-between"><span>SGST</span><span>{n2(doc.sgst_total)}</span></div></>
          ) : <div className="flex justify-between"><span>IGST</span><span>{n2(doc.igst_total)}</span></div>}
          {doc.round_off ? <div className="flex justify-between"><span>Round off</span><span>{n2(doc.round_off)}</span></div> : null}
          <div className="flex justify-between text-[14px] font-bold"><span>{isInv ? "Total" : "Credit total"}</span><span>₹{n2(doc.grand_total)}</span></div>
          <div className="text-[10px]">{amountInWords(doc.grand_total)}</div>
        </div>
        <table className="mt-1 w-full border-t border-dashed border-black text-[10px]">
          <thead><tr><th className="text-left">GST%</th><th className="text-right">Taxable</th><th className="text-right">{doc.intra_state ? "CGST" : "IGST"}</th>{doc.intra_state && <th className="text-right">SGST</th>}</tr></thead>
          <tbody>{byRate(doc).map(([r, v]) => (
            <tr key={r}><td>{r}%</td><td className="text-right">{n2(v.taxable)}</td><td className="text-right">{n2(doc.intra_state ? v.cgst : v.igst)}</td>{doc.intra_state && <td className="text-right">{n2(v.sgst)}</td>}</tr>
          ))}</tbody>
        </table>
        {doc.payments?.length ? <div className="mt-1 border-t border-dashed border-black pt-1">Paid: {doc.payments.map((p) => `${modeLabel[p.mode]} ${n2(p.amount)}`).join(", ")}</div> : null}
        {!isInv && <div className="mt-1">Reason: {doc.reason} · {doc.settlement === "exchange" ? "for exchange" : "refunded online"}</div>}
        {doc.seller && <div>Served by: {doc.seller}</div>}
        {s.footer && <div className="mt-2 text-center text-[10px]">{s.footer}</div>}
        <div className="mt-2 text-center text-[10px]">Reverse charge: No · Computer generated</div>
      </div>
    );
  }

  return (
    <div className="doc-a4 mx-auto bg-white p-[10mm] text-black">
      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <div className="text-[24px] font-bold lowercase leading-none">frido<span className="text-[#ffd100]">.</span></div>
          <div className="mt-2 text-[14px] font-semibold">{s.legal_name}</div>
          <div className="max-w-[90mm]">{s.address}</div>
          {s.gstin && <div>GSTIN: <b>{s.gstin}</b>{s.pan ? ` · PAN: ${s.pan}` : ""}</div>}
          {s.cin && <div>CIN: {s.cin}</div>}
          <div>State: {s.state_name}, code {s.state_code}</div>
          {supplierLine && <div className="mt-1 italic">{supplierLine}</div>}
        </div>
        <div className="text-right">
          <div className="text-[20px] font-bold uppercase tracking-wide">{title}</div>
          <div className="mt-1">No: <b>{doc.number}</b></div>
          <div>Date: {dt(doc.date)}</div>
          {!isInv && <div>Against: {doc.against}</div>}
          <div>Place of supply: {pos}</div>
          <div>Reverse charge: No</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase">Bill to</div>
          <div className="font-semibold">{doc.customer.company || doc.customer.name || "Walk-in customer"}</div>
          {doc.customer.company && doc.customer.name && <div>{doc.customer.name}</div>}
          {doc.customer.phone && <div>Phone: {doc.customer.phone}</div>}
          {doc.customer.gstin && <div>GSTIN: {doc.customer.gstin}</div>}
        </div>
        {!isInv && <div><div className="text-[10px] font-semibold uppercase">Reason</div><div>{doc.reason}</div><div>{doc.settlement === "exchange" ? "Settled by exchange" : "Refund paid online"}</div></div>}
      </div>
      <table className="mt-4 w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="border-y border-black bg-[#f0f0f0] text-left">
            <th className="p-1">#</th><th className="p-1">Item</th><th className="p-1">HSN</th><th className="p-1 text-right">Qty</th>
            {isInv && <th className="p-1 text-right">Rate</th>}{isInv && <th className="p-1 text-right">Disc.</th>}
            <th className="p-1 text-right">Taxable</th><th className="p-1 text-right">GST</th>
            {doc.intra_state ? <><th className="p-1 text-right">CGST</th><th className="p-1 text-right">SGST</th></> : <th className="p-1 text-right">IGST</th>}
            <th className="p-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="border-b border-[#dddddd] align-top">
              <td className="p-1">{i + 1}</td>
              <td className="p-1"><div className="font-semibold">{l.name}</div><div className="text-[9.5px]">{[l.sku, l.size && `Size ${l.size}`, l.color, l.mrp && `MRP ₹${n2(l.mrp)}`].filter(Boolean).join(" · ")}</div></td>
              <td className="p-1">{l.hsn}</td><td className="p-1 text-right">{l.qty}</td>
              {isInv && <td className="p-1 text-right">{n2(l.unit_price)}</td>}{isInv && <td className="p-1 text-right">{l.discount ? n2(l.discount) : "—"}</td>}
              <td className="p-1 text-right">{n2(l.taxable)}</td><td className="p-1 text-right">{l.gst_pct}%</td>
              {doc.intra_state ? <><td className="p-1 text-right">{n2(l.cgst)}</td><td className="p-1 text-right">{n2(l.sgst)}</td></> : <td className="p-1 text-right">{n2(l.igst)}</td>}
              <td className="p-1 text-right font-semibold">{n2(l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex justify-between gap-6">
        <table className="self-start text-[10px]">
          <thead><tr className="border-b border-black"><th className="pr-4 text-left">GST rate</th><th className="pr-4 text-right">Taxable</th>{doc.intra_state ? <><th className="pr-4 text-right">CGST</th><th className="text-right">SGST</th></> : <th className="text-right">IGST</th>}</tr></thead>
          <tbody>{byRate(doc).map(([r, v]) => (
            <tr key={r}><td>{r}%</td><td className="pr-4 text-right">{n2(v.taxable)}</td>{doc.intra_state ? <><td className="pr-4 text-right">{n2(v.cgst)}</td><td className="text-right">{n2(v.sgst)}</td></> : <td className="text-right">{n2(v.igst)}</td>}</tr>
          ))}</tbody>
        </table>
        <div className="min-w-[70mm]">
          {isInv && <div className="flex justify-between"><span>Items at MSP</span><span>{n2(doc.gross_total)}</span></div>}
          {isInv && doc.discount_total ? <div className="flex justify-between"><span>Discount</span><span>−{n2(doc.discount_total)}</span></div> : null}
          <div className="flex justify-between"><span>Taxable value</span><span>{n2(doc.taxable_total)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>{n2(doc.cgst_total + doc.sgst_total + doc.igst_total)}</span></div>
          {doc.round_off ? <div className="flex justify-between"><span>Round off</span><span>{n2(doc.round_off)}</span></div> : null}
          <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold"><span>{isInv ? "Total" : "Credit total"}</span><span>{inr(doc.grand_total)}</span></div>
        </div>
      </div>
      <div className="mt-2"><b>Amount in words:</b> {amountInWords(doc.grand_total)}</div>
      {doc.payments?.length ? <div className="mt-1"><b>Payment:</b> {doc.payments.map((p) => `${modeLabel[p.mode]} ₹${n2(p.amount)}`).join(", ")}</div> : null}
      <div className="mt-8 flex items-end justify-between">
        <div className="max-w-[110mm] text-[10px]">{s.footer}{doc.seller ? <div className="mt-1">Served by {doc.seller}</div> : null}</div>
        <div className="text-center"><div className="h-10" /><div className="border-t border-black px-6 pt-1 text-[10px]">For {s.legal_name}<br />Authorised signatory</div></div>
      </div>
    </div>
  );
}
