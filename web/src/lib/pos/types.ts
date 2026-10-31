export type PosRole = "cashier" | "manager" | "admin";
export type PayMode = "cash" | "upi_static" | "upi_razorpay" | "card_edc" | "bank_transfer" | "credit_note";

export interface StaffRef {
  user_id: string;
  display_name: string;
  pos_role: PosRole;
  has_pin?: boolean;
}

export interface Register {
  id: number;
  name: string;
  printer: "thermal_80" | "a4" | "none";
  scan_mode: "hid" | "camera" | "both";
  open_shift: { id: number; opened_at: string; opening_float: number; opened_by: string } | null;
}

export interface PosContext {
  user: { id: string; email: string; full_name: string; hub_role: string; facility_id: number | null; is_ops: boolean; pos_role: PosRole | null };
  facilities: { id: number; code: string; name: string }[];
  facility: { id: number; code: string; name: string; city: string | null; state: string | null; address: string | null } | null;
  settings: {
    facility_id: number;
    entity_id: number;
    payment_modes: PayMode[];
    cashier_max_disc_pct: number;
    manager_max_disc_pct: number;
    return_days: number;
    require_customer: boolean;
    invoice_footer: string | null;
  } | null;
  entity: { id: number; code: string; kind: "frido" | "partner"; legal_name: string; gstin: string | null; state_code: string;
            upi_vpa: string | null; upi_payee_name: string | null; razorpay_enabled: boolean } | null;
  series: { invoice?: string; credit_note?: string } | null;
  registers: Register[];
  staff: StaffRef[];
  therapists: { id: number; name: string; kind: "therapist" | "doctor" }[];
}

export interface StaffSession {
  token: string;
  expires_at: string;
  staff: StaffRef;
}

export interface CatalogItem {
  facility_id: number;
  sku: string;
  name: string;
  size: string | null;
  color: string | null;
  category_name: string | null;
  image_url: string | null;
  hsn_code: string | null;
  gst_pct: number | null;
  scan_identifier: string | null;
  msp: number | null;
  mrp: number | null;
  is_service: boolean;
  sellable_qty: number;
  sale_ready: boolean;
}

export interface CartLine {
  sku: string;
  qty: number;
  disc_kind?: "pct" | "amount" | null;
  disc_value?: number | null;
}

export interface Customer {
  id: number;
  phone: string;
  name: string | null;
  email: string | null;
  gstin: string | null;
  company_name: string | null;
  lead_source: string | null;
  marketing_consent: boolean;
  visits?: number;
  last_visit?: string | null;
}

export interface PricedLine {
  line_no: number;
  sku: string;
  name: string;
  size: string | null;
  color: string | null;
  hsn_code: string | null;
  gst_pct: number;
  unit_price: number;
  mrp: number | null;
  is_service: boolean;
  qty: number;
  gross: number;
  line_discount: number;
  cart_discount: number;
  disc_pct: number;
  net_amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Problem {
  line_no?: number;
  sku?: string;
  code: string;
  message: string;
  available?: number;
}

export interface Priced {
  lines: PricedLine[];
  problems: Problem[];
  cart_discount: { kind: "pct" | "amount"; value: number; amount: number } | null;
  gross_total: number;
  discount_total: number;
  net_total: number;
  taxable_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  max_disc_pct: number;
  limits: { cashier: number; manager: number };
}

export interface InvoiceSummary {
  id: number;
  invoice_no: string | null;
  status: "awaiting_payment" | "paid" | "needs_attention" | "cancelled";
  grand_total: number;
  paid_total: number;
  share_token: string;
  attention_reason: string | null;
  is_new_customer?: boolean | null;
  replay?: boolean;
  payments: { id: number; mode: PayMode; amount: number; status: string; reference: string | null; tendered: number | null }[];
}

export interface DocLine {
  sku: string;
  name: string;
  size?: string | null;
  color?: string | null;
  hsn: string;
  gst_pct: number;
  qty: number;
  unit_price?: number;
  mrp?: number | null;
  discount?: number;
  net: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface PublicDoc {
  type: "invoice" | "credit_note";
  number: string;
  date: string;
  supplier: {
    legal_name: string; trade_name: string | null; gstin: string | null; address: string; state_name: string; state_code: string;
    pan: string | null; cin: string | null; kind: string; facility_code: string; facility_name: string; facility_address: string;
    footer: string | null;
  };
  customer: { name: string | null; phone: string | null; gstin: string | null; company: string | null };
  is_b2b?: boolean;
  place_of_supply: string;
  intra_state: boolean;
  seller?: string;
  against?: string;
  against_date?: string;
  reason?: string;
  settlement?: string;
  gross_total?: number;
  discount_total?: number;
  taxable_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off?: number;
  grand_total: number;
  lines: DocLine[];
  payments?: { mode: PayMode; amount: number }[];
}
