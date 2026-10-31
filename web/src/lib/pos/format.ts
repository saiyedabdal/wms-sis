const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inr0Fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-IN");

export const inr = (v: number | string | null | undefined) => inrFmt.format(Number(v ?? 0));
/** Whole rupees, for big buttons and tiles. */
export const inr0 = (v: number | string | null | undefined) => inr0Fmt.format(Number(v ?? 0));
export const num = (v: number | string | null | undefined) => numFmt.format(Number(v ?? 0));
export const pct = (v: number | string | null | undefined) => `${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
export const round2 = (v: number) => Math.round(v * 100) / 100;

export const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const time = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

export const dateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/** YYYY-MM-DD in IST. */
export const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00+05:30`);
  d.setDate(d.getDate() + n);
  return istDay(d);
};

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ones[r] : `${tens[Math.floor(r / 10)]}${r % 10 ? ` ${ones[r % 10]}` : ""}`;
  return [h ? `${ones[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}

/** Indian numbering: 1,23,45,678.50 -> "One Crore Twenty Three Lakh ... Rupees and Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  const words = parts.length ? parts.join(" ") : "Zero";
  return `${words} Rupees${paise ? ` and ${below1000(paise)} Paise` : ""} Only`;
}

export const modeLabel: Record<string, string> = {
  cash: "Cash",
  upi_static: "UPI (QR)",
  upi_razorpay: "UPI (Razorpay)",
  card_edc: "Card",
  bank_transfer: "Bank transfer",
  credit_note: "Credit note",
};

export const statusLabel = (s: string) => s.replace(/_/g, " ");

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Random UUID that also works on plain-http tablets (crypto.randomUUID needs a secure context). */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && window.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana", "37": "Andhra Pradesh",
};
