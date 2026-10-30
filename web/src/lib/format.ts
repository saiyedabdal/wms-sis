const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("en-IN");

export const inr = (v: number | string | null | undefined) => inrFmt.format(Number(v ?? 0));
export const num = (v: number | string | null | undefined) => numFmt.format(Number(v ?? 0));

export const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const dateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Price to facility incl. GST = MSP less margin; returns the GST split too. */
export function priceSplit(msp: number, marginPct: number, gstPct: number, qty = 1) {
  const unit = Math.round(msp * (1 - marginPct / 100) * 100) / 100;
  const total = unit * qty;
  const taxable = total / (1 + gstPct / 100);
  return { unit, total, taxable, gst: total - taxable };
}

/** Uniware MRP is a placeholder (50) for many finished goods. */
export const suspiciousMrp = (mrp: number | null | undefined) => mrp == null || Number(mrp) <= 50;

export const statusLabel = (s: string) => s.replace(/_/g, " ");

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
