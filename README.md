# Frido Partner Hub

Stock management for Frido inventory held at retailers and clinics (first: Neuromatics, Baner), at super stockists (SS), and in Frido's own STF store (STF Area, ATP).
Everything is tracked per **SKU**, per **facility**, per **bucket**.

- `web/` – Next.js 15 app (static export, Tailwind v4, Frido Design System v2 tokens)
- `supabase/migrations/` – Postgres schema, RLS and posting functions (already applied to the `frido-wms` Supabase project, Mumbai)
- `supabase/functions/admin-create-user` – Edge Function behind Users → "Create login" / "Sign-in link"
- `docs/SPEC.md` – the v1 decisions; `docs/SPEC-v2-partner-hub.md` – the Partner Hub lifecycle (Phase 1 is built); `docs/POS-BRIEF.md` – brief for the clinic / retailer POS

## The lifecycle (Phase 1)

The navigation follows the steps of the product flow:

| Step | Who | What happens |
|---|---|---|
| 1 Inward | Facility | Receive a shipment against what was dispatched: good units to stock, damaged to Damaged, **refused** units go straight back to the sender as a return, units nobody dispatched go to **Quarantine**. Captures DN / invoice / DC / gate pass, cartons and photos, and gives a discrepancy email. After a receipt: shortcuts to Return or Issue |
| 3 Outward | Facility | Scan each product sold. For consignment partners each sale accrues MSP − margin payable to Frido |
| 4 Stock & reconcile | Facility / Ops | Stock on hand by bucket, open counts that correct stock immediately, Quarantine that only Frido can accept into stock or send back |
| 5 Demand planning | Ops | Every Monday 06:00 IST a draft request is made per facility: sales per day × (lead time + review + safety days) × season factor, within min / max, minus on hand and on the way. Retailers and SS can raise a request any time, pre-filled from the same plan |
| 6 Approvals | Ops → Manager | The ops person assigned to the facility reviews and edits the request, then sends it for approval. The **manager approves in the app** (nobody approves their own request). Approval assigns the PO number |
| 7 Fulfilment | SS / Ops | On approval each line is routed: first to the facility's super stockist if it has free stock, the rest to the Frido warehouse. Each fulfiller gets its own fulfilment order (`FO-…`) and records dispatch with courier + AWB |
| 8 Tracking | All | Status timeline per request (created → submitted → sent for approval → approved → routed → dispatched → received → closed) with courier tracking links (Shiprocket, Delhivery, …) |

Also: Returns (to the warehouse or the SS, and receiving them back), Issue (training, demo, samples, write-off), Facilities (code = POS Store ID e.g. `FRIDO_0005`, region, supplying SS, assigned ops, planning settings, assortment and margins), item master upload from Uniware, reports and consignment settlement. Analytics (step 2 and reports) is Phase 2; Shopify POS / Uniware integrations and the category tree are Phase 3.

**Buckets:** `Display / Sale` (sellable), `Display only`, `In use` (e.g. wheelchairs the clinic uses), `Damaged`, `Quarantine`.

**Pricing:** partner price = MSP × (1 − margin), GST inclusive ("30 + GST on MSP"). Margin comes from the SKU override, else the facility's category margin, else the facility default. GST % and HSN come from the item master.

> Uniware shows MRP ₹50 (a placeholder) for many finished goods. Set the real MSP per SKU in **Facilities → Assortment**; the app flags SKUs that still need it.

## How stock is stored

Every movement is a row in `stock_ledger` (receipt, sale, count adjustment, bucket transfer, issue, dispatch, return). A trigger keeps `stock_balances` in step and refuses anything that would go negative or that would let a facility take units out of Quarantine. All stock-changing writes go through `SECURITY DEFINER` functions (`create_order_request`, `approve_request`, `dispatch_fulfilment_order`, `post_grn`, `create_sale`, `post_stock_count`, `create_stock_issue`, `create_wh_return`, `receive_return`, `resolve_quarantine`, `move_stock`, `import_items_chunk`, …) that check the caller's role and facility. RLS limits facility staff to their own facility; a super stockist also sees the orders it fulfils.

## Users and roles

- **Super admin** – everything an admin can do, plus a **View as** switch in the header (Admin, Manager, Frido ops, Retailer, Super stockist) to see exactly what that role sees for a chosen facility. Only what is shown changes: anything done in another view is saved under the super admin's own login. Only a super admin can make, change or get a sign-in link for another super admin
- **Admin** – everything, plus user management
- **Manager** – approves requests (currently Shernyl Rana)
- **Ops** – all facilities: review requests, dispatch, facilities, item master, quarantine decisions
- **Field sales team** – works in the retailers / SS they are assigned to (Facilities → Details → Assigned Frido team), with the same screens as that facility's staff
- **Facility staff** – their own retailer / SS / store: receive, sell, count, issue, return, request stock; an SS also dispatches to its retailers

**Login page:** tabs for Admin, Field sales, Retailer and Super stockist (one sign-in behind all four). The Retailer and Super stockist tabs open the **onboarding form**: business details, point of contact, products they deal in, whether they keep stock (where, how it is tracked, who looks after it) or want Frido to maintain it. Applications wait on **Onboarding** (admins), where an admin approves or removes them. Approving creates the facility and a login with a temporary password; the person must choose their own password at first sign-in.

**Approval email:** sent through [Resend](https://resend.com) once two Edge Function secrets are set in Supabase (Edge Functions → Secrets): `RESEND_API_KEY`, and `MAIL_FROM` such as `Frido Partner Hub <partnerhub@myfrido.com>` on a domain verified in Resend. Until then the Onboarding page shows the approval message (with the temporary password) to copy and send yourself.

Other logins are created by an admin on the Users page: **Create login + get link** (or **Sign-in link** on an existing user) gives a one-time link to share; it opens a page to set a password.

## Run locally

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

## Deploy (Netlify)

The portal is a **static export** (`web/out`): every page reads and writes Supabase from the browser, so Netlify only serves files. `netlify.toml` builds `web/` and carries the public Supabase settings, so a connected repo deploys as-is. Record pages use `?id=` (e.g. `/requests/view/?id=12`).

- The Edge Function `admin-create-user` checks the caller is an admin and uses the service-role key Supabase injects. Netlify needs no secrets.
- Supabase → Authentication → URL Configuration: Site URL `https://wms-sis.netlify.app`, ideally with `https://wms-sis.netlify.app/reset-password/` under Redirect URLs (without it, sign-in links land on the home page, which forwards to the set-password page).
- Optional: `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_GSTIN`, `NEXT_PUBLIC_COMPANY_ADDRESS` (Netlify env vars) for the supplier block on the PO PDF; redeploy after setting.

## Schema changes

Add a new file in `supabase/migrations/` (never edit applied ones) and apply it to the project. Regenerate `web/src/lib/database.types.ts` afterwards.
