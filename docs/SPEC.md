# Frido WMS (wms-sis) — v1 Spec

Stock management for Frido inventory placed at partner clinics / physio centres and Frido-owned stores.
All tracking is at **SKU level** (no batches, no expiry, no bins).

## Facilities
| Facility | Type | Ownership |
|---|---|---|
| Neuromatics, Baner | Partner clinic | Frido-owned stock (consignment) |
| STF Area, ATP | Frido-owned store | Frido |
| Central warehouse | Warehouse (runs on Uniware) | Frido |

- Facility creation is an admin screen: name, code, type, address, partner margin %, contact emails.
- Stock location is **facility level only**.

## Item master
- Source: Uniware item-master CSV export (~19.9k rows, `Product Code` = SKU, `Scan Identifier` = barcode).
- v1: **manual CSV upload** by ops (daily). Upsert by SKU; SKUs missing / `Enabled=false` are disabled, never deleted.
- Bundles (`Type=BUNDLE`, one row per component) stored as bundle → component mappings; facilities stock components.
- Brand normalised (FRIDO/Frido/frido).
- Each facility has a **curated assortment**; only those SKUs can be requested / sold there.
- Later: Uniware API pull ~6 AM IST.

## Flows
1. **Order request (indent)** — raised directly by ops (no approval). Lines: SKU, qty.
   - Generates a **copy-paste email template** for the warehouse (+ xlsx download).
   - Generates a **PO for finance**: price = MRP − facility partner margin %, GST breakup from HSN / GST tax code, **PDF** with PO number and date, plus a copy-paste mail for finance.
2. **Dispatch** — warehouse dispatch (from Uniware) entered **manually**. Multiple partial shipments per request allowed; **substitutions** allowed and tracked against the original line.
3. **Receipt (GRN)** at facility — scan barcodes (camera/USB) or type qty against expected list.
   Captures: DN no., invoice / DC / gate pass no., carton count (received vs dispatched), per-line discrepancy reason (short / excess / damaged / wrong SKU), photos.
   Generates a copy-paste discrepancy email.
4. **Sales** — clinic staff scan/enter each sale in the app (POS-style screen).
5. **Stock count** — open count (expected qty visible), adjusts stock immediately; logged as adjustment.
6. **Return to warehouse** — damaged / slow-moving stock with a return note.
7. **Demo / trial stock** — separate non-sellable bucket per facility (move sellable ↔ demo).

Every movement is an append-only stock-ledger entry; stock on hand is derived from the ledger.

## Reports (v1)
- Stock on hand by facility (sellable + demo, valued at MRP/cost).
- Requested vs dispatched vs received (fill rate, pending, short/excess/damaged/substituted).
- Sales & consignment settlement: units sold × (MRP − partner margin %) per clinic per period.

## Tech
- Next.js (App Router) + Supabase (Postgres, Auth, Storage for photos), hosted on Vercel.
- Auth: email/password. Roles: admin/ops (all facilities), facility staff (own facility only, enforced via RLS).

## Open items
- Neuromatics tracking sheet (request / received columns) — awaiting access.
- Does STF ATP (Frido-owned store) get a PO / margin, or 0% and no settlement?
- Finance & warehouse email recipients.
- Frido legal entity details (GSTIN, address) for the PO PDF.
