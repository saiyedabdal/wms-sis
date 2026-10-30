# Frido WMS

Stock management for Frido inventory at partner clinics (Neuromatics, Baner) and Frido's own STF store (STF Area, ATP).
Everything is tracked per **SKU**, per **facility**, per **bucket**.

- `web/` – Next.js 15 app (App Router, Tailwind v4, Frido Design System v2 tokens)
- `supabase/migrations/` – Postgres schema, RLS and posting functions (already applied to the `frido-wms` Supabase project, Mumbai)
- `docs/SPEC.md` – the v1 decisions this is built on

## What it does

| Area | Who | What happens |
|---|---|---|
| Facilities | Ops | Create clinics, stores and warehouses; category margins (e.g. 30% non-mobility, 10% mobility); curated SKU assortment per facility with MSP, margin override and min/max |
| Item master | Ops | Upload the Uniware item-master CSV (daily). New SKUs are added, changed ones updated, missing ones disabled, nothing is deleted |
| Order request + PO | Ops | Pick SKUs from the facility's assortment (or "Suggest from min/max"). Creates `REQ-…` and `PO-…` together. Gives a PDF PO, an Excel file, a paste-ready email to the warehouse and a PO email to Finance |
| Dispatch | Ops | Enter what Uniware shipped (gate pass / invoice / DC / DN / cartons). Partial shipments and substitute SKUs are tracked against the original line |
| Receive (GRN) | Facility | Scan barcodes (USB scanner or phone camera) or type quantities. Good units go to stock, damaged units go to the Damaged bucket. Captures DN / invoice / DC / gate pass, carton count and photos. Produces a discrepancy email |
| Sales | Facility | Scan each product sold. For consignment partners each sale accrues MSP − margin payable to Frido |
| Stock count | Facility | Open count (expected qty visible); posting corrects stock immediately. Also used for opening stock |
| Issue | STF | Take stock out for training, demo, samples, internal use, or write off lost / scrapped |
| Returns | Facility | Send damaged / slow stock back to the warehouse, with a paste-ready email |
| Reports | All | Stock on hand, requested vs dispatched vs received (fill rate), monthly consignment settlement with a Finance email |

**Buckets:** `Display / Sale` (sellable), `Display only`, `In use` (e.g. wheelchairs the clinic uses), `Damaged`.

**Pricing:** partner price = MSP × (1 − margin), GST inclusive ("30 + GST on MSP"). Margin comes from the SKU override, else the facility's category margin, else the facility default. GST % and HSN come from the item master.

> Uniware shows MRP ₹50 (a placeholder) for many finished goods. Set the real MSP per SKU in **Facilities → Assortment**; the app flags SKUs that still need it.

## How stock is stored

Every movement is a row in `stock_ledger` (receipt, sale, count adjustment, bucket transfer, issue, return). A trigger keeps `stock_balances` in step and refuses anything that would go negative. All stock-changing writes go through `SECURITY DEFINER` functions (`create_order_request`, `create_shipment`, `post_grn`, `create_sale`, `post_stock_count`, `create_stock_issue`, `create_wh_return`, `move_stock`, `import_items_chunk`) that check the caller's role and facility. RLS limits facility staff to their own facility.

## Users and roles

- **Admin** – everything, plus user management
- **Ops** – all facilities: requests, dispatch, facilities, item master
- **Facility staff** – their own facility only: receive, sell, count, issue, return, reports

The **first account to sign up becomes admin**. Anyone who signs up later stays inactive until an admin activates them on the Users page. Admins can also create logins directly from the Users page once `SUPABASE_SERVICE_ROLE_KEY` is set on the server.

## Run locally

```bash
cd web
cp .env.example .env.local   # fill SUPABASE_SERVICE_ROLE_KEY if you want to create users from the app
npm install
npm run dev
```

Open http://localhost:3000, create your account (becomes admin), then: Facilities → Neuromatics → add SKUs and MSPs → Stock count to load the opening stock delivered on 27 Oct → New request.

## Deploy (Netlify)

`netlify.toml` sets the base directory to `web` and the public Supabase settings, so a connected repo builds as-is.

1. Netlify → Site configuration → Environment variables: add `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API keys → secret key; server only) so admins can create logins from the Users page.
2. Optional: `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_GSTIN`, `NEXT_PUBLIC_COMPANY_ADDRESS` for the supplier block on the PO PDF (redeploy after setting).
3. Supabase → Authentication → URL Configuration: set Site URL to `https://wms-sis.netlify.app` so confirmation emails link back to the app.

## Schema changes

Add a new file in `supabase/migrations/` (never edit applied ones) and apply it to the project. Regenerate `web/src/lib/database.types.ts` afterwards.
