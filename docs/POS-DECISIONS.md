# Frido POS: decisions

Answers to the 11 "Decisions to settle" in `docs/POS-BRIEF.md` (Rev 2), taken 30 Oct 2026, with what each one means for the build.
The design (`docs/POS-DESIGN.md`) follows from this file. If a decision changes, update it here first.

## Summary

| # | Decision | Answer |
|---|---|---|
| 1 | Who invoices the patient | **Per facility**: each facility invoices as Frido (Frido's GSTIN for the state) or as the clinic (its own GSTIN) |
| 2 | Shopify | **No.** The Hub is the source of truth for clinic sales |
| 3 | Scope | **Clinics and retailers only.** No DevX parity work |
| 4 | Payments in v1 | **Cash, static UPI QR, dynamic UPI QR (Razorpay), bank transfer, and card on any EDC with a manual reference** |
| 5 | Hardware | **Mixed per clinic** (tablet kit, laptop/PC, or phone only) |
| 6 | Discounts | Cashier **5%**, manager PIN up to **10%**, Frido admin above that. **No** pack discounts, **no** coupons in v1 |
| 7 | Offline | **Online-only, with connectivity drops logged** per register |
| 8 | Barcodes | **SKU barcode only** (`items.sku`, fallback `items.scan_identifier`) |
| 9 | Attribution | **Employee (mandatory) + referring therapist/doctor + optional lead source** |
| 10 | Returns | **10-day window**, **refund online** paid by the invoicing entity via a refund queue, late returns **Frido admin only**, exchange for **any product**. _Open: where the return is recorded (see 10)_ |
| 11 | Invoice series | **`SERIES/FY/n`**, e.g. `NMB1/2627/000123` (16 chars); credit notes get their own series code |

---

## 1. Who invoices the patient: per facility

**Answer:** c) Mixed, configured per facility.

**Implications**
- A POS-owned table of **invoicing entities** holds legal name, GSTIN, state and state code, address, and optional PAN/CIN. There is one row per Frido state registration and one per clinic that invoices on its own. Each facility's POS settings point to one entity.
- Each invoice keeps a **snapshot** of the seller's details (name, GSTIN, address, state code) at the moment it is numbered, so later edits to an entity never change an issued invoice.
- GST Rule 46 makes the number unique per FY **per GSTIN**. Several clinics can share Frido's GSTIN in a state, so series codes are unique **across all facilities**, not just within an entity (see 11).
- Money goes to the invoicing entity. The static UPI QR, Razorpay account and bank details are configured **per entity**. Razorpay keys live in Edge Function secrets keyed by entity.
- **Place of supply:** for over-the-counter sales it is the facility's state, so CGST+SGST. The IGST path stays in the tax calculation for when the buyer's state differs, but v1 has no ship-to-other-state flow. _Finance to confirm._
- **Settlement:** the Hub's `create_sale` records MSP − margin payable to Frido for every sale, whoever invoices. The accounting document behind it differs by entity:
  - Clinic-invoiced: Frido → clinic B2B invoice.
  - Frido-invoiced: the clinic's commission invoice to Frido.

  Both are Finance/Hub documents, not POS screens. They are written up as a Hub proposal in the design.
- **Data needed before go-live:** Neuromatics (`NEU-BNR`) has no GSTIN, legal name or address in `facilities` today, and Finance must say which entity it invoices under.

## 2. Shopify: no

**Answer:** a) No. The Hub is the source of truth for clinic sales.

**Implications**
- No Shopify sync, location mapping or retry queue. Reports and settlement read the Hub.
- The Hub v2 spec's "Shopify POS (clinics we equip)" outward channel is replaced by this POS.
- The Hub v2 spec says "one primary channel per retailer to avoid double counting". A facility on the POS should not also have sales entered through the Hub's manual Sales screen. This goes in the design as a Hub proposal.

## 3. Scope: clinics and retailers only

**Answer:** a) Clinics/retailers only.

**Implications**
- No RETAIL/ONLINE order type, ship-to-home, quotations, coupon engine, freebies, Frido Connect, CSAT or walk-in leads. The schema stays minimal.
- The v2 nice-to-haves from the brief stay possible, but nothing is pre-built for DevX parity.

## 4. Payments in v1

**Answer:** Cash, static UPI QR (manual confirm), dynamic UPI QR (Razorpay, auto-confirm), bank transfer, and card on **any EDC** with a manual reference. No integrated card device in v1.

**Implications**
- Payment modes: `cash`, `upi_static`, `upi_razorpay`, `card_edc`, `bank_transfer`. Each facility enables a subset. Split payments across modes are allowed.
- **Static UPI:** the entity's UPI ID (not a secret) is shown as a QR with the amount filled in. The cashier confirms receipt and enters the UTR (last 4–12 digits).
- **Dynamic UPI (Razorpay):**
  - An Edge Function creates a single-use, fixed-amount QR against the draft invoice.
  - A Razorpay webhook goes to an Edge Function. It verifies the signature and calls an idempotent "confirm payment" function that **finalises the invoice** (Lesson 1).
  - This needs a Razorpay account per invoicing entity. Any facility that can't have one uses static UPI.
- **Card (EDC):** the cashier enters the amount, the approval code or RRN, and optionally the last 4 card digits. No device integration.
- **Bank transfer:** the invoice waits as `awaiting_payment` until the UTR is entered. How stock is held while it waits is covered in the design.
- Every payment stores mode, amount, reference, status, timestamp and the staff member who took it.
- A draft with a confirmed payment that failed to finalise goes on the manager's **Needs attention** list. It never disappears silently.

## 5. Hardware: mixed per clinic

**Answer:** d) Mixed per clinic.

**Implications**
- Each register has a **hardware profile**: printer (`thermal_80`, `a4`, `none`) and scan mode (HID scanner, camera, or both).
- Supported setups: a tablet with a Bluetooth scanner and 80 mm printer, a laptop/PC with USB devices, or a phone with camera scanning and a WhatsApp invoice.
- **Camera scanning is in v1**: the browser's `BarcodeDetector` where available, with a JS fallback.
- Printing uses the browser print dialog with 80 mm and A4 print layouts. A share link (WhatsApp/SMS) is always offered.
- Layouts: tablet landscape first, also desktop and phone width. The test matrix covers all three.

## 6. Discounts

**Answer:** Cashier up to **5%** without approval. A **manager PIN** approves up to **10%**. Above 10%, only a **Frido admin**. **No** auto pack discounts and **no** coupon codes in v1.

**Implications**
- Discounts are custom only: per line (% or ₹) and per cart (% or ₹). The cart discount is pro-rated across lines for GST.
- The limit is checked on the **effective discount of each line** after pro-rating, against MSP. A large line discount can't hide inside a small cart average.
- The server re-checks limits in `pos_checkout`. The browser is never trusted.
- Every approval is logged with the approver, level, %, amount and reason.
- How a Frido admin approves at a clinic till (remote approval request, or an admin PIN) is set out in the design.
- **Assumption to confirm with Finance:** today `create_sale` settles MSP − margin to Frido whatever price is charged, so a discount comes out of the **clinic's** margin. The 10% manager cap keeps mobility items (10% margin) from being sold below what is owed to Frido. If settlement should instead follow the price charged, that's a Hub change (see the design's Hub proposal).

## 7. Offline: online-only, log drops

**Answer:** c) Online-only in v1, with connectivity failures logged.

**Implications**
- No offline queue or provisional numbers. Numbers are issued only by the server.
- The cart is kept locally, so a dropped connection doesn't lose it. The screen shows a clear "No connection" state and blocks checkout until the connection is back.
- Checkout is idempotent on a client-generated ULID, so a retry after a timeout never double-books.
- Each outage (register, start, end, duration, what the cashier was doing) is recorded locally and uploaded when the connection returns. A report shows outages per clinic so the v2 offline decision is based on data.

## 8. Barcodes: SKU only

**Answer:** a) SKU barcode only.

**Implications**
- A scan looks up `items.sku`, then `items.scan_identifier`, restricted to the facility's active `facility_assortment` and `items.enabled`.
- A scan that isn't in the assortment, is disabled, or is out of stock gives a clear error with the reason.
- EAN and unit-level codes are out. Live data: 1 of 18,049 enabled SKUs has an EAN.

## 9. Attribution

**Answer:** c) Employee (mandatory) + referring therapist/doctor + optional lead source.

**Implications**
- The selling employee is mandatory on every invoice. It is a named user, switched with a 4–6 digit PIN, and is never a shared store login (Lesson 6).
- Therapists/doctors are a per-facility list managed by the clinic manager or a Frido admin. Choosing one is optional per sale.
- Lead source is an optional one-tap list on the customer, captured on the first purchase and copied onto the invoice for reporting.
- New vs returning customer is worked out from purchase history **at that facility**.
- Customers are scoped per facility, so one clinic never sees another clinic's patients (DPDP).
- No Service ID.

## 10. Returns

**Answer**
- **Window:** 10 days from the invoice date.
- **Refunds:** online, not cash from the till.
- **Who pays the refund:** the **invoicing entity** (Frido finance for Frido-invoiced facilities, the clinic otherwise), via a refund queue. Razorpay dynamic-QR payments are refunded automatically through the Razorpay API. Everything else is paid by UPI or bank transfer, and the UTR is entered to close the refund.
- **After 10 days:** a **Frido admin** only, with a logged reason.
- **Exchanges:** **any product**. The return produces a credit note, and the new sale is paid partly with that credit note. Any difference is either paid by the patient or refunded online.

**Implications**
- Credit notes have their own series (see 11). Restock goes to `sellable` or `damaged`.
- No cash leaves the till for refunds, which keeps the shift cash count simple.
- A refund request stores the patient's UPI ID or bank details, the amount, the payer entity and a status (`pending` → `paid`/`failed`), with the UTR and who paid it.
- Credit-note value is used inside the same exchange. If the new sale costs less, the difference becomes a normal online refund. There is no lasting store-credit balance.

**Open: for review with Abdal.** Where is the return recorded?
- (a) The clinic takes the item back at the counter and records it in the POS, which issues the credit note and restocks it.
- (b) The patient returns through Frido's online channel, and Frido raises the credit note from the Hub.
- (c) The counter handles exchanges only, and refunds go through the online process.

The returns slice is designed so the credit-note and refund-queue logic is the same in all three. Only the screen and who can start a return change.

## 11. Invoice series

**Answer:** `SERIES/FY/n`, e.g. `NMB1/2627/000123`.

**Implications**
- **Invoice number:** a 4-character series code (`[A-Z0-9]{4}`), then `/`, the FY (`2627` = 1 Apr 2026 – 31 Mar 2027, IST), then `/`, then a 6-digit counter. Always exactly 16 characters.
- **Credit notes:** their own 4-character series code in the same format, e.g. `NMR1/2627/000004`.
- Series codes are unique across all facilities and entities.
- **Gap-free per series per FY:** a counter row is locked during checkout. The number is assigned **only when the invoice is finalised**, so abandoned or failed drafts never use one up. Drafts carry a ULID instead.
- The counter restarts at 1 each April.
- A finalised invoice is never deleted or renumbered. It is reversed with a credit note.
- A DevX-style long reference (e.g. `INV_2627_NEU-BNR_123`) can be shown as a secondary reference if needed, but it is not the GST number.

---

## Facts from the live database that affect the design (30 Oct 2026)

- **HSN is missing** on 13,966 of 18,049 enabled SKUs, and **GST %** on 5,235. Some SKUs show **15%**, which is not a GST rate, and some show 12%, a slab removed in the Sept 2025 rate rationalisation (items moved to 5% or 18%). **Finance should confirm rates for every SKU in a clinic's assortment.** Checkout will block any line without an HSN or a valid GST rate, and the admin screen will list these SKUs per facility.
- **MRP is a placeholder** (₹50 or less, or empty) on 17,939 of 18,049 enabled SKUs. The invoice prints MRP only when it is real (MRP > selling price). Otherwise it shows the price charged only.
- `facility_assortment.msp` is empty for one of Neuromatics' two SKUs, and `price_for()` then falls back to the item MRP (₹50). The POS will refuse to sell a SKU without an `msp`.
- **Roles:** the Hub's `manager` role is Frido-side (`is_ops()` is true for it). A clinic manager is a `facility_staff` user. The POS therefore needs its own per-facility role (cashier / manager) for PIN approvals. This is in the design.
- **`create_sale`** has no idempotency key, price charged, payment mode or channel. It books every line into `stock_ledger`, so non-stock **service lines** can't go through it as they are. The design includes a Hub proposal for this.
- The repo branch was missing the Partner Hub v2 migrations that are live (`partner_hub_enums`, `partner_hub_core`). It now includes them (commit `6ee4bd2`).

## Open items

1. **Returns:** where the return is recorded (Decision 10). For review with Abdal.
2. **Finance:**
   - Which entity Neuromatics invoices under, and that entity's legal details.
   - Settlement basis (MSP vs price charged) when the clinic discounts.
   - Place of supply for B2B buyers from other states.
   - GST rates and HSN for the clinic assortment.
3. **Service SKUs** (foot scan, fitting): who earns the revenue, and whether they settle through the Hub. Covered in the design.
