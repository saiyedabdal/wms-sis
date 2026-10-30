-- Frido WMS: core schema
-- Stock is tracked per facility + SKU + bucket. Every movement is a row in stock_ledger;
-- stock_balances is maintained from the ledger by trigger.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- enums
create type public.facility_type as enum ('warehouse', 'partner_clinic', 'internal');
create type public.user_role as enum ('admin', 'ops', 'facility_staff');
-- sellable = display/sale, display = display only, in_use = used by the facility (e.g. wheelchair in therapy),
-- damaged = received damaged / pending return
create type public.stock_bucket as enum ('sellable', 'display', 'in_use', 'damaged');
create type public.movement_type as enum (
  'receipt', 'sale', 'count_adjustment', 'bucket_transfer', 'issue', 'return_to_wh'
);
create type public.request_status as enum (
  'raised', 'partially_dispatched', 'dispatched', 'received', 'closed', 'cancelled'
);
create type public.shipment_status as enum ('in_transit', 'received');
create type public.discrepancy_reason as enum ('ok', 'short', 'excess', 'damaged', 'wrong_sku');
create type public.issue_purpose as enum ('training', 'demo', 'sample', 'internal_use', 'lost', 'scrapped');

-- ---------------------------------------------------------------- facilities & users
create table public.facilities (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9-]{2,12}$'),
  name text not null,
  type public.facility_type not null,
  legal_name text,
  gstin text,
  address text,
  city text,
  state text,
  pincode text,
  contact_name text,
  contact_phone text,
  contact_email text,
  default_margin_pct numeric(5,2) not null default 0 check (default_margin_pct between 0 and 100),
  is_consignment boolean not null default false,
  restrict_to_assortment boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'facility_staff',
  facility_id bigint references public.facilities (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.profiles (facility_id);

-- ---------------------------------------------------------------- item master (Uniware)
create table public.item_imports (
  id bigint generated always as identity primary key,
  file_name text,
  total_rows int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  disabled int not null default 0,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.items (
  sku text primary key,
  name text not null,
  description text,
  category_code text,
  category_name text,
  sub_category text,
  brand text,
  color text,
  size text,
  scan_identifier text,
  ean text,
  hsn_code text,
  gst_pct numeric(5,2),
  base_price numeric(12,2),
  cost_price numeric(12,2),
  mrp numeric(12,2),
  item_type text not null default 'SIMPLE',
  enabled boolean not null default true,
  image_url text,
  product_url text,
  length_mm numeric, width_mm numeric, height_mm numeric, weight_g numeric,
  uniware_updated_at timestamptz,
  last_import_id bigint references public.item_imports (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_scan_identifier_idx on public.items (scan_identifier);
create index items_ean_idx on public.items (ean) where ean is not null;
create index items_category_idx on public.items (category_name);
create index items_search_idx on public.items using gin ((sku || ' ' || name) extensions.gin_trgm_ops);

create table public.bundle_components (
  bundle_sku text not null references public.items (sku) on delete cascade,
  component_sku text not null,
  qty numeric not null default 1,
  price numeric(12,2),
  primary key (bundle_sku, component_sku)
);

-- ---------------------------------------------------------------- facility commercial setup
-- Margin per facility per item category (e.g. Neuromatics: Orthotics 30%, Mobility 10%)
create table public.facility_category_margins (
  facility_id bigint not null references public.facilities (id) on delete cascade,
  category_name text not null,
  margin_pct numeric(5,2) not null check (margin_pct between 0 and 100),
  primary key (facility_id, category_name)
);

-- Curated assortment: the SKUs a facility may request / sell, with optional price & margin overrides
create table public.facility_assortment (
  facility_id bigint not null references public.facilities (id) on delete cascade,
  sku text not null references public.items (sku),
  default_bucket public.stock_bucket not null default 'sellable',
  msp numeric(12,2),            -- selling price used for PO / settlement; null = item MRP
  margin_pct numeric(5,2) check (margin_pct between 0 and 100), -- null = category / facility default
  min_qty int not null default 0 check (min_qty >= 0),
  max_qty int not null default 0 check (max_qty >= 0),
  is_active boolean not null default true,
  added_at timestamptz not null default now(),
  primary key (facility_id, sku)
);
create index on public.facility_assortment (sku);

-- ---------------------------------------------------------------- document numbers
create table public.doc_counters (
  prefix text not null,
  period text not null,
  last_no int not null default 0,
  primary key (prefix, period)
);

create or replace function public.next_doc_no(p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Kolkata', 'YYMM');
  v_no int;
begin
  insert into public.doc_counters as c (prefix, period, last_no)
  values (p_prefix, v_period, 1)
  on conflict (prefix, period) do update set last_no = c.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || v_period || '-' || lpad(v_no::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------- order requests & POs
create table public.order_requests (
  id bigint generated always as identity primary key,
  request_no text not null unique,
  po_no text not null unique,
  facility_id bigint not null references public.facilities (id),
  warehouse_id bigint references public.facilities (id),
  status public.request_status not null default 'raised',
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.order_requests (facility_id, created_at desc);
create index on public.order_requests (warehouse_id);

create table public.order_request_lines (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.order_requests (id) on delete cascade,
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null default 'sellable',
  qty int not null check (qty > 0),
  msp numeric(12,2) not null default 0,
  margin_pct numeric(5,2) not null default 0,
  gst_pct numeric(5,2) not null default 18,
  -- price to facility incl. GST = MSP less margin; taxable/GST split from it
  unit_price numeric(12,2) generated always as (round(msp * (1 - margin_pct / 100), 2)) stored,
  notes text,
  unique (request_id, sku, bucket)
);
create index on public.order_request_lines (sku);

-- ---------------------------------------------------------------- dispatches (entered from Uniware)
create table public.shipments (
  id bigint generated always as identity primary key,
  shipment_no text not null unique,
  request_id bigint not null references public.order_requests (id),
  facility_id bigint not null references public.facilities (id),
  status public.shipment_status not null default 'in_transit',
  dispatched_at date not null default current_date,
  uniware_ref text,       -- STO / gate pass / B2B invoice number in Uniware
  invoice_no text,
  dc_no text,
  dn_no text,
  carton_count int check (carton_count >= 0),
  courier text,
  awb_no text,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.shipments (request_id);
create index on public.shipments (facility_id, status);

create table public.shipment_lines (
  id bigint generated always as identity primary key,
  shipment_id bigint not null references public.shipments (id) on delete cascade,
  request_line_id bigint references public.order_request_lines (id),  -- null = not requested (extra)
  sku text not null references public.items (sku),
  qty int not null check (qty > 0),
  is_substitute boolean not null default false
);
create index on public.shipment_lines (shipment_id);
create index on public.shipment_lines (request_line_id);

-- ---------------------------------------------------------------- receipts (GRN)
create table public.grns (
  id bigint generated always as identity primary key,
  grn_no text not null unique,
  shipment_id bigint not null unique references public.shipments (id),
  facility_id bigint not null references public.facilities (id),
  dn_no text,
  invoice_no text,
  dc_no text,
  gate_pass_no text,
  cartons_received int check (cartons_received >= 0),
  notes text,
  has_discrepancy boolean not null default false,
  received_by uuid references auth.users (id) default auth.uid(),
  received_at timestamptz not null default now()
);
create index on public.grns (facility_id, received_at desc);

create table public.grn_lines (
  id bigint generated always as identity primary key,
  grn_id bigint not null references public.grns (id) on delete cascade,
  shipment_line_id bigint references public.shipment_lines (id),
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null default 'sellable',
  expected_qty int not null default 0 check (expected_qty >= 0),
  received_qty int not null default 0 check (received_qty >= 0),  -- good units
  damaged_qty int not null default 0 check (damaged_qty >= 0),
  reason public.discrepancy_reason not null default 'ok',
  notes text
);
create index on public.grn_lines (grn_id);
create index on public.grn_lines (shipment_line_id);

create table public.grn_photos (
  id bigint generated always as identity primary key,
  grn_id bigint not null references public.grns (id) on delete cascade,
  grn_line_id bigint references public.grn_lines (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index on public.grn_photos (grn_id);
create index on public.grn_photos (grn_line_id);

-- ---------------------------------------------------------------- sales (consignment)
create table public.sales (
  id bigint generated always as identity primary key,
  sale_no text not null unique,
  facility_id bigint not null references public.facilities (id),
  customer_name text,
  customer_phone text,
  bill_ref text,
  notes text,
  sold_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid()
);
create index on public.sales (facility_id, sold_at desc);

create table public.sale_lines (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales (id) on delete cascade,
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null default 'sellable',
  qty int not null check (qty > 0),
  msp numeric(12,2) not null default 0,
  margin_pct numeric(5,2) not null default 0,
  gst_pct numeric(5,2) not null default 18,
  payable_unit numeric(12,2) generated always as (round(msp * (1 - margin_pct / 100), 2)) stored
);
create index on public.sale_lines (sale_id);
create index on public.sale_lines (sku);

-- ---------------------------------------------------------------- stock counts
create table public.stock_counts (
  id bigint generated always as identity primary key,
  count_no text not null unique,
  facility_id bigint not null references public.facilities (id),
  notes text,
  counted_by uuid references auth.users (id) default auth.uid(),
  posted_at timestamptz not null default now()
);
create index on public.stock_counts (facility_id, posted_at desc);

create table public.stock_count_lines (
  id bigint generated always as identity primary key,
  count_id bigint not null references public.stock_counts (id) on delete cascade,
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null,
  system_qty int not null,
  counted_qty int not null check (counted_qty >= 0),
  variance int generated always as (counted_qty - system_qty) stored
);
create index on public.stock_count_lines (count_id);

-- ---------------------------------------------------------------- returns to warehouse
create table public.wh_returns (
  id bigint generated always as identity primary key,
  return_no text not null unique,
  facility_id bigint not null references public.facilities (id),
  warehouse_id bigint references public.facilities (id),
  courier text,
  awb_no text,
  carton_count int,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.wh_returns (facility_id, created_at desc);
create index on public.wh_returns (warehouse_id);

create table public.wh_return_lines (
  id bigint generated always as identity primary key,
  return_id bigint not null references public.wh_returns (id) on delete cascade,
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null,
  qty int not null check (qty > 0),
  reason text
);
create index on public.wh_return_lines (return_id);

-- ---------------------------------------------------------------- issues (training / demo / samples)
create table public.stock_issues (
  id bigint generated always as identity primary key,
  issue_no text not null unique,
  facility_id bigint not null references public.facilities (id),
  purpose public.issue_purpose not null,
  issued_to text,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_issues (facility_id, created_at desc);

create table public.stock_issue_lines (
  id bigint generated always as identity primary key,
  issue_id bigint not null references public.stock_issues (id) on delete cascade,
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null,
  qty int not null check (qty > 0)
);
create index on public.stock_issue_lines (issue_id);

-- ---------------------------------------------------------------- ledger & balances
create table public.stock_ledger (
  id bigint generated always as identity primary key,
  facility_id bigint not null references public.facilities (id),
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null,
  qty_delta int not null check (qty_delta <> 0),
  movement public.movement_type not null,
  ref_type text not null,
  ref_id bigint,
  ref_no text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_ledger (facility_id, sku, created_at desc);
create index on public.stock_ledger (ref_type, ref_id);
create index on public.stock_ledger (sku);

create table public.stock_balances (
  facility_id bigint not null references public.facilities (id),
  sku text not null references public.items (sku),
  bucket public.stock_bucket not null,
  qty int not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (facility_id, sku, bucket)
);
create index on public.stock_balances (sku);

create or replace function public.apply_ledger_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stock_balances as b (facility_id, sku, bucket, qty)
  values (new.facility_id, new.sku, new.bucket, new.qty_delta)
  on conflict (facility_id, sku, bucket)
  do update set qty = b.qty + excluded.qty, updated_at = now();
  return new;
exception when check_violation then
  raise exception 'Insufficient stock for % (%) at facility %', new.sku, new.bucket, new.facility_id;
end;
$$;

create trigger stock_ledger_apply
after insert on public.stock_ledger
for each row execute function public.apply_ledger_to_balance();
