import type { Facility, RequestLineView } from "./types";
import { bucketLabel } from "./types";
import { date, inr } from "./format";

/** Supplier block on the PO. Set these in the environment once Finance confirms the details. */
export const COMPANY = {
  name: process.env.NEXT_PUBLIC_COMPANY_NAME || "Frido",
  gstin: process.env.NEXT_PUBLIC_COMPANY_GSTIN || "",
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "",
};

export interface RequestDoc {
  request_no: string;
  po_no: string;
  created_at: string;
  notes: string | null;
}

const pad = (s: string | number, n: number, right = false) => {
  const v = String(s);
  if (v.length > n) return v.slice(0, n - 1) + "…";
  return right ? v.padStart(n) : v.padEnd(n);
};

const facilityAddress = (f: Facility) =>
  [f.legal_name || f.name, f.address, [f.city, f.state, f.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n");

const facilityContact = (f: Facility) => [f.contact_name, f.contact_phone].filter(Boolean).join(" · ");

export function warehouseRequestEmail(req: RequestDoc, facility: Facility, lines: RequestLineView[]) {
  const totalQty = lines.reduce((s, l) => s + l.requested_qty, 0);
  const table = [
    `${pad("#", 4)}${pad("SKU", 22)}${pad("Product", 46)}${pad("Qty", 6, true)}  Purpose`,
    "-".repeat(96),
    ...lines.map(
      (l, i) => `${pad(i + 1, 4)}${pad(l.sku, 22)}${pad(l.item_name, 46)}${pad(l.requested_qty, 6, true)}  ${bucketLabel(l.bucket)}`,
    ),
    "-".repeat(96),
    `${pad("", 72)}${pad(totalQty, 6, true)}  units, ${lines.length} SKUs`,
  ].join("\n");

  return {
    subject: `Stock request ${req.request_no} – ${facility.name} (${facility.code})`,
    body: `Hi Team,

Please dispatch the following stock to ${facility.name} against request ${req.request_no} (PO ${req.po_no}).

${table}

Ship to:
${facilityAddress(facility)}${facilityContact(facility) ? `\nContact: ${facilityContact(facility)}` : ""}
${req.notes ? `\nNotes: ${req.notes}\n` : ""}
Please share the gate pass / invoice / DC number and carton count once dispatched.

Thanks,
STF Team, Frido`,
  };
}

export function poTotals(lines: RequestLineView[]) {
  return lines.reduce(
    (t, l) => ({
      qty: t.qty + l.requested_qty,
      msp: t.msp + l.msp * l.requested_qty,
      taxable: t.taxable + Number(l.line_taxable),
      gst: t.gst + Number(l.line_gst),
      total: t.total + Number(l.line_total),
    }),
    { qty: 0, msp: 0, taxable: 0, gst: 0, total: 0 },
  );
}

export function financePoEmail(req: RequestDoc, facility: Facility, lines: RequestLineView[]) {
  const t = poTotals(lines);
  const margins = [...new Set(lines.map((l) => Number(l.margin_pct)))].sort((a, b) => b - a).map((m) => `${m}%`).join(" / ");
  return {
    subject: `PO ${req.po_no} – ${facility.name} – ${inr(t.total)}`,
    body: `Hi Finance Team,

Please find attached PO ${req.po_no} raised against stock request ${req.request_no} dated ${date(req.created_at)}.

Partner: ${facility.legal_name || facility.name}${facility.gstin ? ` (GSTIN ${facility.gstin})` : ""}
Arrangement: ${facility.is_consignment ? "Consignment – billed as units are sold" : "Stock transfer"}
Pricing: MSP less partner margin (${margins || "0%"}), GST included

Units: ${t.qty} across ${lines.length} SKUs
Value at MSP: ${inr(t.msp)}
Taxable value: ${inr(t.taxable)}
GST: ${inr(t.gst)}
PO total: ${inr(t.total)}

Thanks,
STF Team, Frido`,
  };
}

export interface GrnLineDoc {
  sku: string;
  item_name: string;
  expected_qty: number;
  received_qty: number;
  damaged_qty: number;
  reason: string;
  notes: string | null;
  substitute_for?: string | null;
}

export function discrepancyEmail(
  g: { grn_no: string; shipment_no: string; request_no: string; uniware_ref: string | null; dn_no: string | null; invoice_no: string | null; dc_no: string | null; cartons_expected: number | null; cartons_received: number | null; received_at: string },
  facility: Facility,
  lines: GrnLineDoc[],
) {
  const issues = lines.filter((l) => l.reason !== "ok" || l.damaged_qty > 0 || l.received_qty + l.damaged_qty !== l.expected_qty);
  const table = [
    `${pad("SKU", 22)}${pad("Product", 40)}${pad("Sent", 6, true)}${pad("Good", 6, true)}${pad("Dmg", 5, true)}  Issue`,
    "-".repeat(96),
    ...issues.map((l) => {
      const diff = l.expected_qty - l.received_qty - l.damaged_qty;
      const what = [
        l.reason === "wrong_sku" ? "WRONG SKU / NOT DISPATCHED" : "",
        l.damaged_qty > 0 ? `DAMAGED ${l.damaged_qty}` : "",
        diff > 0 ? `SHORT ${diff}` : "",
        diff < 0 && l.reason !== "wrong_sku" ? `EXCESS ${-diff}` : "",
      ]
        .filter(Boolean)
        .join(" + ");
      return `${pad(l.sku, 22)}${pad(l.item_name, 40)}${pad(l.expected_qty, 6, true)}${pad(l.received_qty, 6, true)}${pad(l.damaged_qty, 5, true)}  ${what || l.reason.toUpperCase()}${l.notes ? ` – ${l.notes}` : ""}`;
    }),
  ].join("\n");
  const refs = [
    g.uniware_ref && `Uniware ref ${g.uniware_ref}`,
    g.invoice_no && `Invoice ${g.invoice_no}`,
    g.dc_no && `DC ${g.dc_no}`,
    g.dn_no && `DN ${g.dn_no}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const cartonLine =
    g.cartons_expected != null && g.cartons_received != null && g.cartons_expected !== g.cartons_received
      ? `\nCartons: ${g.cartons_expected} dispatched, ${g.cartons_received} received.\n`
      : "";
  return {
    subject: `Receipt discrepancy – ${facility.name} – ${g.grn_no} (${g.request_no})`,
    body: `Hi Team,

We received shipment ${g.shipment_no} for request ${g.request_no} at ${facility.name} on ${date(g.received_at)}${refs ? ` (${refs})` : ""}.
${cartonLine}
The following lines did not match the dispatch:

${table}

Photos of damaged / wrong items are saved on ${g.grn_no} in the WMS. Please advise on replacement or credit.

Thanks,
STF Team, Frido`,
    issueCount: issues.length,
  };
}

export async function downloadPoPdf(req: RequestDoc, facility: Facility, lines: RequestLineView[]) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const t = poTotals(lines);
  const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // header band (Frido yellow)
  doc.setFillColor(255, 209, 0);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(19, 19, 19);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("frido", 40, 42);
  doc.setFontSize(16);
  doc.text("PURCHASE ORDER", W - 40, 30, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${req.po_no}  ·  ${date(req.created_at)}  ·  Request ${req.request_no}`, W - 40, 48, { align: "right" });

  doc.setFontSize(8);
  doc.setTextColor(126, 126, 126);
  doc.text("SUPPLIER", 40, 92);
  doc.text("BUYER / SHIP TO", W / 2, 92);
  doc.setTextColor(19, 19, 19);
  doc.setFontSize(10);
  const supplier = [COMPANY.name, COMPANY.gstin && `GSTIN ${COMPANY.gstin}`, COMPANY.address].filter(Boolean).join("\n");
  const buyer = [facilityAddress(facility), facility.gstin && `GSTIN ${facility.gstin}`, facilityContact(facility)].filter(Boolean).join("\n");
  doc.text(supplier, 40, 108);
  doc.text(buyer, W / 2, 108);

  autoTable(doc, {
    startY: 180,
    head: [["#", "SKU", "Product", "HSN", "Qty", "MSP", "Margin", "Unit price", "Taxable", "GST %", "GST", "Total"]],
    body: lines.map((l, i) => [
      i + 1,
      l.sku,
      l.item_name,
      l.hsn_code ?? "",
      l.requested_qty,
      money(l.msp),
      `${Number(l.margin_pct)}%`,
      money(l.unit_price),
      money(Number(l.line_taxable)),
      `${Number(l.gst_pct)}%`,
      money(Number(l.line_gst)),
      money(Number(l.line_total)),
    ]),
    foot: [["", "", "Total", "", t.qty, money(t.msp), "", "", money(t.taxable), "", money(t.gst), money(t.total)]],
    styles: { font: "helvetica", fontSize: 8, cellPadding: 4, textColor: [19, 19, 19] },
    headStyles: { fillColor: [19, 19, 19], textColor: [255, 255, 255], fontStyle: "bold" },
    footStyles: { fillColor: [255, 250, 230], textColor: [19, 19, 19], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 247, 247] },
    columnStyles: {
      2: { cellWidth: 200 },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right" },
      9: { halign: "right" },
      10: { halign: "right" },
      11: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
  });

  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  doc.setFontSize(9);
  doc.setTextColor(99, 99, 99);
  doc.text(
    [
      "Unit price = MSP less partner margin, inclusive of GST. Taxable value and GST are derived from the GST-inclusive price.",
      facility.is_consignment ? "Consignment stock: invoiced to the partner as units are sold." : "",
      req.notes ? `Notes: ${req.notes}` : "",
    ].filter(Boolean),
    40,
    endY,
  );
  doc.save(`${req.po_no}.pdf`);
}
