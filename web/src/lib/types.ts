export type Role = "super_admin" | "admin" | "manager" | "ops" | "facility_staff";
export type FacilityType = "warehouse" | "retailer" | "super_stockist" | "internal";
export type Bucket = "sellable" | "display" | "in_use" | "damaged" | "quarantine";
export type RequestStatus =
  | "draft"
  | "submitted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "partially_dispatched"
  | "dispatched"
  | "received"
  | "closed"
  | "cancelled";
export type FoStatus = "open" | "partially_dispatched" | "dispatched" | "closed" | "cancelled";
export type Reason = "ok" | "short" | "excess" | "damaged" | "wrong_sku" | "rejected";
export type IssuePurpose = "training" | "demo" | "sample" | "internal_use" | "lost" | "scrapped";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  facility_id: number | null;
  is_active: boolean;
}

export interface Facility {
  id: number;
  code: string;
  name: string;
  type: FacilityType;
  legal_name: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  default_margin_pct: number;
  is_consignment: boolean;
  restrict_to_assortment: boolean;
  is_active: boolean;
  notes: string | null;
  region: string | null;
  fulfiller_ss_id: number | null;
  pos_location: string | null;
  planning_enabled: boolean;
  review_days: number;
  safety_days: number;
  lead_time_days: number;
}

export interface Item {
  sku: string;
  name: string;
  category_name: string | null;
  size: string | null;
  color: string | null;
  scan_identifier: string | null;
  ean: string | null;
  hsn_code: string | null;
  gst_pct: number | null;
  mrp: number | null;
  cost_price: number | null;
  item_type: string;
  enabled: boolean;
}

export interface RequestLineView {
  request_line_id: number;
  request_id: number;
  request_no: string;
  po_no: string | null;
  facility_id: number;
  sku: string;
  item_name: string;
  category_name: string | null;
  size: string | null;
  color: string | null;
  hsn_code: string | null;
  bucket: Bucket;
  requested_qty: number;
  msp: number;
  margin_pct: number;
  gst_pct: number;
  unit_price: number;
  line_total: number;
  line_taxable: number;
  line_gst: number;
  dispatched_qty: number;
  substituted_qty: number;
  received_qty: number;
  damaged_qty: number;
  pending_dispatch_qty: number;
  suggested_qty: number | null;
  rejected_qty: number;
}

export interface FoLineView {
  fo_line_id: number;
  fo_id: number;
  fo_no: string;
  fo_status: FoStatus;
  request_id: number;
  request_no: string;
  po_no: string | null;
  fulfiller_id: number;
  facility_id: number;
  request_line_id: number | null;
  sku: string;
  item_name: string;
  size: string | null;
  color: string | null;
  hsn_code: string | null;
  bucket: Bucket;
  qty: number;
  dispatched_qty: number;
  pending_qty: number;
  msp: number | null;
  margin_pct: number | null;
  gst_pct: number | null;
  unit_price: number | null;
  line_total: number;
  line_taxable: number;
  line_gst: number;
}

export const BUCKETS: { value: Bucket; label: string }[] = [
  { value: "sellable", label: "Display / Sale" },
  { value: "display", label: "Display only" },
  { value: "in_use", label: "In use" },
  { value: "damaged", label: "Damaged" },
  { value: "quarantine", label: "Quarantine" },
];

export const bucketLabel = (b: Bucket) => BUCKETS.find((x) => x.value === b)?.label ?? b;

export const FACILITY_TYPES: { value: FacilityType; label: string }[] = [
  { value: "retailer", label: "Retailer / clinic" },
  { value: "super_stockist", label: "Super stockist" },
  { value: "internal", label: "Frido internal (STF)" },
  { value: "warehouse", label: "Frido warehouse" },
];

export const ISSUE_PURPOSES: { value: IssuePurpose; label: string }[] = [
  { value: "training", label: "Training" },
  { value: "demo", label: "Demo" },
  { value: "sample", label: "Sample" },
  { value: "internal_use", label: "Internal use" },
  { value: "lost", label: "Lost" },
  { value: "scrapped", label: "Scrapped" },
];

export const REASONS: { value: Reason; label: string }[] = [
  { value: "ok", label: "OK" },
  { value: "short", label: "Short" },
  { value: "excess", label: "Excess" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_sku", label: "Wrong SKU" },
  { value: "rejected", label: "Refused" },
];

/** Raw material / packaging categories never go to clinics */
export const NON_FG_CATEGORIES = ["RAW", "RM Talawade", "RM_STORE", "Packaging", "Sparepart (Chair & Mobility)", "Cover Assembly", "FOAM", "Consumable", "POUCH", "FBF", "FBA"];

export const facilityTypeLabel = (t: FacilityType) => FACILITY_TYPES.find((x) => x.value === t)?.label ?? t;

/** Facilities that hold stock in the Hub (Frido WH stock lives in Uniware). */
export const holdsStock = (t: FacilityType) => t !== "warehouse";

export const REQUEST_SOURCES: Record<string, string> = { schedule: "Demand plan", retailer: "Raised by facility", ops: "Raised by Frido" };
