# Brief: Frido POS for clinics and retailers

## Why
Frido is placing stock at partner clinics and retailers (first: Neuromatics, Baner, a physio centre) and runs its own retail stores on **DevX POS on Shopify** ("Frido x Devx"). Clinics need a simple POS to sell Frido products to patients. Every sale must reduce stock and feed consignment settlement in the **Frido Partner Hub** (our WMS, repo `saiyedabdal/wms-sis`, live at https://wms-sis.netlify.app).

Goal: a fast, scan-first POS that clinic staff can use with almost no training, producing a proper GST invoice, with sales flowing into the Partner Hub in real time.

## What the Partner Hub already has (reuse, don't duplicate)
Supabase project **`frido-wms`** (`qlksootwhmpaqznebnlz`, Mumbai). Schema lives in `wms-sis/supabase/migrations/`.
- `items`: Uniware item master (~19.7k SKUs). `sku` = barcode (`scan_identifier`), `name`, `size`, `color`, `category_name`, `hsn_code`, `gst_pct`, `mrp`.
- `facilities`: one row per clinic, store or super stockist. **`code` = POS Store ID** (e.g. `FRIDO_0005`).
- `facility_assortment`: SKUs allowed at each facility, with **`msp`** (selling price) and partner margin %. Uniware MRP is often a ₹50 placeholder, so the POS must use `msp`.
- `stock_balances` / `stock_ledger`: on-hand per facility × SKU × bucket (`sellable`, `display`, `in_use`, `damaged`, `quarantine`). Only `sellable` (and `display`, if allowed) can be sold.
- `create_sale(p_facility_id, p_header, p_lines)` RPC: books a sale, reduces stock, and records settlement (MSP − margin payable to Frido). Supabase Auth users have a role and a facility (`facility_staff` = clinic staff), and RLS keeps staff to their own facility.
- Frontend stack: Next.js static export on Netlify, Supabase JS from the browser, Edge Functions for privileged work, Frido Design System v2 (Outfit font, yellow #FFD100 CTAs, black #131313; see the `frido-design-context` skill).

## Reference: what DevX captures today (Shopify order #MF0223944074)
Location "ELPro Mall". Lines with SKU, size, scan type and scanned value. Percentage discount (−₹150). Attributes: Store ID `FRIDO_0005`, Employee ID `EMP_0014`, Employee Name, Store Name, `delivery_type: CASH_AND_CARRY`, POS Order ID (ULID), **POS Invoice ID `INV_2627_FRIDO_0005_7259`** (financial year + store code + running number), POS Invoice URL (PDF), Custom Discount Code, Store Discount Amount, Is Payment Splitted, Transaction Mode (`RAZORPAY_POS`). The new POS should capture at least this.

## Users
- **Cashier / clinic staff**: sells, takes payment, prints or shares the invoice.
- **Store / clinic manager**: discounts above a limit, returns and exchanges, day-end close.
- **Frido admin**: price lists, discount rules, reports across stores.

## Must-have (v1)
1. **Sell:** scan barcode (USB/Bluetooth scanner, or phone camera) or search. Cart with qty, line discount (% or ₹) and cart discount. Only SKUs in the facility's assortment, priced at `msp`; block or flag out-of-stock lines.
2. **Customer:** phone (key), name, optional email. **Referring therapist / doctor** at the clinic, for incentives and reporting.
3. **Payment:** cash, UPI QR, card through a Razorpay POS device. Split payments. Record mode, reference and amount for each payment.
4. **GST invoice:** FY-based series per store (DevX-style `INV_<FY>_<STORE>_<n>`, max 16 chars where GST requires), HSN and GST split, PDF. Print on 80 mm thermal or A4, and share on WhatsApp/SMS.
5. **Returns / size exchange:** against the original invoice. Credit note, restock to `sellable` or `damaged`.
6. **Day-end:** open/close register, cash count, Z-report by payment mode and staff.
7. **Sync to Partner Hub:** every invoice, return and exchange posts to the Hub with the POS invoice ID as an idempotency key, so stock and settlement update immediately.
8. **Reports:** sales by day, SKU, category, staff and therapist; payment reconciliation; export to Excel.

## Nice-to-have (v2)
Offline mode (installable PWA, queued sync), loyalty / Frido Wallet, combos and coupons, customer purchase history, low-stock prompt that opens a "Request stock" in the Hub, Shopify order mirroring.

## Decisions to settle at the start of the new chat
1. **Who invoices the patient?** Under consignment the stock is Frido's. Is the invoice issued by Frido (Frido GSTIN, clinic acts as agent) or by the clinic (clinic buys at MSP − margin and resells)? This changes the invoice header, the GSTIN and the settlement. **Ask Finance first.**
2. **Shopify:** should POS sales also create Shopify orders at a POS location (like DevX), or does the Hub become the source of truth for clinic sales?
3. **Is this only for clinics/retailers, or will it eventually replace DevX in Frido's own stores?**
4. **Payment devices:** Razorpay POS, or Pine Labs / Paytm? Is a UPI QR enough for small clinics?
5. **Hardware per clinic:** Android tablet or laptop, scanner, thermal printer?
6. **Discount rules:** maximum % for cashier vs manager; are coupon codes needed in v1?
7. **Offline:** how often do clinics lose internet? (decides whether offline is v1 or v2)

## Suggested architecture
- Separate app (own repo or `pos/` folder), **same Supabase project** so auth, items, facilities, assortment and stock are shared.
- New tables owned by the POS: `pos_registers`, `pos_shifts`, `pos_invoices`, `pos_invoice_lines`, `pos_payments`, `customers`, `therapists`, `credit_notes`, `invoice_series`.
- Checkout through one Postgres function (e.g. `pos_checkout`) that numbers the invoice, records payments and calls the Hub's sale posting in the same transaction (stock can't go negative; the Hub trigger enforces it).
- Same frontend stack and design system as the Hub; installable PWA for tablets.
- Coordinate schema changes with the Hub: migrations go in `wms-sis/supabase/migrations/` (or a clearly prefixed set in the POS repo), and the Hub's planned outward API (channel, external ref, price charged, payment mode on sales) should be shared, not built twice.
