-- Frido POS for clinics and retailers: tables, indexes and row-level security.
-- Decisions: docs/POS-DECISIONS.md. Design: docs/POS-DESIGN.md.
-- Every object is pos_-prefixed. Partner Hub tables, functions, triggers and policies are reused, never altered:
-- items, facilities, facility_assortment, stock_balances/stock_ledger and create_sale().

create extension if not exists pgcrypto with schema extensions;

-- ================================================================ seller (invoicing entity)
-- Decision 1: each facility invoices either as Frido (its GSTIN for that state) or as the clinic itself.
create table public.pos_entities (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  kind text not null check (kind in ('frido', 'partner')),
  legal_name text not null,
  trade_name text,
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_name text not null,
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  address text not null,
  pan text,
  cin text,
  upi_vpa text,                -- static UPI QR; an address, not a secret
  upi_payee_name text,
  razorpay_enabled boolean not null default false,  -- keys live in Edge Function secrets, keyed by code
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (gstin is null or left(gstin, 2) = state_code)
);

-- ================================================================ per-facility POS setup
create table public.pos_settings (
  facility_id bigint primary key references public.facilities (id) on delete cascade,
  entity_id bigint not null references public.pos_entities (id),
  is_enabled boolean not null default true,
  payment_modes text[] not null default '{cash,upi_static,card_edc}'
    check (cardinality(payment_modes) > 0
           and payment_modes <@ array['cash', 'upi_static', 'upi_razorpay', 'card_edc', 'bank_transfer']),
  cashier_max_disc_pct numeric(5,2) not null default 5 check (cashier_max_disc_pct between 0 and 100),
  manager_max_disc_pct numeric(5,2) not null default 10 check (manager_max_disc_pct between 0 and 100),
  return_days int not null default 10 check (return_days between 0 and 365),
  require_customer boolean not null default true,
  invoice_footer text,
  updated_at timestamptz not null default now(),
  check (manager_max_disc_pct >= cashier_max_disc_pct)
);
create index on public.pos_settings (entity_id);

-- Decision 11: SERIES/FY/n, e.g. NMB1/2627/000123. Codes are unique across all facilities so the number stays
-- unique per GSTIN even when several clinics share Frido's registration.
create table public.pos_series (
  code text primary key check (code ~ '^[A-Z0-9]{4}$'),
  facility_id bigint not null references public.facilities (id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice', 'credit_note')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index pos_series_one_active on public.pos_series (facility_id, doc_type) where is_active;

-- gap-free: the row is locked by the numbering transaction and the increment rolls back with it
create table public.pos_series_counters (
  series_code text not null references public.pos_series (code),
  fy text not null check (fy ~ '^[0-9]{4}$'),
  last_no int not null default 0 check (last_no between 0 and 999999),
  primary key (series_code, fy)
);

create table public.pos_registers (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id) on delete cascade,
  name text not null,
  printer text not null default 'thermal_80' check (printer in ('thermal_80', 'a4', 'none')),   -- Decision 5
  scan_mode text not null default 'both' check (scan_mode in ('hid', 'camera', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, name)
);

-- ================================================================ people
-- Named logins only (Lesson 6). The Hub profile says which facility; the POS role says what they may approve.
-- 'admin' rows are Frido approvers with no facility (discounts above the manager limit, late returns).
create table public.pos_staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  facility_id bigint references public.facilities (id) on delete cascade,
  pos_role text not null default 'cashier' check (pos_role in ('cashier', 'manager', 'admin')),
  display_name text not null,
  pin_hash text,
  pin_failed int not null default 0,
  pin_locked_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((pos_role = 'admin') = (facility_id is null))
);
create index on public.pos_staff (facility_id);

-- PIN switch at the till: a short-lived token naming who is selling right now
create table public.pos_staff_sessions (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  user_id uuid not null references public.pos_staff (user_id) on delete cascade,
  facility_id bigint not null references public.facilities (id) on delete cascade,
  register_id bigint references public.pos_registers (id) on delete cascade,
  device_user uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on public.pos_staff_sessions (user_id);
create index on public.pos_staff_sessions (facility_id);
create index on public.pos_staff_sessions (register_id);

create table public.pos_therapists (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id) on delete cascade,
  name text not null,
  kind text not null default 'therapist' check (kind in ('therapist', 'doctor')),
  phone text check (phone ~ '^[6-9][0-9]{9}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.pos_therapists (facility_id);

-- Customers are per facility: one clinic never sees another clinic's patients (DPDP).
create table public.pos_customers (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id) on delete cascade,
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  name text,
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),   -- null when not given, never a placeholder
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  company_name text,
  lead_source text check (lead_source in
    ('doctor_referral', 'walk_in', 'google', 'social_media', 'friends_family', 'frido_website', 'other')),
  marketing_consent boolean not null default false,   -- opt-in only (DPDP)
  consent_at timestamptz,
  consent_channel text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, phone),
  check (not marketing_consent or consent_at is not null)
);

-- non-stock lines (foot scan, fitting): sold and taxed, never posted to the Hub ledger
create table public.pos_service_skus (
  sku text primary key references public.items (sku),
  note text,
  created_at timestamptz not null default now()
);

-- ================================================================ shifts and cash (Lesson 7: cash must close)
create table public.pos_shifts (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  register_id bigint not null references public.pos_registers (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid not null references public.pos_staff (user_id),
  opened_at timestamptz not null default now(),
  opening_float numeric(12,2) not null check (opening_float >= 0),
  closed_by uuid references public.pos_staff (user_id),
  closed_at timestamptz,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2) check (counted_cash >= 0),
  variance numeric(12,2),
  close_note text,
  z_report jsonb,
  check ((status = 'closed') = (closed_at is not null))
);
create unique index pos_shifts_one_open on public.pos_shifts (register_id) where status = 'open';
create index on public.pos_shifts (facility_id, opened_at desc);
create index on public.pos_shifts (opened_by);
create index on public.pos_shifts (closed_by);

create table public.pos_cash_movements (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  shift_id bigint not null references public.pos_shifts (id),
  kind text not null check (kind in ('petty_cash', 'bank_deposit', 'cash_in')),
  category text,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  receipt_path text,
  staff_id uuid not null references public.pos_staff (user_id),
  created_at timestamptz not null default now()
);
create index on public.pos_cash_movements (shift_id);
create index on public.pos_cash_movements (facility_id, created_at desc);
create index on public.pos_cash_movements (staff_id);

-- ================================================================ discounts (Decision 6)
create table public.pos_discount_approvals (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  requested_by uuid not null references public.pos_staff (user_id),
  approver_id uuid not null references public.pos_staff (user_id),
  approver_level text not null check (approver_level in ('manager', 'admin')),
  approved_pct numeric(5,2) not null check (approved_pct between 0 and 100),
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on public.pos_discount_approvals (facility_id, created_at desc);
create index on public.pos_discount_approvals (requested_by);
create index on public.pos_discount_approvals (approver_id);

-- ================================================================ invoices
-- A number is issued only when the invoice is finalised (fully paid), so abandoned drafts leave no gaps.
create table public.pos_invoices (
  id bigint generated always as identity primary key,
  client_ref uuid not null unique,     -- idempotency key generated on the till
  facility_id bigint not null references public.facilities (id),
  register_id bigint not null references public.pos_registers (id),
  shift_id bigint not null references public.pos_shifts (id),
  entity_id bigint not null references public.pos_entities (id),
  status text not null check (status in ('awaiting_payment', 'paid', 'needs_attention', 'cancelled')),
  invoice_no text unique check (length(invoice_no) <= 16 and invoice_no ~ '^[A-Z0-9/-]+$'),
  series_code text references public.pos_series (code),
  fy text,
  seq int,
  invoiced_at timestamptz,
  seller_id uuid not null references public.pos_staff (user_id),
  therapist_id bigint references public.pos_therapists (id),
  customer_id bigint references public.pos_customers (id),
  customer_name text,
  customer_phone text,
  customer_gstin text,
  customer_company text,
  is_b2b boolean not null default false,
  is_new_customer boolean,
  lead_source text,
  supplier jsonb not null,             -- seller details frozen at sale time
  place_of_supply text not null,       -- state code
  intra_state boolean not null,
  cart_discount_kind text check (cart_discount_kind in ('pct', 'amount')),
  cart_discount_value numeric(12,2),
  gross_total numeric(12,2) not null,
  discount_total numeric(12,2) not null,
  taxable_total numeric(12,2) not null,
  cgst_total numeric(12,2) not null,
  sgst_total numeric(12,2) not null,
  igst_total numeric(12,2) not null,
  round_off numeric(12,2) not null,
  grand_total numeric(12,2) not null check (grand_total >= 0),
  max_disc_pct numeric(5,2) not null default 0,
  approval_id bigint references public.pos_discount_approvals (id),
  hub_sale_id bigint references public.sales (id),
  share_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  attention_reason text,
  notes text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (series_code, fy, seq),
  check ((invoice_no is null) = (status in ('awaiting_payment', 'cancelled')) or status = 'needs_attention')
);
create index on public.pos_invoices (facility_id, created_at desc);
create index on public.pos_invoices (facility_id, status) where status in ('awaiting_payment', 'needs_attention');
create index on public.pos_invoices (register_id);
create index on public.pos_invoices (shift_id);
create index on public.pos_invoices (entity_id);
create index on public.pos_invoices (seller_id);
create index on public.pos_invoices (therapist_id);
create index on public.pos_invoices (customer_id);
create index on public.pos_invoices (approval_id);
create index on public.pos_invoices (hub_sale_id);

create table public.pos_invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.pos_invoices (id) on delete cascade,
  line_no int not null,
  sku text not null references public.items (sku),
  item_name text not null,
  size text,
  color text,
  category_name text,
  hsn_code text not null,
  gst_pct numeric(5,2) not null,
  is_service boolean not null default false,
  bucket public.stock_bucket,          -- null for services
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null,   -- facility MSP, GST inclusive
  mrp numeric(12,2),                   -- printed only when it is a real MRP
  line_disc_kind text check (line_disc_kind in ('pct', 'amount')),
  line_disc_value numeric(12,2),
  line_discount numeric(12,2) not null default 0,
  cart_discount numeric(12,2) not null default 0,   -- pro-rated share of the cart discount
  disc_pct numeric(5,2) not null default 0,         -- effective discount on this line vs MSP
  net_amount numeric(12,2) not null,                -- GST inclusive, after discounts
  taxable numeric(12,2) not null,
  cgst numeric(12,2) not null default 0,
  sgst numeric(12,2) not null default 0,
  igst numeric(12,2) not null default 0,
  returned_qty int not null default 0,
  unique (invoice_id, line_no),
  check (returned_qty between 0 and qty),
  check (is_service = (bucket is null))
);
create index on public.pos_invoice_lines (sku);

-- ================================================================ credit notes, refunds (Decision 10)
create table public.pos_credit_notes (
  id bigint generated always as identity primary key,
  client_ref uuid not null unique,
  facility_id bigint not null references public.facilities (id),
  invoice_id bigint not null references public.pos_invoices (id),
  entity_id bigint not null references public.pos_entities (id),
  shift_id bigint references public.pos_shifts (id),
  credit_no text not null unique check (length(credit_no) <= 16 and credit_no ~ '^[A-Z0-9/-]+$'),
  series_code text not null references public.pos_series (code),
  fy text not null,
  seq int not null,
  issued_at timestamptz not null default now(),
  reason text not null,
  settlement text not null check (settlement in ('refund', 'exchange')),
  supplier jsonb not null,
  taxable_total numeric(12,2) not null,
  cgst_total numeric(12,2) not null,
  sgst_total numeric(12,2) not null,
  igst_total numeric(12,2) not null,
  grand_total numeric(12,2) not null check (grand_total > 0),
  redeemed_total numeric(12,2) not null default 0,   -- used as tender in an exchange sale
  refunded_total numeric(12,2) not null default 0,
  staff_id uuid not null references public.pos_staff (user_id),
  late_override_by uuid references public.pos_staff (user_id),
  share_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (series_code, fy, seq),
  check (redeemed_total >= 0 and refunded_total >= 0 and redeemed_total + refunded_total <= grand_total)
);
create index on public.pos_credit_notes (facility_id, issued_at desc);
create index on public.pos_credit_notes (invoice_id);
create index on public.pos_credit_notes (entity_id);
create index on public.pos_credit_notes (shift_id);
create index on public.pos_credit_notes (staff_id);
create index on public.pos_credit_notes (late_override_by);

create table public.pos_credit_note_lines (
  id bigint generated always as identity primary key,
  credit_note_id bigint not null references public.pos_credit_notes (id) on delete cascade,
  invoice_line_id bigint not null references public.pos_invoice_lines (id),
  sku text not null references public.items (sku),
  qty int not null check (qty > 0),
  restock_bucket public.stock_bucket check (restock_bucket in ('sellable', 'damaged')),  -- null for services
  net_amount numeric(12,2) not null,
  taxable numeric(12,2) not null,
  cgst numeric(12,2) not null default 0,
  sgst numeric(12,2) not null default 0,
  igst numeric(12,2) not null default 0
);
create index on public.pos_credit_note_lines (credit_note_id);
create index on public.pos_credit_note_lines (invoice_line_id);
create index on public.pos_credit_note_lines (sku);

-- refunds are paid online by the invoicing entity and closed with the UTR; no cash leaves the till
create table public.pos_refunds (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  entity_id bigint not null references public.pos_entities (id),
  credit_note_id bigint not null references public.pos_credit_notes (id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('razorpay_api', 'upi', 'bank_transfer')),
  payee_vpa text,
  payee_account jsonb,     -- {name, account_no, ifsc}
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  utr text,
  note text,
  paid_by uuid references auth.users (id),
  paid_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (method <> 'upi' or payee_vpa is not null),
  check (method <> 'bank_transfer' or payee_account is not null),
  check (status <> 'paid' or utr is not null)
);
create index on public.pos_refunds (facility_id, status);
create index on public.pos_refunds (entity_id, status);
create index on public.pos_refunds (credit_note_id);
create index on public.pos_refunds (paid_by);

-- ================================================================ payments (Decision 4)
create table public.pos_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.pos_invoices (id) on delete cascade,
  facility_id bigint not null references public.facilities (id),
  shift_id bigint not null references public.pos_shifts (id),
  mode text not null check (mode in ('cash', 'upi_static', 'upi_razorpay', 'card_edc', 'bank_transfer', 'credit_note')),
  amount numeric(12,2) not null check (amount > 0),
  tendered numeric(12,2),            -- cash handed over; change = tendered - amount
  status text not null check (status in ('pending', 'confirmed', 'failed', 'cancelled')),
  reference text,                    -- UTR, RRN / approval code, or credit note number
  gateway_ref text unique,           -- Razorpay QR id
  gateway_payment_id text unique,    -- Razorpay payment id
  credit_note_id bigint references public.pos_credit_notes (id),
  taken_by uuid not null references public.pos_staff (user_id),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check (mode <> 'credit_note' or credit_note_id is not null),
  check (tendered is null or (mode = 'cash' and tendered >= amount))
);
create index on public.pos_payments (invoice_id);
create index on public.pos_payments (facility_id, created_at desc);
create index on public.pos_payments (shift_id);
create index on public.pos_payments (credit_note_id);
create index on public.pos_payments (taken_by);
create index on public.pos_payments (confirmed_by);

-- ================================================================ connectivity (Decision 7)
create table public.pos_connectivity_log (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  register_id bigint references public.pos_registers (id),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  context text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index on public.pos_connectivity_log (facility_id, started_at desc);
create index on public.pos_connectivity_log (register_id);

-- ================================================================ role helpers
-- Is the signed-in user a POS manager at this facility? (Frido ops/admin count as managers everywhere.)
create or replace function public.pos_is_manager(p_facility_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ops() or exists (
    select 1 from public.pos_staff s
    where s.user_id = (select auth.uid()) and s.facility_id = p_facility_id and s.pos_role = 'manager' and s.is_active
  )
$$;

-- ================================================================ RLS
alter table public.pos_entities enable row level security;
alter table public.pos_settings enable row level security;
alter table public.pos_series enable row level security;
alter table public.pos_series_counters enable row level security;
alter table public.pos_registers enable row level security;
alter table public.pos_staff enable row level security;
alter table public.pos_staff_sessions enable row level security;
alter table public.pos_therapists enable row level security;
alter table public.pos_customers enable row level security;
alter table public.pos_service_skus enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_discount_approvals enable row level security;
alter table public.pos_invoices enable row level security;
alter table public.pos_invoice_lines enable row level security;
alter table public.pos_credit_notes enable row level security;
alter table public.pos_credit_note_lines enable row level security;
alter table public.pos_refunds enable row level security;
alter table public.pos_payments enable row level security;
alter table public.pos_connectivity_log enable row level security;

-- nothing here is for signed-out visitors; the public invoice link goes through pos_public_document()
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'pos\_%' loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- setup: readable by the facility, written by Frido ops
create policy "pos read entities" on public.pos_entities for select to authenticated
  using ((select public.is_ops()) or exists (
    select 1 from public.pos_settings s where s.entity_id = pos_entities.id and public.can_access_facility(s.facility_id)));
create policy "pos ops insert entities" on public.pos_entities for insert to authenticated with check ((select public.is_ops()));
create policy "pos ops update entities" on public.pos_entities for update to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "pos read settings" on public.pos_settings for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos ops insert settings" on public.pos_settings for insert to authenticated with check ((select public.is_ops()));
create policy "pos ops update settings" on public.pos_settings for update to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "pos read series" on public.pos_series for select to authenticated
  using (public.can_access_facility(facility_id));

create policy "pos ops read counters" on public.pos_series_counters for select to authenticated
  using ((select public.is_ops()));

create policy "pos read registers" on public.pos_registers for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos ops insert registers" on public.pos_registers for insert to authenticated with check ((select public.is_ops()));
create policy "pos ops update registers" on public.pos_registers for update to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

-- staff list is visible to the facility; PIN hashes are not (column privileges below)
create policy "pos read staff" on public.pos_staff for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_ops())
         or (facility_id is not null and public.can_access_facility(facility_id)));
revoke all on table public.pos_staff from authenticated;
grant select (user_id, facility_id, pos_role, display_name, is_active, created_at) on public.pos_staff to authenticated;
revoke all on table public.pos_staff_sessions from authenticated;
revoke all on table public.pos_series_counters from authenticated;
grant select on public.pos_series_counters to authenticated;

-- therapists: the clinic manager keeps the list
create policy "pos read therapists" on public.pos_therapists for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos manager insert therapists" on public.pos_therapists for insert to authenticated
  with check (public.pos_is_manager(facility_id));
create policy "pos manager update therapists" on public.pos_therapists for update to authenticated
  using (public.pos_is_manager(facility_id)) with check (public.pos_is_manager(facility_id));

create policy "pos read service skus" on public.pos_service_skus for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "pos ops insert service skus" on public.pos_service_skus for insert to authenticated with check ((select public.is_ops()));
create policy "pos ops delete service skus" on public.pos_service_skus for delete to authenticated using ((select public.is_ops()));

-- transactions: read by the facility (and Frido ops); written only through the pos_* functions
create policy "pos read customers" on public.pos_customers for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read shifts" on public.pos_shifts for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read cash movements" on public.pos_cash_movements for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read approvals" on public.pos_discount_approvals for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read invoices" on public.pos_invoices for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read invoice lines" on public.pos_invoice_lines for select to authenticated
  using (exists (select 1 from public.pos_invoices i where i.id = invoice_id and public.can_access_facility(i.facility_id)));
create policy "pos read payments" on public.pos_payments for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read credit notes" on public.pos_credit_notes for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read credit note lines" on public.pos_credit_note_lines for select to authenticated
  using (exists (select 1 from public.pos_credit_notes c where c.id = credit_note_id and public.can_access_facility(c.facility_id)));
create policy "pos read refunds" on public.pos_refunds for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "pos read connectivity" on public.pos_connectivity_log for select to authenticated
  using (public.can_access_facility(facility_id));

revoke execute on function public.pos_is_manager(bigint) from public, anon;
grant execute on function public.pos_is_manager(bigint) to authenticated;
