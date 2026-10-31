# Frido POS: design (prototype build)

Status: **live prototype**, built from `docs/POS-BRIEF.md` (Rev 2) and `docs/POS-DECISIONS.md` on branch `claude/frido-pos-partner-brief-67w213`.
- **Database:** both `pos_` migrations were applied to `frido-wms` on 30 Oct 2026 (`20261030194621 pos_core`, `20261030195159 pos_rpc`).
- **App:** part of the **Partner Hub** (`web/`) since 31 Oct 2026 (Decision 12): **Outward → Point of sale → Open till** opens a full-screen till at `/till/`. One app, one login (§1b).
- **Live:** on the Hub's own site, **https://frido-cdn.netlify.app** (Netlify project `frido-cdn`, formerly `wms-sis`), from 31 Oct 2026. The Hub was renamed Frido CDN and its production branch is `claude/awesome-turing-qys76w`; the POS is merged into it. The `wms-sis-pos` preview site is no longer needed.
- **Data:** no clinic is on the POS yet. A Frido super admin or ops user does that from Outward → **Set up POS**, or Till → Admin → Setup (screen 12 in §5).

The design checkpoint was skipped at the user's request ("build a proto with what you know; keep open decisions open"). This file describes what was built, the assumptions it makes, and the changes proposed for the Partner Hub.

## 1. Shape of the system

```
 Tablet / laptop / phone (Decision 5: mixed)          Supabase project frido-wms (shared with the Partner Hub)
 ┌──────────────────────────────┐   supabase-js    ┌──────────────────────────────────────────────────────────┐
 │ web/  Partner Hub (static)   │ ───────────────▶ │ pos_* tables (RLS)   pos_* functions (SECURITY DEFINER)   │
 │  Hub login (one session)     │   (anon key +    │        │                         │                         │
 │  Outward → Point of sale     │    user JWT)     │        ▼                         ▼                         │
 │  /till/  PIN · sell · bills  │                  │ Hub: items, facilities, facility_assortment,             │
 │   returns · cash · reports   │                  │      stock_balances / stock_ledger, create_sale()        │
 │  /doc/  public invoice link  │                  │ Edge Functions: pos-razorpay-qr, pos-razorpay-webhook    │
 └──────────────────────────────┘                  │                                                          │
                                                   └──────────────────────────────────────────────────────────┘
```

- The browser only **reads** `pos_` tables, through RLS. Every write is a `pos_*` database function.
- The Hub is reused, never altered:
  - **Pricing:** `items`, `facility_assortment` (price = `msp`), `price_for()` (margin).
  - **Stock and settlement:** `stock_balances` / `stock_ledger` and `create_sale()`.
  - **Roles and access:** `profiles`, `can_access_facility()`, `is_ops()`.
- Secrets (Razorpay keys, webhook secrets, the service-role key) live only in Edge Function secrets.

## 1b. Where the POS sits in the Hub: Outward + till mode

Decision 12 (31 Oct 2026): the POS is part of the Outward module, not a separate app.

- **One login:**
  - The till uses the Hub's Supabase browser client, so the Hub and the till share one session.
  - A signed-out visit to `/till/` goes to the retailer login (`/login/retailer/?next=/till/`, since clinics are retailers). It opens on Sign in rather than the onboarding form, and comes back to the till afterwards.
  - Signing out of the till returns clinic staff to that page and Frido ops to `/login/?next=/till/`.
  - Only same-site paths are honoured in `next` (`LoginScreen`).
- **Outward (`/sales/`):**
  - **On the POS:** the Point of sale card shows today's paid sales, returns (credit notes), open shifts out of active tills, and bills needing attention, with links into till mode. **Open till** replaces Record sale, so a clinic doesn't enter the same sale twice.
  - **Not on the POS:** Frido ops see **Set up POS**, which opens till Admin → Setup with that facility already chosen. Everyone else sees the usual Record sale.
  - POS bills post to the Hub's sales list through `create_sale`, with the invoice number as `bill_ref`.
- **Till mode (`/till/…`):**
  - Lives outside the Hub's `(app)` shell: full screen, black POS header, staff PIN layer, phone bottom bar.
  - Links from Outward carry `?facility=<id>`, which becomes the device's till facility.
  - **Hub** in the header, or **Back to Partner Hub** on the first PIN screen, returns to Outward.
  - Sign-out in the till signs the device out of the Hub too, since it is the same session.
- **Routes:**
  - `/till/` Sell
  - `/till/invoices/`, `/till/returns/?invoice=`
  - `/till/cash/`, `/till/reports/`, `/till/admin/`
  - `/doc/?t=` stays public.
- **Hub code touched (UI only, no database change):**
  - `web/src/app/(app)/sales/page.tsx`: the POS card and the Open till / Record sale switch.
  - `web/src/components/LoginScreen.tsx`: honours `?next=`.
  - `web/src/app/globals.css`: the POS print sizes, sheet shadow, `no-scrollbar` and `touch-action`.
  - `web/package.json`: adds `qrcode`.
  - The Hub's sidebar (`AppShell`) is unchanged; Outward stays step 3.

## 2. Schema (`supabase/migrations/20261031100000_pos_core.sql`)

All tables are `pos_`-prefixed and have RLS enabled. Anonymous users have no table access at all.

| Table | Purpose | Key columns |
|---|---|---|
| `pos_entities` | Invoicing entity (Decision 1) | `code`, `kind` (`frido`/`partner`), `legal_name`, `gstin` (validated; prefix = `state_code`), `state_code`, `address`, `pan`, `cin`, `upi_vpa` (static QR), `razorpay_enabled` |
| `pos_settings` | One row per facility on the POS | `facility_id` PK, `entity_id`, `payment_modes[]`, `cashier_max_disc_pct` (5), `manager_max_disc_pct` (10), `return_days` (10), `require_customer`, `invoice_footer` |
| `pos_series` | Series codes (Decision 11) | `code` PK `[A-Z0-9]{4}`, unique across all facilities; `facility_id`, `doc_type` (`invoice`/`credit_note`); one active per facility × type |
| `pos_series_counters` | Gap-free counters | (`series_code`, `fy`) PK, `last_no` ≤ 999999 |
| `pos_registers` | Tills | `facility_id`, `name`, `printer` (`thermal_80`/`a4`/`none`), `scan_mode` (`hid`/`camera`/`both`) |
| `pos_staff` | Who can use the POS, and their role | `user_id` PK → `profiles`, `facility_id` (null for Frido admins), `pos_role` (`cashier`/`manager`/`admin`), bcrypt `pin_hash`, lockout fields |
| `pos_staff_sessions` | PIN-switch tokens | sha256 `token_hash`, `user_id`, `facility_id`, `register_id`, `expires_at` (12 h), `revoked_at` |
| `pos_therapists` | Referring doctors and therapists, per facility | `name`, `kind`, `is_active` |
| `pos_customers` | Patients, per facility (DPDP) | `phone` (10 digits) unique per facility, `email` (NULL, never a placeholder), `gstin`, `company_name`, `lead_source`, `marketing_consent` + `consent_at` + `consent_channel` (opt-in) |
| `pos_service_skus` | Non-stock SKUs (foot scan, fitting) | `sku` PK → `items` |
| `pos_shifts` | Shift open/close (Lesson 7) | `register_id` (one open per till: partial unique index), `opening_float`, `expected_cash`, `counted_cash`, `variance`, `z_report` jsonb |
| `pos_cash_movements` | Petty cash, bank deposits, cash in | `shift_id`, `kind`, `category`, `amount`, `staff_id` |
| `pos_discount_approvals` | Manager/admin PIN approvals | `requested_by`, `approver_id`, `approver_level`, `approved_pct`, `reason`, `expires_at` (15 min), `used_at` |
| `pos_invoices` | Sales | `client_ref` uuid UNIQUE (idempotency), `status` (`awaiting_payment`/`paid`/`needs_attention`/`cancelled`), `invoice_no` ≤16 chars (null until paid), `series_code`/`fy`/`seq`, `seller_id`, `therapist_id`, customer snapshot, `supplier` jsonb snapshot, `place_of_supply`, `intra_state`, totals (gross, discount, taxable, CGST/SGST/IGST, round off, grand), `max_disc_pct`, `approval_id`, `hub_sale_id` → `sales`, `share_token` |
| `pos_invoice_lines` | Lines | `sku`, item snapshot, `hsn_code`, `gst_pct`, `is_service`, `bucket`, `qty`, `unit_price` (MSP), `mrp` (only if real), line and pro-rated cart discount, `disc_pct`, `net_amount`, `taxable`, `cgst`/`sgst`/`igst`, `returned_qty` |
| `pos_payments` | Split payments (Decision 4) | `mode` (`cash`/`upi_static`/`upi_razorpay`/`card_edc`/`bank_transfer`/`credit_note`), `amount`, `tendered`, `status`, `reference` (UTR/RRN), `gateway_ref` / `gateway_payment_id` (unique), `taken_by`, `confirmed_by/at` |
| `pos_credit_notes` / `pos_credit_note_lines` | Returns (Decision 10) | `client_ref` UNIQUE, own series, `settlement` (`refund`/`exchange`), totals, `redeemed_total`, `refunded_total`, `late_override_by`, `restock_bucket` per line |
| `pos_refunds` | Online refund queue | `entity_id` (who pays), `method` (`upi`/`bank_transfer`/`razorpay_api`), payee details, `status`, `utr`, `paid_by` |
| `pos_connectivity_log` | Outages (Decision 7) | `register_id`, `started_at`, `ended_at`, `context` |
| `pos_v_catalog` (view, security invoker) | Sell grid | assortment × item × sellable stock, `is_service`, `sale_ready` (has MSP, HSN and a valid GST rate) |

Every foreign key is indexed. Totals are checked by constraints, e.g. a credit note's `redeemed + refunded ≤ grand_total`, and a paid invoice must have a number.

### RLS by role

`can_access_facility(f)` is the Hub's own helper. It is true for Frido-side users (`admin`, `ops`, and the Hub's `manager`) everywhere, and for `facility_staff` only at their own facility.

| Data | facility_staff (cashier or clinic manager) | Hub manager / ops / admin |
|---|---|---|
| Settings, entity, series, tills, catalogue | read own facility | read all; write settings, entities and tills |
| Staff list | read own facility; **never** `pin_hash` (column privileges); sessions not readable | read all; set staff and PINs via `pos_admin_set_staff` |
| Therapists | read; insert and update if their `pos_role` is `manager` | everything |
| Customers, invoices, lines, payments, credit notes, refunds, shifts, cash, approvals, connectivity | **read own facility only**; no direct insert, update or delete | read all |
| `pos_series_counters` | no access | read |

Writes happen only through the functions below. Each one checks `assert_facility_access()` and the PIN-switch token, so a cashier at clinic A can't act at clinic B even by calling an RPC directly. The tests prove this.

The clinic "manager" role is `pos_staff.pos_role = 'manager'`. The Hub's `manager` role is Frido-side (`is_ops()` is true for it), so it can't stand in for a clinic manager.

## 3. Functions (`supabase/migrations/20261031100100_pos_rpc.sql`)

| Function | Who | What it does |
|---|---|---|
| `pos_context(p_facility_id?)` | signed in | Boot payload: user, facility, settings, entity, series, tills with their open shift, staff, therapists |
| `pos_pin_login(p_facility_id, p_register_id, p_user_id, p_pin)` → `{ok, token}` | signed in | PIN check with a 5-try lockout (never raises, so failures are counted); issues a 12-hour token |
| `pos_pin_logout(p_token)` | signed in | revokes the token |
| `pos_price_cart(p_facility_id, p_cart)` | signed in | Server pricing: MSP, line and cart discounts (cart pro-rated, the last line takes the remainder), GST split, stock less unpaid holds, problems per line, `max_disc_pct` |
| `pos_approve_discount(p_facility_id, p_requester_token, p_approver_id, p_pin, p_pct, p_reason)` | manager ≤ 10% / admin any | Creates a 15-minute approval |
| `pos_upsert_customer(p_facility_id, p_customer)` | signed in | Phone-keyed upsert; consent stored with time and channel; first lead source wins |
| `pos_open_shift`, `pos_shift_report`, `pos_add_cash_movement`, `pos_close_shift` | token; petty cash, deposits and close need a manager | X/Z report; cash-out can't exceed the drawer; a variance needs a note |
| **`pos_checkout(p_client_ref, p_facility_id, p_register_id, p_staff_token, p_cart, p_payments)`** | token | see below |
| `pos_confirm_payment(p_payment_id, p_staff_token, p_reference)` | token | Bank transfer UTR (or manual Razorpay check) → `pos__try_finalize` |
| `pos_gateway_payment(p_gateway_ref, p_gateway_payment_id, p_amount, p_status)` | **service role only** | Razorpay webhook entry; idempotent on the payment id; an amount mismatch or a cancelled draft goes to `needs_attention` |
| `pos_attach_gateway_ref` | service role only | Links a Razorpay QR to a pending payment |
| `pos_cancel_invoice(p_invoice_id, p_staff_token, p_reason)` | token | Unpaid drafts only; releases held stock and credit-note balance |
| **`pos_return(p_client_ref, p_invoice_id, p_staff_token, p_lines, p_reason, p_settlement, p_refund, p_override_token?)`** | manager token (+ admin token when late) | see below |
| `pos_refund_credit_balance`, `pos_mark_refund` | token / invoicing entity | Leftover exchange credit → refund; Frido ops (Frido-invoiced) or the clinic manager (clinic-invoiced) marks it paid with the UTR |
| `pos_log_connectivity`, `pos_report` (security invoker), `pos_admin_set_staff`, `pos_change_my_pin`, `pos_admin_setup_facility` | as named | |
| `pos_public_document(p_token)` | **anon** | The single invoice or credit note behind a share token; phone masked |

`pos__*` are internal helpers; their execute rights are revoked from `authenticated`:
- `pos__price`, `pos__finalize`, `pos__try_finalize`
- `pos__next_no`, `pos__fy`
- `pos__staff`, `pos__check_pin`, `pos__settings`
- `pos__shift_report`, `pos__invoice_summary`

### pos_checkout, step by step (one transaction)

1. `pg_advisory_xact_lock(hash(client_ref))`. If an invoice with that `client_ref` exists, return it with `replay: true` and change nothing. Ten parallel retries give one invoice (tested).
2. Check:
   - `assert_facility_access(facility)`;
   - the settings are enabled;
   - the PIN token gives the seller;
   - the till has an open shift.
3. `pos__price(…, strict)`. It locks the `stock_balances` rows in SKU order, so concurrent tills serialise without deadlocks, and it raises on the first problem:
   - SKU not in the assortment, or disabled;
   - no MSP, no HSN, or an invalid GST rate;
   - not enough stock after unpaid holds.
4. Discount authority. The seller's limit is cashier 5% or manager 10%, checked against each line's effective discount after pro-rating:
   - Above the limit, the cart must carry an unused, unexpired approval of at least that %, from a manager (≤ 10%) or an admin.
   - A manager selling above 5% gets a self-approval row written, so it is still logged.
5. Customer (required per setting) and therapist must belong to the facility. The customer is copied onto the invoice; new vs returning is worked out from paid history at the facility.
6. Payments must add up **exactly** to the rounded total:
   - `cash`, `upi_static` (needs a UTR), `card_edc` (needs an RRN) and `credit_note` (balance checked and redeemed under a row lock) → `confirmed`.
   - `upi_razorpay` and `bank_transfer` → `pending`.
7. Insert the invoice (`awaiting_payment`), its lines and its payments.
8. If every payment is confirmed, `pos__finalize`:
   - **numbers** the invoice from `pos_series_counters` (the row lock is held to commit, so the series is gap-free);
   - **calls `public.create_sale(facility, {customer_name, customer_phone, bill_ref: <invoice no>, notes}, [stock lines])`**, which books `sales` / `sale_lines` at MSP − margin for consignment settlement and posts `-qty` to `stock_ledger`, where the Hub trigger stops stock going negative. Service lines are not posted;
   - stores `hub_sale_id`.

   Any failure rolls back the whole sale: no number is used, no stock moves, and the cashier sees the error and hands the money back.
9. If a payment is pending, the invoice stays `awaiting_payment` with no number. Its lines **hold** stock against other POS checkouts. When the money is confirmed (`pos_confirm_payment` or the webhook), `pos__try_finalize` runs step 8 in a sub-transaction. If that fails, the payment stays confirmed and the invoice goes to `needs_attention` with the reason (Lesson 1: never a silent loss; tested).

When the webhook confirms, there is no signed-in user. `pos__finalize` then sets `request.jwt.claims` to the cashier who created the draft, for that transaction only, so `create_sale`'s access check passes and the Hub sale is attributed to them. Proposal H1 below removes this workaround.

### pos_return, step by step

1. An advisory lock on `client_ref` makes retries replay the same credit note.
2. Lock the invoice, which must be `paid`. The token must belong to a manager or admin.
3. Window: `return_days` (10), counted in IST calendar days. Older invoices need `p_override_token` from a `pos_role = admin` PIN.
4. For each line: quantity ≤ `qty − returned_qty`; restock to `sellable` or `damaged` (services have none). The credit is pro-rata of what was charged, and the last units take the exact remainder, so the credits add up to the charge (tested).
5. Credit note number from the credit series (gap-free, same mechanism as invoices).
6. **Hub stock:** insert `stock_ledger` rows with `movement = 'return_in'`, `ref_type = 'pos_credit_note'`, positive quantity, into the chosen bucket. This writes data only; no Hub object changes. Settlement is not reversed yet; see H2.
7. Settlement:
   - `refund` queues a `pos_refunds` row for the invoicing entity (UPI ID, bank details, or Razorpay when it was paid through Razorpay).
   - `exchange` leaves a balance that the next checkout spends as a `credit_note` payment. Any leftover can become a refund.

## 4. Invoice and credit note numbering

- **Format:** `SSSS/FYFY/NNNNNN`, always 16 characters: a 4-character series, then `/`, a 4-digit FY, `/`, and a 6-digit counter.
  - Invoice example: `NMB1/2627/000025`. Credit note example: `NMR1/2627/000002`.
- **FY:** worked out in IST (`pos__fy`). April to March, so `2627` = 1 Apr 2026 – 31 Mar 2027. The counter restarts at 1 every FY because the key is (series, FY).
- **Unique per GSTIN:** series codes are unique across every facility and entity, so two clinics sharing Frido's Maharashtra GSTIN can never collide.
- **Gap-free:**
  - The number is taken only during finalisation, inside the same transaction that posts the Hub sale. The `pos_series_counters` row stays locked until commit, and a rollback returns the number.
  - Drafts and failed or abandoned checkouts never take one.
  - Tested: 36 parallel tills issue 26 contiguous numbers; failed checkouts leave no hole.
- **Never deleted or renumbered:** a finished invoice is reversed only by a credit note.

## 5. Screens (built; see `docs/pos-prototype/*.png`)

Tablet landscape first (1280×800), with desktop and phone layouts. Frido Design System v2: Outfit, yellow `#FFD100` CTAs with black text, black `#131313` header, the N-ramp neutrals, 4 px spacing grid, radii 4/8/12/16, Remix icons, touch targets of 44–64 px.

| # | Screen | Layout and key actions | Empty, error and edge states |
|---|---|---|---|
| 0 | **Outward → Point of sale** (`/sales/`) | Hub page: Open till (header), today's sales / returns / shifts open / needs attention, links into till mode, the sales list below with POS bills by invoice number | Not on the POS: ops see Set up POS; others see the usual Record sale |
| 1 | **Login** (Frido CDN's `/login/retailer/?next=/till/`) | The Frido CDN sign-in, opened on Sign in; returns to the till afterwards | Wrong credentials message. OTP login is not built; it uses Hub accounts like the Hub does |
| 1b | **PIN switch** (modal) | Staff tiles (clinic managers and cashiers first, then Frido admins, who can also open the till and sell) + 3×4 keypad + dots; physical keyboard works; "Tap your name above" until a person is picked; "Back to Partner Hub" link | Wrong PIN shows tries left; 5 wrong locks for 5 minutes; "no PIN set" shown on the tile |
| – | Facility / till pickers | Shown only when the device user can see several clinics, or the clinic has several tills; the device remembers its till | "Clinic not on the POS yet" with a link to Setup for Frido ops |
| 2 | **Open shift** | Opening float input + quick amounts | Shown whenever the till has no open shift |
| 3 | **Sell** (`/till/`) | Left: scan/search field (keyboard-wedge focus trap; camera button with ZXing), category chips, product grid (photo, size/colour, MSP, stock badge). Right: cart (customer chip, referred-by select, lines with qty stepper, line discount link, MRP shown only if real), bill discount, totals, yellow **Charge ₹X** | Empty cart prompt; unknown barcode toast; out-of-stock and not-sale-ready (no MSP/HSN/GST) blocked with a reason; offline banner with Charge disabled while the cart is kept |
| 4 | **Customer sheet** | Phone lookup as you type (returning: visit count and last visit), name, optional email, Individual/Business toggle (GSTIN + company), lead-source chips, **unticked** consent | Invalid phone or GSTIN messages |
| – | **Discount sheet** | % / ₹ toggle, quick chips, live "within your limit" / "manager approves" / "admin only" hint | |
| 9 | **Manager approval** (PIN pad) | Reason chips + text, approver tiles (managers, or admins only above 10%) | Wrong PIN; a manager trying above 10% is refused |
| 5 | **Payment sheet** | Mode tiles (enabled modes only); amount; cash tendered + change; static UPI shows an amount-locked QR and needs the UTR; card needs the RRN; split payments list; Left to pay | Total mismatch; missing UTR/RRN; connection loss tells the cashier the retry is safe |
| 6 | **Sale complete** | Invoice number, total, modes, change due, Print 80 mm / A4, WhatsApp, SMS, copy link, New sale | Unpaid (bank / Razorpay): held stock, UTR entry or Razorpay QR with polling; Needs attention message |
| – | **Public document** (`/doc/?t=`) | Invoice or credit note, 80 mm / A4 toggle, Print/PDF, WhatsApp | Invalid link message |
| 7 | **Invoices** | Today / 7 / 30 days, search (number, name, phone), status chips with an unpaid count, table; detail modal with lines, payments, credit notes, share, Return/exchange, confirm UTR, Cancel draft | Empty state per range; late-invoice hint |
| 8 | **Return / exchange** (`/till/returns/?invoice=`) | Per-line qty stepper + Resell/Damaged, reason chips, Exchange / Refund online (UPI ID, bank account, Razorpay), credit value bar, manager PIN, admin PIN if late; success shows the credit note and "Ring up the replacement" (carries the customer, referral and credit into the cart) | Banner: returns location is still an open decision |
| 10 | **Cash & day end** | Live X-report (takings by mode, drawer maths, by staff), petty cash (categories), bank deposit, cash in, Close day with a denomination counter, Z-report, closed-shift history | Till closed; variance needs a note; cash-out above the drawer refused |
| 11 | **Reports** | Presets + dates; KPI tiles (net sales, orders + average bill, units sold/returned, new vs returning); net-sales-by-day bars (one hue, hover tooltip, table equivalent); top products, category, staff, therapist, payment reconciliation, daily figures; **Export to Excel** (8 sheets) | "Nothing in this period" rows |
| 12 | **Admin** | Needs attention · Refunds (mark paid with UTR) · Therapists & doctors · Staff & PINs (+ change my PIN; Frido ops: **Add a person** from Partner Hub logins) · Data health (SKUs that can't be invoiced) · Setup (Frido ops: **Put a clinic on the POS**: facility, invoicing entity (pick or create), series codes, payment modes, first till; then series, modes, limits, return window, footer, add till) | Role-scoped tabs; with no clinic on the POS, only Setup shows |

## 6. Folder structure

```
web/                                   the Partner Hub: Next.js 15 static export (Netlify), Supabase JS from the browser
  src/app/(app)/sales/page.tsx         Outward: Point of sale card, Open till / Record sale
  src/components/LoginScreen.tsx       Frido CDN sign-in for /login/, /login/retailer/, /login/ss/ (honours ?next=)
  src/app/till/                        till mode: layout.tsx (viewport + TillRoot), page.tsx (Sell), invoices/, returns/, cash/, reports/, admin/
  src/app/doc/                         public invoice / credit note (share link; print 80 mm / A4)
  src/components/pos/                  POS ui kit, TillRoot, Shell (top bar, gating, Hub exit), PinPad, ScanField, DocView, OutwardTill, sell/*
  src/lib/pos/                         rpc() on the Hub client, context.tsx (till state + connectivity log), cart, format, types
netlify.toml                           the Hub's Netlify config (base directory "web")
supabase/migrations/20261031100000_pos_core.sql   tables, indexes, RLS
supabase/migrations/20261031100100_pos_rpc.sql    functions, grants, catalogue view, report
supabase/functions/pos-razorpay-qr/               creates an amount-locked UPI QR (keys per entity in secrets)
supabase/functions/pos-razorpay-webhook/          verifies the signature, calls pos_gateway_payment
supabase/tests/pos/                               local harness: Supabase shim, fixtures, SQL tests, concurrency test, run.sh
docs/POS-DECISIONS.md · docs/POS-DESIGN.md · docs/pos-prototype/*.png
```

Edge Function secrets:
- `RAZORPAY_KEY_ID__<ENTITY>` and `RAZORPAY_KEY_SECRET__<ENTITY>`
- `RAZORPAY_WEBHOOK_SECRET__<ENTITY>`

`<ENTITY>` is `pos_entities.code` with `-` replaced by `_`. Deploy the webhook with `verify_jwt = false`.

## 7. How it was tested

**Database tests** (`supabase/tests/pos/run.sh`):
- **Harness:** replays the full migration history on Postgres 16. The Hub functions it depends on are byte-identical to live (md5 checked against `frido-wms`).
- **Result: 96 checks pass.**
  - `20_test_checkout.sql`:
    - pricing at MSP, not the ₹50 MRP; GST split; pro-rating;
    - data-gap blocking;
    - idempotent retry;
    - stock can't go negative, and the same SKU on two lines is checked together;
    - payments must equal the total; UTR/RRN required;
    - split payments; service lines not posted to stock;
    - bank transfer holds stock, then numbers the invoice on confirm;
    - discount limits: cashier 5%, the per-line rule, manager 10%, admin 12%, manager self-approval logged, wrong PIN, cashier can't approve, approvals single-use;
    - webhook finalisation with no user, and webhook idempotency;
    - Needs attention when stock vanished after payment.
  - `21_test_returns.sql`:
    - cashier blocked; manager return; own credit-note series;
    - pro-rata credit, with credits summing exactly to the charge;
    - restock to sellable or damaged; Hub ledger row;
    - idempotent retry; can't over-return; UPI ID required;
    - exchange redemption, balance limits, leftover → refund;
    - the 10-day window and admin override; who settles refunds.
  - `22_test_rls.sql`:
    - another clinic's staff see none of this clinic's invoices, lines, payments, customers, credit notes, refunds, shifts, staff or catalogue;
    - they can't check out, price or report there;
    - PIN hashes and sessions are unreadable;
    - no direct writes; internal and gateway functions are not callable;
    - anon sees only a valid share link, with the phone masked.
  - `30_concurrency.sh`:
    - 10 parallel retries of one checkout → one invoice;
    - 36 parallel tills for 26 units → 26 sold, 10 refused, stock 0, numbers contiguous.
- **Before applying to `frido-wms`:**
  - The branch was merged with the latest Hub branch, which added the `super_admin` role. `pos_admin_set_staff` now also accepts super admins as POS admins.
  - All 96 checks were re-run on the same migration history as live. `create_sale`, `is_ops`, `is_admin` and `can_access_facility` hash-match live.
- **After applying:**
  - **Fingerprint:** all 35 `pos_` function definitions hash-match the tested build, and the 20 tables and 29 policies are present.
  - **Advisors, run after each migration.** Every new finding is by design:
    - `pos_staff_sessions` has RLS with no policy (INFO). Only the POS functions touch it; the browser has no access.
    - 22 `pos_*` RPCs are callable by signed-in users (WARN). Each checks facility access and the PIN token, the same pattern as the Hub's own RPCs.
    - `pos_public_document` is callable by anon (WARN). It's the token-gated share link and returns one document with the phone masked.
    - Unused indexes on the new, empty tables (INFO).
    - No unindexed foreign keys and no duplicate permissive policies on `pos_` tables.
  - **Live smoke test, rolled back.** A single block ran:
    1. Clinic setup → count stock.
    2. Checkout → invoice `ZZS1/2627/000001`, Hub sale `SAL-…` with `bill_ref` = that number, settlement MSP ₹1,000 at a 10% margin (₹900 payable), stock 5 → 3.
    3. Return → credit note `ZZR1/2627/000001`, stock → 4.
    4. Share link opens.

    The block then raised an error on purpose. Afterwards no `pos_`, sales or ledger rows remained.
- **First-time setup:** tested end to end on an unconfigured copy (`docs/pos-prototype/on-*.png`). A super admin puts Neuromatics on the POS, adds a cashier and themselves as POS admin, and the cashier's PIN opens the till.
- **Deployed site:** checked in a browser. The login page renders; a signed-out visitor is redirected to `/login/`; the anonymous `pos_public_document` call returns 200 from live; no page errors.

**Prototype walkthrough:**
- **Setup:** a local demo stack: the same migrations, 20 real Frido SKUs and images from the item master, 3 staff with PINs, 4 therapists, and a week of history created through `pos_checkout`.
- **Run:** a Playwright script drives the real UI through every slice:
  1. Login → PIN → open shift.
  2. Scan + tap → returning customer → therapist → 8% bill discount → manager PIN → split cash + UPI QR → invoice `NMB1/2627/000025`, posted to the Hub as `SAL-…` with `bill_ref` = that number.
  3. 80 mm and A4 invoice.
  4. Invoices → size exchange → credit note `NMR1/2627/000002` → replacement paid with the credit note + cash.
  5. Reports, admin, offline banner, phone layout.
  6. Petty cash with manager PIN → close day balanced → Z-report.
- **Result:** zero browser errors.
- **Re-run after the merge into the Hub (31 Oct):**
  - The SQL suite passes again (97 checks).
  - The walkthrough now starts at the Hub login → Outward → **Open till**, with no browser errors.
  - Also checked:
    - a signed-out `/till/` → login → back to the till;
    - Hub → till → Hub;
    - the Outward card on desktop and phone (`docs/pos-prototype/00-*.png`);
    - an ops user on a facility not yet on the POS → Set up POS → the setup form with that facility chosen.
- **Demo backend:** a ~200-line Node gateway (kept outside the repo) speaks the Supabase auth/REST protocol on top of local Postgres and runs every request as the caller's role and JWT claims. RLS and the functions behave as on Supabase. Supabase branching (Pro plan only) and the PostgREST binary download were both unavailable.

## 8. Assumptions the prototype makes (open, not decided)

1. **Returns are recorded at the counter** (Decision 10's open question). The credit note, restock and refund queue work the same if returns move online; only the screen and who can start one would change.
2. **Settlement basis = MSP − margin** whatever the discount, as `create_sale` does today. A clinic discount therefore comes out of the clinic's margin. This is for Finance to confirm.
3. **Bank transfer = unpaid until the UTR is confirmed**: stock is held and there's no number until then. If a B2B buyer should get the goods on credit, that's a different flow.
4. **Customer required** by default (`require_customer`); configurable per facility.
5. **Place of supply = facility state** (counter sale), so CGST + SGST. The IGST path exists but nothing triggers it yet.
6. **Service SKUs** are taxed and invoiced but not posted to the Hub, so there's no settlement on them. Who earns them is open.
7. **GST rates accepted:** 0/5/12/18/28/40. Anything else (e.g. the 15% in the item master) blocks the line.
8. **Invoice PDF** is the browser's Print → PDF of the tokenised `/doc` page, not a stored PDF in Storage. Same result for the patient, with no Storage or secrets involved. A stored PDF can be added if Finance needs an archived copy.
9. **A facility on the POS sells only through the till.** Outward hides the manual Record sale button for it, so the same sale isn't entered twice. The `/sales/new` form itself still exists; H4 would enforce this in the database.
10. **The till device is signed in with a Hub login** (normally the clinic's), and staff switch with PINs on top. Leaving till mode shows the Hub as that login sees it, so a cashier with only a PIN can see what the device's login can. If that's too much, give tills a login that can see nothing else in the Hub.

## 9. Proposed Partner Hub changes (not applied; need your OK)

- **H1 `create_sale` v2:**
  - **Fields:** add `p_ref` (idempotency, unique per channel), `channel` (`pos`/`api`/`bill`/`marking`), `price_charged` per line and `payment_mode`. This matches the Hub v2 spec's planned `sales.channel / external_ref / price_charged / payment_mode`.
  - **Service caller:** a variant callable by the service role with an explicit `created_by`, removing the POS's claims workaround for webhook finalisation.
- **H2 Sale returns:**
  - **The gap:** the Hub has no way to reverse a sale. Today the POS puts stock back with `return_in` ledger rows, but `sale_lines` still count the units as sold, so consignment settlement and demand-planning velocity overstate sales.
  - **Proposal:** `sale_returns` / `sale_return_lines` + `create_sale_return(p_sale_id, p_lines, p_ref)` (restock + negative settlement), with `v_sales_lines` and `_demand_lines` net of returns.
- **H3 Settlement on price charged:** only if Finance chooses it (assumption 2). Needs `price_charged` from H1 in the settlement maths.
- **H4 One outward channel per facility:** add `facilities.outward_channel` (planned in the Hub v2 spec). The Hub's manual Sales screen refuses POS facilities, which avoids double counting. The UI half is done (Outward shows Open till instead of Record sale for a POS facility); `create_sale` doesn't refuse yet.
- **H5 POS holds in Hub availability:** unpaid POS drafts hold stock only against other POS checkouts. A Hub-side sale or transfer can take those units, and the POS then flags Needs attention. Options: Hub `available_qty` subtracts POS holds, or a shared reservations table.
- **H6 Data for go-live:**
  - **Item master:** the HSN and GST-rate cleanup Finance must confirm.
  - **Neuromatics:** MSP for every assortment SKU, plus its legal name, GSTIN and address.

## 10. Phased plan

**v1**

| Milestone | What | Needs |
|---|---|---|
| M0 Prototype | **Done on this branch** (all slices above) | – |
| M1 Pilot at Neuromatics | ~~Apply both `pos_` migrations to `frido-wms` + run advisors~~ (done 30 Oct); ~~merge into the Hub under Outward~~ (done 31 Oct; live on frido-cdn.netlify.app); put Neuromatics on the POS (Admin → Setup) once its invoicing entity is known; create real clinic logins in the Hub and their PINs; fix assortment MSP/HSN/GST; printer setup per till (RawBT on Android, USB on PC); staff training | Finance answers (entity, GSTIN, rates); returns decision |
| M2 Money paths | Razorpay keys + webhook live for Frido-invoiced facilities; petty-cash receipt photos (Storage bucket `pos-receipts`); H1 + H2 in the Hub | Razorpay account per entity; H1/H2 approval |
| M3 Polish | Needs-attention alerts (email/WhatsApp to the manager); connectivity report; customer purchase history in the sheet; per-clinic printer test page | – |

**v2:** offline queue (if the connectivity log shows it's needed), integrated card EDC, simple coupon codes, low-stock prompt → Hub "Request stock", loyalty / Frido Wallet, EMI, CSAT. Unit-level item codes, Shopify mirroring and DevX parity stay out (Decisions 2, 3, 8).

## 11. Running it

- **Tests:** `PGHOST=<socket dir> PGPORT=<port> supabase/tests/pos/run.sh` against any local Postgres 16 superuser.
- **App:** `cd web && npm install && npm run dev`, sign in, then Outward → Open till (or go to `/till/`). `web/.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `web/.env.example`). The project needs the `pos_` migrations.
- **Deploy:**
  - **Frido CDN (`frido-cdn`):** the till ships with the Hub, from the Hub's production branch (`claude/awesome-turing-qys76w`). There is no separate POS site.
  - **Manual uploads** (Netlify deploy command):
    - Upload only the committed tree: `git archive HEAD web netlify.toml` into an empty folder, then run the deploy command from there.
    - Uploading the working copy fails: the uploader skips only the top-level `node_modules`, so `web/node_modules`, `.next` and `out` go up too (an upload on 31 Oct failed this way).
