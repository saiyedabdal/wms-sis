# Brief: Frido POS for clinics and retailers

_Rev 2, 30 Oct 2026. Adds what DevX POS does today (storefront `frido.devxcommerce.com`, admin `frido-admin.devxcommerce.com`, reviewed live), a parity matrix, DevX failure modes to avoid, and multiple-choice decisions._

## How to run this brief (instructions for Claude Code)
1. Read this file end to end, then the Partner Hub schema in `supabase/migrations/` and the `frido-design-context` skill.
2. Ask the **Decisions to settle** questions **one at a time**, each with the listed options (AskUserQuestion). Do not batch them. Record the answers in `docs/POS-DECISIONS.md`.
3. Propose the **schema** (tables, key columns, RLS, RPCs) and the **screen list with wireframe notes**. Wait for approval before writing code.
4. Shared Supabase project `frido-wms`: every new POS object is prefixed `pos_` and lives in its own migrations (`supabase/migrations/<ts>_pos_*.sql`). **Do not alter existing Hub tables, functions, triggers or policies without asking first.** If the Hub needs a change, write it up as a proposal. Do not apply it.
5. Never put secrets in tables the browser can read. API keys go in Edge Function secrets.

## Why
Frido is placing stock at partner clinics and retailers (first: Neuromatics, Baner, a physio centre). Frido's own retail stores run **DevX POS on Shopify** ("Frido x Devx", ~30 stores, store codes `FRIDO_00xx`). Clinics need a simple POS to sell Frido products to patients. Every sale must reduce stock and feed consignment settlement in the **Frido Partner Hub** (our WMS, repo `saiyedabdal/wms-sis`, live at https://wms-sis.netlify.app).

Goal: a fast, scan-first POS that clinic staff can use with almost no training. It produces a proper GST invoice, and sales flow into the Partner Hub in real time. It must also avoid the reliability problems DevX has today (see "Lessons from DevX").

## What the Partner Hub already has (reuse, don't duplicate)
Supabase project **`frido-wms`** (`qlksootwhmpaqznebnlz`, Mumbai). The schema lives in `wms-sis/supabase/migrations/`.
- `items`: Uniware item master (~19.7k SKUs). `sku` = barcode (`scan_identifier`), plus `name`, `size`, `color`, `category_name`, `hsn_code`, `gst_pct` and `mrp`.
- `facilities`: one row per clinic, store or super stockist. **`code` = POS Store ID** (e.g. `FRIDO_0005`).
- `facility_assortment`: the SKUs allowed at each facility, with **`msp`** (selling price) and partner margin %. Uniware MRP is often a ₹50 placeholder, so the POS must price at `msp` and print MRP only when it is real.
- `stock_balances` / `stock_ledger`: on-hand stock per facility × SKU × bucket (`sellable`, `display`, `in_use`, `damaged`, `quarantine`). Only `sellable` (and `display`, if allowed) can be sold.
- `create_sale(p_facility_id, p_header, p_lines)` RPC: books a sale, reduces stock and records settlement (MSP − margin payable to Frido). Supabase Auth users have a role and a facility (`facility_staff` = clinic staff), and RLS keeps staff to their own facility.
- Frontend stack: Next.js static export on Netlify, Supabase JS from the browser, Edge Functions for privileged work, Frido Design System v2 (Outfit font, yellow #FFD100 CTAs, black #131313; see the `frido-design-context` skill).

## How DevX POS works today (observed 30 Oct 2026)

### Storefront (cashier app)
- **Top bar:** store switcher, **Customer Login**, **Walk-in Form**, cart badge.
- **Home:** the Retail and Online coupon list on the left. On the right, **Scan Barcode** with a Scan Type choice: **Item Code** (a Unicommerce unit-level barcode such as `RTDMHN-2627N1112918`, validated live against Unicommerce inventory status) or **SKU**. Then **Employee** (required) and **Service ID** (required).
- **Products:** an image grid with a category filter, search, "Add to Cart", and badges such as "Buy 2, get 58% off". The catalogue includes bundles, **service SKUs** (3D Foot Scan, 2D Gait Analysis, combo scan, Custom Insoles) and **gift coupon SKUs** (FREE GIFT COUPON ₹500/₹1000).
- **Cart drawer:** a **Business Type D2C / B2B** toggle (B2B captures the GSTIN and company name). Each line shows MRP crossed out, compare-at price, net price and a qty stepper. Then **Agent Name** (required), **Service ID** (required), and **Coupons & discounts**: Online Coupon, Retail Coupon or Custom Discount (% or ₹). These are **mutually exclusive**: "remove the current discount to apply another". Then the price breakdown, **Save Quote** and **Checkout**.
- **Customer Login modal:** 10-digit mobile (the key), optional email with a domain picker (gmail.com etc.), "Heard about us before?" (Y/N/Maybe), "Has family purchased from Frido?" (Y/N/Maybe), and **"Accept email marketing" pre-ticked**.
- **Walk-in Form:** an embedded Zoho lead-capture form (name, phone, email, store, call-back date, product, category) for walk-ins who don't buy.
- **Orders:** KPI tiles (total, returned and gross sold qty; gross orders; retail vs online; new vs old customers; total, returned and net sales), filters by employee and date, and **Fallback Order Punching**. Order detail shows the customer, invoice no., Shopify order ID/name, **Gate Pass** status, initiated/placed timestamps, transactions (mode, phone, amount, status, receipt), and line items with the **unit item code**. There is a print button. Returns follow `ORDER_RETURN_IN_DAYS` (7 days for staff, 15 for admin).
- **Inventory:** Store View / Global View by facility × SKU, showing inventory, bad inventory and EAN.
- **Finance:** **CMS** (Cash in Store: a running balance, plus handovers as credit/debit with a receipt image) and **Petty Cash** (debits by category: Food, Utilities, Maintenance; description and receipt).
- **Frido Connect:** QR cards for Book a Service, Talk to an Expert and Share your Review (Google), plus a lead form.
- **Also:** Quotations, Employees, Stores, Coupons, Analytics, CSAT.

### Admin
- **Global Configuration** (key/value): `COMPANY_NAME` (Frido Arcatron Mobility Pvt Ltd), CIN, PAN, `MAX_ALLOWED_DISCOUNT` = 10 (%), `ORDER_RETURN_IN_DAYS` = 7 / `_ADMIN` = 15, `PACK_OF_2_DISCOUNT_PERCENTAGE` = 5, `PACK_OF_4_…` = 10, `COMBO_DISCOUNT_MODE`, `EMPLOYEE_CODE_PREFIX` = EMP, `STORE_CODE_PREFIX` = FRIDO, `EXCLUDED_WAREHOUSE_SKU`, health states for Shopify and Unicommerce, and Amazon Pay and LimeChat settings.
- **Store** (per store): Store ID, name, type (Retail/Online), **Invoice Start Code**, Bill-Me code, store address and **billing address with state code and state number** (place of supply), **Warehouse Mapping ID / Party Code / Shopify Location ID**, **GSTIN and GST owner name**, payment integration (Razorpay POS device IDs, Paytm POS terminals with TID/MID/key, Snapmint, Amazon Pay store/terminal), **Active Payment Modes** (CASH, QR_PAYMENT, RAZORPAY, RAZORPAY_POS, PAYTM_POS, SNAPMINT, BANK_TRANSFER, DISTRICT_BY_ZOMATO, AMAZON_PAY), Frido Connect QR images, and **allowed Discount Types** (Online Coupon, Retail Coupon, Custom Discount, Price Adjustment).
- **Store Coupons:** name, type (Percentage / Fixed / **Buy X Get Z at Y% off**), priority, start/end date, active, usage limit, min qty, min/max order value, discount %, max discount amount, **Approval Needed** (an approver PIN is required when the coupon takes the cart above `MAX_ALLOWED_DISCOUNT`; manual price adjustments always need approval), store allocation (all/specific) and product applicability. There is also an "Export Usage" report.
- **Employees:** `EMP_xxxx`, name, email, phone, **role** (`staff`, `store_login` = shared store account, `admin`), store and active flag.
- **Orders:** code = invoice no. (`INV_2627_FRIDO_0005_7259`), status (`PENDING` → `SENT_TO_SHOPIFY`, `Cancelled`), type `RETAIL` / `ONLINE` (ship-to-home from store), B2B GST fields, Shopify order ID and name, total, discount and net total. **The cart discount is pro-rated across lines** (₹150 on ₹2,997 = 5% on each line). Also payment ID and gateway ref, customer, store (with GSTIN and address), billing/shipping address and gate pass.
- **Fallback Orders:** payments captured where the order then failed. **98 recorded, 93 unresolved, ₹5.31 lakh.**
- **Unicommerce:** manual "complete fulfilment" (check status → invoice → manifest → delivered). **3,443 stuck orders** (`UNFULFILLABLE`: unit not in store facility; `FAILED_INVOICE`: `LOCATION_NOT_SERVICEABLE`).
- **Inventory** (sync from Unicommerce: facility, SKU, inventory, blocked, EAN), **Finance** (CMS, Petty Cash with Analytics and Deleted tabs), **Footfall** (unused), **Freebies** (auto-add free variants above a minimum cart value), **Analytics** (qty sold by SKU × store × employee), **CSAT** (post-purchase survey configs).

## Lessons from DevX: build these in from day one
1. **Payment and order in one atomic step.** Fallback orders exist because payment succeeds and order creation then fails. In our POS, a payment is recorded against a `pos_invoice` in `draft`/`awaiting_payment`, and a confirmed payment **always** finalises the invoice (idempotent RPC, retry-safe). Any stuck draft with a confirmed payment appears on a "needs attention" list for the manager. It never becomes a silent loss.
2. **Stock check against the Hub, not a third system.** DevX sells units Unicommerce then can't fulfil (`UNFULFILLABLE`). Our checkout must reserve or deduct from `stock_balances` inside the same transaction and fail fast if stock is short.
3. **GST-compliant invoice number.** `INV_2627_FRIDO_0005_7259` is **24 characters**, but GST Rule 46 allows **at most 16**, unique per FY per GSTIN, using only letters, digits, `-` and `/`. Proposal: `<SERIES>/<FY>/<n>`, e.g. `NMB1/2627/000123` (16 chars), where SERIES is a short per-facility code. Keep the long DevX-style ID only as a display/reference alias if needed.
4. **No placeholder emails.** DevX stores `<phone>@frido.in` when there is no email. We store `NULL`.
5. **Marketing consent is opt-in** (DPDP Act 2023): unticked by default, stored with a timestamp and channel.
6. **Named logins, not shared store accounts.** DevX `store_login` users make staff attribution unreliable. Use one Supabase user per person, plus a fast **4–6 digit PIN switch** at the till.
7. **Cash must close.** DevX "Cash in Store" is a running balance (₹5.13 lakh at Gachibowli, with negative opening balances in admin). We use shift open/close with counted cash, variance, and bank deposits and petty cash as recorded cash-outs.
8. **Secrets stay server-side.** DevX admin shows API keys and tokens in plain text. Ours live in Edge Function secrets only.

## Users
- **Cashier / clinic staff:** sells, takes payment, prints or shares the invoice.
- **Store / clinic manager:** approves discounts above the limit (PIN), returns and exchanges, petty cash, day-end close.
- **Frido admin:** price lists, discount rules and coupons, payment terminals per store, reports across stores.

## Must-have (v1)
1. **Sell:** scan a barcode (USB/Bluetooth scanner, or phone camera) or search. SKU barcode = `items.sku`. Only SKUs in the facility's assortment, priced at `msp`. Block or flag out-of-stock lines. Product grid with category filter and search for tablets. **Service SKUs** (e.g. foot scan, fitting) as non-stock lines.
2. **Cart and discounts:** qty, line discount (% or ₹) and cart discount. The cart discount is pro-rated to lines for GST. One discount source at a time (coupon _or_ custom), as in DevX. Above the cashier's max % (DevX: 10%), a **manager PIN** is required and the approver is logged. Auto pack discounts (2-pack 5%, 4-pack 10%) only if Decision 6 says so.
3. **Customer:** phone (key, 10 digits), name, optional email, optional GSTIN and company name for **B2B**. **Referring therapist / doctor** for incentives and reporting. Optional "how did you hear" and new/returning flag (auto from history). Opt-in consent.
4. **Staff attribution:** the selling employee is mandatory on every invoice (DevX "Agent Name").
5. **Payment:** per-facility enabled modes, at minimum cash, UPI QR and a card device. Split payments. Store mode, amount, gateway/terminal ref, status, timestamp and the staff member for each payment.
6. **GST invoice:** FY-based series per facility (≤16 chars, see Lesson 3). Supplier name, GSTIN, address and state code; place of supply; HSN; CGST/SGST or IGST split; MRP and price charged; amount in words. PDF on **80 mm thermal** and **A4**. Share on WhatsApp/SMS with a link.
7. **Returns / size exchange:** against the original invoice, within a configurable window (DevX: 7 days staff, 15 days admin). Credit note in its own series. Restock to `sellable` or `damaged`. Refund to the original mode or as store credit.
8. **Day-end:** open/close register (shift), opening float, cash count, variance, **petty cash** entries (category, amount, receipt photo) and bank deposit. Z-report by payment mode and staff.
9. **Sync to Partner Hub:** every invoice, return and exchange posts to the Hub with the POS invoice ID as the idempotency key, so stock and settlement update immediately.
10. **Reports:** sales by day, SKU, category, staff and therapist; KPI tiles as in DevX (gross/returned/net qty and sales, new vs returning customers); payment reconciliation; export to Excel.

## Nice-to-have (v2)
Offline mode (installable PWA, queued sync); **quotations** (Save Quote → convert to invoice, as in DevX); ship-to-home ("ONLINE") orders; coupons with BxGy, usage limits and store/product scoping; freebies above a cart value; loyalty / Frido Wallet; EMI (Snapmint); customer purchase history; a low-stock prompt that opens a "Request stock" in the Hub; Shopify order mirroring; CSAT survey after purchase; walk-in lead capture; Frido Connect QR cards; unit-level item-code scanning.

## DevX parity matrix

| Capability | DevX today | POS v1 | Later / never |
|---|---|---|---|
| Scan by SKU | Yes | Yes | |
| Scan by unit item code (Unicommerce) | Yes | No | v2 if Decision 8 says so |
| Product grid + search | Yes | Yes (simplified) | |
| D2C / B2B invoice (GSTIN) | Yes | Yes | |
| Employee + Service ID per sale | Yes | Employee yes; Service ID per Decision 9 | |
| Custom discount + approver PIN | Yes (10%) | Yes | |
| Store/online coupons, BxGy, freebies | Yes | No | v2 |
| Pack-of-2/4 auto discount | Yes | Per Decision 6 | |
| Split payments, multiple devices | Yes | Yes (modes per Decision 4) | |
| Quotations | Yes | No | v2 |
| Ship-to-home (ONLINE) orders | Yes | No | v2 / Decision 3 |
| Returns with window | Yes | Yes | |
| Cash handover + petty cash | Yes (no close) | Shift close + petty cash | |
| Shopify order push | Yes | Per Decision 2 | |
| Unicommerce fulfilment | Yes (fragile) | No (Hub is stock truth) | |
| Walk-in leads, Frido Connect, CSAT, footfall | Yes | No | v2 |
| Therapist / doctor referral | No | **Yes** | |
| Consignment settlement | No | **Yes** (via Hub) | |

## Decisions to settle (ask one at a time, with these options)

1. **Who invoices the patient?** _(Check with Finance.)_
   - a) **Frido invoices** with Frido's GSTIN for the clinic's state; the clinic acts as a commission agent and margin is settled separately (needs Frido GST registration or an ISD/additional place of business in each state).
   - b) **Clinic invoices** with its own GSTIN; it is deemed to buy at MSP − margin and resell (the Hub records a B2B sale to the clinic).
   - c) Mixed, configured per facility.
2. **Shopify:** should POS sales also create Shopify orders?
   - a) No. The Hub is the source of truth for clinic sales (recommended for clinics).
   - b) Yes, mirror every sale to a Shopify POS location, as DevX does.
   - c) Mirror later (v2), in batches.
3. **Scope:** only clinics/retailers, or eventually replace DevX in Frido's own stores?
   - a) Clinics/retailers only.
   - b) Clinics first, with Frido stores in a later phase (design for parity: ONLINE orders, coupons, quotations).
   - c) Replace DevX soon (parity becomes v1).
4. **Payments for clinics in v1** (multi-select):
   - Cash · Static UPI QR (manual confirm) · Dynamic UPI QR (Razorpay, auto-confirm) · Razorpay POS card device · Paytm / Pine Labs EDC · Bank transfer.
5. **Hardware per clinic:**
   - a) Android tablet + Bluetooth scanner + 80 mm Bluetooth printer.
   - b) Existing laptop/PC + USB scanner + USB thermal printer.
   - c) Phone only (camera scan, WhatsApp invoice, no printer).
   - d) Mixed per clinic.
6. **Discount rules:**
   - Cashier max %: 0 / 5 / 10 (DevX) / custom. Manager max %: 10 / 20 / custom; above that, admin only.
   - Auto pack discounts (2-pack 5%, 4-pack 10%) in v1: yes / no.
   - Coupon codes in v1: no (v2) / simple % or ₹ codes only / full DevX coupon engine.
7. **Offline:** how often do clinics lose internet?
   - a) Rarely, so online-only in v1 with a clear "no connection" state.
   - b) Sometimes, so v1 needs a queued sale with provisional numbering.
   - c) Unknown, so ship online-only and log connectivity failures to decide.
8. **Barcodes at clinics:**
   - a) SKU barcode only (`items.sku`).
   - b) Also accept EAN.
   - c) Unit-level item codes as in DevX/Unicommerce (serial tracking).
9. **Attribution fields:**
   - a) Employee + therapist/doctor.
   - b) Also a DevX-style "Service ID".
   - c) Also lead source ("how did you hear").
10. **Returns policy:** window 7 / 15 / 30 days; refund to original mode / store credit only / manager's choice; exchanges limited to size swaps or any product.
11. **Invoice series format** (≤16 chars): `NMB1/2627/000123` style, or Finance's own format.

## Suggested architecture
- Separate app (own repo or `pos/` folder), **same Supabase project**, so auth, items, facilities, assortment and stock are shared.
- New POS-owned tables, all `pos_` prefixed: `pos_settings` (per facility: series code, enabled payment modes, discount limits, return window, printer format), `pos_registers`, `pos_shifts`, `pos_cash_movements` (petty cash, deposits, float), `pos_customers`, `pos_therapists`, `pos_invoices`, `pos_invoice_lines`, `pos_payments`, `pos_discount_approvals`, `pos_credit_notes`, `pos_credit_note_lines`, `pos_invoice_series`, `pos_staff_pins`, `pos_sync_log`. Coupons and quotations only if a decision brings them into v1.
- **Checkout through one Postgres function** (`pos_checkout`, `SECURITY DEFINER`, idempotent on a client-generated ULID). In one transaction it validates assortment, price and discount limits, numbers the invoice gap-free per series (row lock on `pos_invoice_series`), records payments and calls the Hub's sale posting. Stock can't go negative; the Hub trigger enforces this. Also `pos_return`, `pos_open_shift`, `pos_close_shift`.
- Payment gateway and device callbacks go through **Edge Functions** (webhook → confirm payment → finalise invoice), with secrets in function secrets.
- Invoice PDF generated by an Edge Function or client-side and stored in Supabase Storage (`pos-invoices/`). Share by signed link.
- Same frontend stack and design system as the Hub; installable PWA for tablets; large touch targets; keyboard-wedge scanner support (focus trap on the scan field).
- Coordinate schema changes with the Hub: the Hub's planned outward API (channel, external ref, price charged, payment mode on sales) should be shared, not built twice. Propose any change to `create_sale` or Hub tables before making it.

## Screens to propose (starting list; refine after the decisions)
1. Login (email/OTP) + staff PIN switch.
2. Open shift (float).
3. **Sell:** scan field + product search/grid | cart with lines, discounts, customer and therapist chips | pay button.
4. Customer sheet (phone lookup, create, B2B fields, consent).
5. Payment sheet (split modes, QR display, device ref entry/confirm).
6. Invoice done (print 80 mm / A4, WhatsApp, SMS, new sale).
7. Invoices list + detail (reprint, return/exchange).
8. Return / exchange flow → credit note.
9. Manager approval PIN modal.
10. Cash: petty cash, deposit, close shift with Z-report.
11. Reports (KPI tiles + tables + Excel export).
12. Admin: facility POS settings, therapists, staff and PINs, discount limits, (coupons if v1).
