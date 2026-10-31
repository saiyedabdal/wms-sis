# Frido Partner Hub — v2 design

Builds on v1 (`docs/SPEC.md`). Source: the WMS flow agreed with the manager (30 Oct 2026) plus the Q&A that followed.
The portal is renamed **Frido Partner Hub**.

## 1. The network

```
                 ┌────────────── direct ──────────────┐
 Frido WH ──▶ Super Stockist (SS) ──▶ Retailer (clinic) ──▶ patient (outward)
 (Uniware)     logs in, holds stock    logs in, sells
```

| Node | In the Hub | Stock tracked | Owner of stock |
|---|---|---|---|
| Frido WH | facility `warehouse`; dispatch entered by Frido ops from Uniware | no (Uniware is the source) | Frido |
| Super Stockist | facility `super_stockist`; SS staff log in, receive, dispatch, return | yes | **Frido (consignment)** |
| Retailer | facility `retailer` (was `partner_clinic`); staff log in | yes | **Frido (consignment)**, settled on sale |
| STF store | facility `internal` | yes | Frido |

Because stock is Frido-owned at every node, the v1 ledger model holds: one append-only ledger, balances per facility × SKU × bucket.
Planned scale: 10–50 retailers, 1–3 SS in six months, so lists need region/ops filters and approvals need queues.

## 2. Product lifecycle (the left nav follows these steps)

| # | Step | Who | What the Hub does |
|---|---|---|---|
| 1 | **Inward** | Retailer / SS | All shipments view → scan to receive. During receiving: **reject at the door** (damaged / wrong units never enter stock; a return to the fulfiller is created on the spot). After posting: shortcuts to **Return** and **Issue** pre-filled with the shipment. Units that were never requested or dispatched go to a **Quarantine** bucket. |
| 2 | **Inward analytics** | Frido | Product-, value-, qty-, category-wise inward; **time between two inwards** per retailer; **time taken for inward** (request → approval → dispatch → received, per fulfiller); within-ambit (requested) vs outside-ambit (substitutes, extras, wrong SKU) and how the outside-ambit units were resolved. |
| 3 | **Outward** | Retailer | Four channels: **API** (clinic's own POS, per-retailer key), **Shopify POS** (clinics we equip), **manual marking** (scan units sold), **manual transaction** (full bill: customer, price charged, payment mode, bill no.). One primary channel per retailer to avoid double counting. |
| 4 | **Reconciliation** | Retailer | Open stock count, auto-adjusts (unchanged from v1); variance report so shrinkage stays visible. |
| 5 | **Demand planning** | System + retailer | Weekly scheduled drafts for every retailer and SS, plus ad-hoc requests raised by retailers (pre-filled). Retailer demand rolls up into SS demand; network demand rolls up into a Frido view. |
| 6 | **Approval** | Assigned ops → manager | The ops person assigned to the facility reviews and edits, submits; the **manager approves in-app**. |
| 7 | **Execution** | System → SS / Frido WH | On approval each line is **auto-routed**: the retailer's mapped SS fulfils what it has (after reservations); the remainder goes to Frido WH. One request can become two fulfilment orders. |
| 8 | **Tracking** | Everyone | Timeline: Requested → Approved → Routed → Dispatched (courier + AWB, link to courier tracking) → Delivered → Received → Closed. |

Modules alongside the flow: **Return**, **Issue**, **Categorisation** (Frido category tree).
Admin views: retailer-wise inward, stock, outward. **Retailer Center**: inward (all shipments, scanning) as the retailer's home.

## 3. Demand planning logic

Per facility × SKU:

```
velocity     = units sold over the last 30 days ÷ days in stock (stock-out days excluded)
lead_time    = measured average request→received days for this facility's fulfiller (from step 2 analytics; default 7)
target       = velocity × (lead_time + review_days + safety_days) × season_factor(category, month)
suggested    = clamp(target, min_qty, max_qty) − on_hand − in_transit − pending_approval   (≥ 0, rounded to pack size)
```

- **Seasonality:** there's no sales history yet, so Frido sets factors per category × month by hand (default 1.0). Once ~12 months of outward exist, factors are computed from history and shown next to the manual ones.
- **SS demand** = Σ forecast of its retailers + SS buffer days − SS on hand − SS in transit → a replenishment request from the SS to Frido WH, through the same approval.
- **Frido view** = network-wide demand vs Frido WH stock (Uniware export) for purchasing/production planning (report only).
- Drafts are generated weekly by a scheduled database job; retailers can also raise "Request stock" any time with suggestions pre-filled.

## 4. Approval and routing

- Each facility has one or more **assigned ops** users; the approval queue is filtered to "my facilities".
- New role **manager**: sees requests submitted by ops and approves/rejects in-app (notification badge + email). Ops can't approve their own submissions.
- **Routing on approval:** for each line, allocate from the mapped SS's available stock (sellable − reserved by other approved orders); the remainder goes to Frido WH. Allocation creates **reservations** so two retailers can't be promised the same SS units. SS dispatch moves stock out of the SS immediately (in transit) and into the retailer on GRN; shortages found at GRN are recorded against that dispatch.

## 5. Data model changes (on top of v1)

- `facilities.type`: add `super_stockist`, rename `partner_clinic` → `retailer`; `facilities.region`; `facilities.fulfiller_ss_id`; `facilities.outward_channel`.
- `facility_ops` (facility ↔ assigned ops users); role `manager` in `user_role`.
- `order_requests`: statuses `draft → submitted → approved/rejected → routed → … → closed`; `source` (`schedule` / `retailer` / `ops`); `submitted_by`, `approved_by`, timestamps per stage.
- `fulfilment_orders` (request × fulfiller) + `reservations`; `shipments` hang off fulfilment orders and gain `awb_no`/`courier` tracking URL and `delivered_at`.
- Buckets: add `quarantine` (and `in_transit` handled as ledger rows on SS dispatch).
- GRN lines: `rejected_qty` → auto `wh_returns`/SS return.
- `sales`: `channel` (`api` / `shopify` / `marking` / `bill`), `external_ref` (idempotency), `price_charged`, `payment_mode`.
- `frido_categories` (tree) + `category_map` (Uniware category/sub-category → Frido category); margins and analytics move to Frido categories.
- `season_factors` (category × month); `demand_runs` / `demand_lines` (what the engine suggested vs what was approved, for learning).
- Edge Functions: `outward-api` (per-retailer key, idempotent), `shopify-pos-webhook` (location → retailer), `admin-create-user` (exists).

## 6. Phasing

1. **Flow (Phase 1):** rename, lifecycle nav, SS facility type + SS users, assigned ops + manager approval, request statuses, weekly drafts + retailer requests (velocity + manual seasonality), auto-routing with reservations, SS dispatch, tracking timeline with AWB, quarantine, reject-at-door, return/issue shortcuts.
2. **Visibility (Phase 2):** inward analytics (step 2), admin retailer-wise inward/stock/outward, variance report.
3. **Integrations (Phase 3):** outward API + CSV, Shopify POS, manual transaction (full bill), Frido category tree, learned seasonality.

## Decisions taken (Q&A, 30 Oct 2026)

SS = Super Stockist · SS is a full user with tracked stock · routing: SS stock first, fallback Frido WH · stock at SS is Frido consignment · demand: scheduled drafts + retailer requests · planning: velocity + seasonality · approval: assigned ops edits, manager approves in-app · outward: own POS via API for some, Frido Shopify POS for others · marking = scan sold, transaction = full bill · outside-ambit units: quarantine, Frido decides · at inward: reject at the door + shortcuts · reconciliation: open count, auto-adjust · nav: lifecycle steps · categorisation: Frido's own category tree · scale: 10–50 retailers, 1–3 SS · name: Frido Partner Hub · tracking: timeline + AWB link · build order: flow first.

## Open points

- Mapping retailers → SS (by region? named per retailer?) and SS buffer days.
- Who the manager(s) are, and whether one manager approves all facilities.
- Shopify: one store with a POS location per clinic? (needed for the webhook mapping)
- Couriers in use (to build AWB tracking links).
