-- Frido Partner Hub (v2) core: super stockists, approval workflow, fulfilment routing,
-- reject-at-door + quarantine, returns to a facility, demand planning.
-- Design: docs/SPEC-v2-partner-hub.md

-- ================================================================ roles
-- the manager is Frido-side like ops, and additionally approves requests
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('admin', 'ops', 'manager'), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('admin', 'manager'), false)
$$;

-- ================================================================ facilities
-- codes follow the POS Store ID (e.g. FRIDO_0005)
alter table public.facilities drop constraint facilities_code_check;
alter table public.facilities add constraint facilities_code_check check (code ~ '^[A-Z0-9_-]{2,20}$');

alter table public.facilities
  add column region text,
  add column fulfiller_ss_id bigint references public.facilities (id),
  add column pos_location text,
  add column planning_enabled boolean not null default true,
  add column review_days int not null default 7 check (review_days between 0 and 90),
  add column safety_days int not null default 7 check (safety_days between 0 and 90),
  add column lead_time_days int not null default 7 check (lead_time_days between 1 and 90);
create index on public.facilities (fulfiller_ss_id);
update public.facilities set planning_enabled = false where type in ('warehouse', 'internal');

-- Frido ops person(s) responsible for a facility (their review queue)
create table public.facility_ops (
  facility_id bigint not null references public.facilities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (facility_id, user_id)
);
create index on public.facility_ops (user_id);

-- ================================================================ demand planning tables
create table public.season_factors (
  category_name text not null,
  month int not null check (month between 1 and 12),
  factor numeric(5,2) not null default 1 check (factor > 0 and factor <= 10),
  primary key (category_name, month)
);

create table public.demand_runs (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  run_by uuid references auth.users (id),
  facilities_planned int not null default 0,
  drafts_created int not null default 0,
  lines_suggested int not null default 0
);

-- ================================================================ requests: approval workflow
alter table public.order_requests alter column status set default 'draft';
-- the PO number is assigned on approval
alter table public.order_requests alter column po_no drop not null;
alter table public.order_requests
  add column source text not null default 'ops' check (source in ('schedule', 'retailer', 'ops')),
  add column submitted_by uuid references auth.users (id),
  add column submitted_at timestamptz,
  add column sent_for_approval_by uuid references auth.users (id),
  add column sent_for_approval_at timestamptz,
  add column decided_by uuid references auth.users (id),
  add column decided_at timestamptz,
  add column decision_note text,
  add column lines_edited_at timestamptz,
  add column demand_run_id bigint references public.demand_runs (id);
create index on public.order_requests (status);
create index on public.order_requests (demand_run_id);
alter table public.order_request_lines add column suggested_qty int;

-- ================================================================ fulfilment orders (request x fulfiller)
create type public.fo_status as enum ('open', 'partially_dispatched', 'dispatched', 'closed', 'cancelled');

create table public.fulfilment_orders (
  id bigint generated always as identity primary key,
  fo_no text not null unique,
  request_id bigint not null references public.order_requests (id) on delete cascade,
  fulfiller_id bigint not null references public.facilities (id),
  facility_id bigint not null references public.facilities (id),
  status public.fo_status not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.fulfilment_orders (request_id);
create index on public.fulfilment_orders (fulfiller_id, status);
create index on public.fulfilment_orders (facility_id);

create table public.fulfilment_order_lines (
  id bigint generated always as identity primary key,
  fo_id bigint not null references public.fulfilment_orders (id) on delete cascade,
  request_line_id bigint references public.order_request_lines (id),
  sku text not null references public.items (sku),
  qty int not null check (qty > 0)
);
create index on public.fulfilment_order_lines (fo_id);
create index on public.fulfilment_order_lines (request_line_id);
create index on public.fulfilment_order_lines (sku);

alter table public.shipments
  add column fulfilment_order_id bigint references public.fulfilment_orders (id),
  add column from_facility_id bigint references public.facilities (id),
  add column delivered_at timestamptz;
create index on public.shipments (fulfilment_order_id);
create index on public.shipments (from_facility_id, created_at desc);

alter table public.shipment_lines add column fo_line_id bigint references public.fulfilment_order_lines (id);
create index on public.shipment_lines (fo_line_id);

-- ================================================================ inward: reject at the door, quarantine
alter table public.grn_lines
  add column rejected_qty int not null default 0 check (rejected_qty >= 0),
  add column quarantine_qty int not null default 0 check (quarantine_qty >= 0);

-- returns go to any fulfiller (Frido WH or a super stockist), which receives them
alter table public.wh_returns rename column warehouse_id to to_facility_id;
alter table public.wh_returns
  add column origin text not null default 'stock' check (origin in ('stock', 'rejected_at_inward', 'quarantine')),
  add column status text not null default 'in_transit' check (status in ('in_transit', 'received')),
  add column grn_id bigint references public.grns (id),
  add column received_at timestamptz,
  add column received_by uuid references auth.users (id);
create index on public.wh_returns (to_facility_id, status);
create index on public.wh_returns (grn_id);

-- quarantined stock is Frido's call: only ops can take units out of it
create or replace function public.apply_ledger_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket = 'quarantine' and new.qty_delta < 0 and not public.is_ops() then
    raise exception 'Quarantined stock can only be released by Frido ops' using errcode = '42501';
  end if;
  if new.qty_delta > 0 then
    insert into public.stock_balances as b (facility_id, sku, bucket, qty)
    values (new.facility_id, new.sku, new.bucket, new.qty_delta)
    on conflict (facility_id, sku, bucket)
    do update set qty = b.qty + excluded.qty, updated_at = now();
  else
    update public.stock_balances
    set qty = qty + new.qty_delta, updated_at = now()
    where facility_id = new.facility_id and sku = new.sku and bucket = new.bucket;
    if not found then
      raise check_violation;
    end if;
  end if;
  return new;
exception when check_violation then
  raise exception 'Insufficient stock for % (%) at facility %', new.sku, new.bucket, new.facility_id;
end;
$$;

-- ================================================================ RLS
alter table public.facility_ops enable row level security;
alter table public.season_factors enable row level security;
alter table public.demand_runs enable row level security;
alter table public.fulfilment_orders enable row level security;
alter table public.fulfilment_order_lines enable row level security;

create policy "read facility ops" on public.facility_ops for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "ops write facility ops" on public.facility_ops for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "read season factors" on public.season_factors for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "ops write season factors" on public.season_factors for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "ops read demand runs" on public.demand_runs for select to authenticated
  using ((select public.is_ops()));

-- a fulfilment order is visible to the destination and to the fulfiller
create policy "read fulfilment orders" on public.fulfilment_orders for select to authenticated
  using (public.can_access_facility(facility_id) or public.can_access_facility(fulfiller_id));
create policy "read fulfilment order lines" on public.fulfilment_order_lines for select to authenticated
  using (exists (
    select 1 from public.fulfilment_orders fo
    where fo.id = fo_id and (public.can_access_facility(fo.facility_id) or public.can_access_facility(fo.fulfiller_id))
  ));

-- a super stockist sees the requests, shipments, receipts and returns it is part of
drop policy "read requests" on public.order_requests;
create policy "read requests" on public.order_requests for select to authenticated
  using (
    public.can_access_facility(facility_id)
    or exists (select 1 from public.fulfilment_orders fo
               where fo.request_id = order_requests.id and public.can_access_facility(fo.fulfiller_id))
  );
drop policy "read request lines" on public.order_request_lines;
create policy "read request lines" on public.order_request_lines for select to authenticated
  using (exists (
    select 1 from public.order_requests r
    where r.id = request_id
      and (public.can_access_facility(r.facility_id)
           or exists (select 1 from public.fulfilment_orders fo
                      where fo.request_id = r.id and public.can_access_facility(fo.fulfiller_id)))
  ));

drop policy "read shipments" on public.shipments;
create policy "read shipments" on public.shipments for select to authenticated
  using (public.can_access_facility(facility_id) or public.can_access_facility(from_facility_id));
drop policy "read shipment lines" on public.shipment_lines;
create policy "read shipment lines" on public.shipment_lines for select to authenticated
  using (exists (
    select 1 from public.shipments s
    where s.id = shipment_id and (public.can_access_facility(s.facility_id) or public.can_access_facility(s.from_facility_id))
  ));

drop policy "read grns" on public.grns;
create policy "read grns" on public.grns for select to authenticated
  using (
    public.can_access_facility(facility_id)
    or exists (select 1 from public.shipments s where s.id = grns.shipment_id and public.can_access_facility(s.from_facility_id))
  );
drop policy "read grn lines" on public.grn_lines;
create policy "read grn lines" on public.grn_lines for select to authenticated
  using (exists (
    select 1 from public.grns g join public.shipments s on s.id = g.shipment_id
    where g.id = grn_id and (public.can_access_facility(g.facility_id) or public.can_access_facility(s.from_facility_id))
  ));
drop policy "read grn photos" on public.grn_photos;
create policy "read grn photos" on public.grn_photos for select to authenticated
  using (exists (
    select 1 from public.grns g join public.shipments s on s.id = g.shipment_id
    where g.id = grn_id and (public.can_access_facility(g.facility_id) or public.can_access_facility(s.from_facility_id))
  ));

drop policy "read returns" on public.wh_returns;
create policy "read returns" on public.wh_returns for select to authenticated
  using (public.can_access_facility(facility_id) or public.can_access_facility(to_facility_id));
drop policy "read return lines" on public.wh_return_lines;
create policy "read return lines" on public.wh_return_lines for select to authenticated
  using (exists (
    select 1 from public.wh_returns r
    where r.id = return_id and (public.can_access_facility(r.facility_id) or public.can_access_facility(r.to_facility_id))
  ));

-- ================================================================ helpers
-- units at a fulfiller already promised to approved requests but not yet dispatched
create or replace function public.reserved_qty(p_fulfiller_id bigint, p_sku text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(fl.qty - coalesce(
           (select sum(sl.qty) from public.shipment_lines sl where sl.fo_line_id = fl.id), 0), 0)), 0)::int
  from public.fulfilment_order_lines fl
  join public.fulfilment_orders fo on fo.id = fl.fo_id
  where fo.fulfiller_id = p_fulfiller_id and fl.sku = p_sku and fo.status in ('open', 'partially_dispatched')
$$;

create or replace function public.available_qty(p_fulfiller_id bigint, p_sku text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select qty from public.stock_balances
                   where facility_id = p_fulfiller_id and sku = p_sku and bucket = 'sellable'), 0)
         - public.reserved_qty(p_fulfiller_id, p_sku)
$$;

create or replace function public.default_warehouse_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.facilities where type = 'warehouse' and is_active order by id limit 1
$$;

-- may this facility request this SKU? (curated assortment; a super stockist may stock what its retailers carry)
create or replace function public._sku_allowed(p_facility_id bigint, p_sku text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not f.restrict_to_assortment
      or exists (select 1 from public.facility_assortment a
                 where a.facility_id = f.id and a.sku = p_sku and a.is_active)
      or (f.type = 'super_stockist' and exists (
            select 1 from public.facility_assortment a join public.facilities r on r.id = a.facility_id
            where r.fulfiller_ss_id = f.id and a.sku = p_sku and a.is_active))
  from public.facilities f where f.id = p_facility_id
$$;

-- replace a request's lines, priced as of now; duplicate SKU/purpose rows are summed
create or replace function public._replace_request_lines(p_request_id bigint, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac bigint;
  v_line record;
  v_price record;
  v_n int := 0;
begin
  select facility_id into v_fac from public.order_requests where id = p_request_id;
  delete from public.order_request_lines where request_id = p_request_id;
  for v_line in
    select x.sku,
           coalesce(nullif(x.bucket, ''), 'sellable') as bucket,
           sum(coalesce(x.qty, 0))::int as qty,
           max(x.suggested_qty) as suggested_qty,
           max(x.notes) as notes
    from jsonb_to_recordset(coalesce(p_lines, '[]')) as x(sku text, bucket text, qty int, suggested_qty int, notes text)
    group by x.sku, coalesce(nullif(x.bucket, ''), 'sellable')
    having sum(coalesce(x.qty, 0)) > 0
  loop
    if v_line.bucket not in ('sellable', 'display', 'in_use') then
      raise exception 'Invalid purpose % for %', v_line.bucket, v_line.sku;
    end if;
    if not exists (select 1 from public.items where sku = v_line.sku) then
      raise exception 'Unknown SKU %', v_line.sku;
    end if;
    if not public._sku_allowed(v_fac, v_line.sku) then
      raise exception 'SKU % is not in this facility''s assortment', v_line.sku;
    end if;
    select * into v_price from public.price_for(v_fac, v_line.sku);
    insert into public.order_request_lines (request_id, sku, bucket, qty, suggested_qty, msp, margin_pct, gst_pct, notes)
    values (p_request_id, v_line.sku, v_line.bucket::public.stock_bucket, v_line.qty, v_line.suggested_qty,
            v_price.msp, v_price.margin_pct, v_price.gst_pct, v_line.notes);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Add at least one SKU with a quantity';
  end if;
end;
$$;

create or replace function public._refresh_fo_status(p_fo_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.fo_status;
  v_total int;
  v_sent int;
begin
  select status into v_status from public.fulfilment_orders where id = p_fo_id for update;
  if v_status in ('closed', 'cancelled') then return; end if;
  select coalesce(sum(fl.qty), 0),
         coalesce(sum(least(fl.qty, coalesce((select sum(sl.qty) from public.shipment_lines sl where sl.fo_line_id = fl.id), 0))), 0)
  into v_total, v_sent
  from public.fulfilment_order_lines fl where fl.fo_id = p_fo_id;
  update public.fulfilment_orders set status =
    case when v_sent = 0 then 'open' when v_sent < v_total then 'partially_dispatched' else 'dispatched' end::public.fo_status
  where id = p_fo_id;
end;
$$;

-- after approval: each line goes to the retailer's super stockist as far as its free stock allows,
-- the rest to Frido WH. Allocations reserve the SS stock until dispatched.
create or replace function public._route_request(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_fac record;
  v_ss bigint;
  v_wh bigint;
  v_ss_fo bigint;
  v_wh_fo bigint;
  v_line record;
  v_take int;
begin
  select * into v_req from public.order_requests where id = p_request_id;
  select * into v_fac from public.facilities where id = v_req.facility_id;
  v_wh := coalesce(v_req.warehouse_id, public.default_warehouse_id());
  if v_fac.type in ('retailer', 'internal') and v_fac.fulfiller_ss_id is not null then
    select id into v_ss from public.facilities
    where id = v_fac.fulfiller_ss_id and type = 'super_stockist' and is_active;
  end if;
  if v_ss is not null then
    -- two approvals routing against the same SS at once must not double-book its stock
    perform pg_advisory_xact_lock(v_ss);
  end if;

  for v_line in select * from public.order_request_lines where request_id = p_request_id order by id loop
    v_take := 0;
    if v_ss is not null then
      v_take := least(v_line.qty, greatest(public.available_qty(v_ss, v_line.sku), 0));
      if v_take > 0 then
        if v_ss_fo is null then
          insert into public.fulfilment_orders (fo_no, request_id, fulfiller_id, facility_id)
          values (public.next_doc_no('FO'), p_request_id, v_ss, v_req.facility_id)
          returning id into v_ss_fo;
        end if;
        insert into public.fulfilment_order_lines (fo_id, request_line_id, sku, qty)
        values (v_ss_fo, v_line.id, v_line.sku, v_take);
      end if;
    end if;
    if v_line.qty > v_take then
      if v_wh is null then
        raise exception 'No active warehouse to fulfil from';
      end if;
      if v_wh_fo is null then
        insert into public.fulfilment_orders (fo_no, request_id, fulfiller_id, facility_id)
        values (public.next_doc_no('FO'), p_request_id, v_wh, v_req.facility_id)
        returning id into v_wh_fo;
      end if;
      insert into public.fulfilment_order_lines (fo_id, request_line_id, sku, qty)
      values (v_wh_fo, v_line.id, v_line.sku, v_line.qty - v_take);
    end if;
  end loop;
end;
$$;

-- ================================================================ request lifecycle
-- ops create drafts; retailer / SS staff submit straight into the ops review queue
create or replace function public.create_order_request(
  p_facility_id bigint,
  p_warehouse_id bigint,
  p_notes text,
  p_lines jsonb   -- [{sku, bucket, qty, suggested_qty, notes}]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_ops boolean := public.is_ops();
begin
  perform public.assert_facility_access(p_facility_id);
  if not exists (select 1 from public.facilities where id = p_facility_id and is_active and type <> 'warehouse') then
    raise exception 'Facility not found or inactive';
  end if;
  insert into public.order_requests (request_no, facility_id, warehouse_id, notes, status, source, submitted_by, submitted_at)
  values (
    public.next_doc_no('REQ'), p_facility_id, coalesce(p_warehouse_id, public.default_warehouse_id()), p_notes,
    case when v_ops then 'draft' else 'submitted' end::public.request_status,
    case when v_ops then 'ops' else 'retailer' end,
    case when v_ops then null else auth.uid() end,
    case when v_ops then null else now() end
  )
  returning id into v_id;
  perform public._replace_request_lines(v_id, p_lines);
  return v_id;
end;
$$;

create or replace function public.update_request_lines(p_request_id bigint, p_lines jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select * into v_req from public.order_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if public.is_ops() then
    if v_req.status not in ('draft', 'submitted', 'rejected') then
      raise exception 'A % request can''t be edited', v_req.status;
    end if;
  else
    perform public.assert_facility_access(v_req.facility_id);
    if v_req.status <> 'submitted' then
      raise exception 'This request is already with Frido and can''t be edited here';
    end if;
  end if;
  perform public._replace_request_lines(p_request_id, p_lines);
  update public.order_requests
  set lines_edited_at = now(), notes = coalesce(p_notes, notes)
  where id = p_request_id;
end;
$$;

create or replace function public.send_for_approval(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.request_status;
begin
  perform public.assert_ops();
  select status into v_status from public.order_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status not in ('draft', 'submitted', 'rejected') then
    raise exception 'A % request can''t be sent for approval', v_status;
  end if;
  if not exists (select 1 from public.order_request_lines where request_id = p_request_id) then
    raise exception 'Add at least one SKU';
  end if;
  update public.order_requests
  set status = 'pending_approval', sent_for_approval_by = auth.uid(), sent_for_approval_at = now(),
      decided_by = null, decided_at = null
  where id = p_request_id;
end;
$$;

create or replace function public.approve_request(p_request_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  if not public.is_manager() then
    raise exception 'Only the manager can approve requests' using errcode = '42501';
  end if;
  select * into v_req from public.order_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending_approval' then
    raise exception 'Only requests pending approval can be approved (this one is %)', v_req.status;
  end if;
  if v_req.sent_for_approval_by = auth.uid() then
    raise exception 'You sent this request for approval, so another manager must approve it';
  end if;
  update public.order_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
      po_no = coalesce(po_no, public.next_doc_no('PO'))
  where id = p_request_id;
  perform public._route_request(p_request_id);
end;
$$;

create or replace function public.reject_request(p_request_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.request_status;
begin
  if not public.is_manager() then
    raise exception 'Only the manager can reject requests' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason so ops know what to change';
  end if;
  select status into v_status from public.order_requests where id = p_request_id for update;
  if v_status is distinct from 'pending_approval' then
    raise exception 'Only requests pending approval can be rejected';
  end if;
  update public.order_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request_id;
end;
$$;

-- cancel (nothing dispatched yet), close (stop further dispatches), or send back to draft for revision
create or replace function public.set_request_state(p_request_id bigint, p_status public.request_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select * into v_req from public.order_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;

  if p_status = 'cancelled' then
    if exists (select 1 from public.shipments where request_id = p_request_id) then
      raise exception 'Something has already been dispatched; close the request instead';
    end if;
    if not public.is_ops() then
      perform public.assert_facility_access(v_req.facility_id);
      if v_req.status <> 'submitted' then
        raise exception 'Only Frido can cancel a request once it is under review';
      end if;
    end if;
    update public.order_requests set status = 'cancelled', closed_at = now() where id = p_request_id;
    update public.fulfilment_orders set status = 'cancelled', closed_at = now()
    where request_id = p_request_id and status in ('open', 'partially_dispatched');

  elsif p_status = 'closed' then
    perform public.assert_ops();
    if v_req.status not in ('approved', 'partially_dispatched', 'dispatched', 'received') then
      raise exception 'Only approved requests can be closed';
    end if;
    update public.order_requests set status = 'closed', closed_at = now() where id = p_request_id;
    -- frees any super stockist stock still reserved for it
    update public.fulfilment_orders set status = 'closed', closed_at = now()
    where request_id = p_request_id and status in ('open', 'partially_dispatched');

  elsif p_status = 'draft' then
    perform public.assert_ops();
    if v_req.status not in ('rejected', 'submitted') then
      raise exception 'Only rejected or submitted requests can go back to draft';
    end if;
    update public.order_requests set status = 'draft' where id = p_request_id;

  else
    raise exception 'Unsupported status change to %', p_status;
  end if;
end;
$$;

create or replace function public.refresh_request_status(p_request_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.request_status;
  v_requested int;
  v_dispatched int;
  v_shipments int;
  v_open_shipments int;
begin
  select status into v_status from public.order_requests where id = p_request_id for update;
  if v_status not in ('approved', 'partially_dispatched', 'dispatched', 'received') then
    return;
  end if;

  select coalesce(sum(qty), 0) into v_requested from public.order_request_lines where request_id = p_request_id;
  select coalesce(sum(least(l.qty, coalesce(d.qty, 0))), 0) into v_dispatched
  from public.order_request_lines l
  left join (
    select sl.request_line_id, sum(sl.qty) qty
    from public.shipment_lines sl join public.shipments s on s.id = sl.shipment_id
    where s.request_id = p_request_id
    group by sl.request_line_id
  ) d on d.request_line_id = l.id
  where l.request_id = p_request_id;

  select count(*), count(*) filter (where status = 'in_transit')
  into v_shipments, v_open_shipments
  from public.shipments where request_id = p_request_id;

  update public.order_requests set status =
    case
      when v_shipments = 0 then 'approved'
      when v_dispatched < v_requested then 'partially_dispatched'
      when v_open_shipments > 0 then 'dispatched'
      else 'received'
    end::public.request_status
  where id = p_request_id;
end;
$$;

-- ================================================================ dispatch (Frido WH entered by ops, SS by its own staff)
drop function public.create_shipment(bigint, jsonb, jsonb);

create or replace function public.dispatch_fulfilment_order(
  p_fo_id bigint,
  p_header jsonb,  -- {dispatched_at, uniware_ref, invoice_no, dc_no, dn_no, carton_count, courier, awb_no, notes}
  p_lines jsonb    -- [{fo_line_id, sku, qty}]  sku differs from the line's = substitute; no fo_line_id = extra
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fo record;
  v_from record;
  v_dest_code text;
  v_id bigint;
  v_no text;
  v_line jsonb;
  v_fl_id bigint;
  v_fl_sku text;
  v_rl_id bigint;
  v_sku text;
  v_qty int;
begin
  select * into v_fo from public.fulfilment_orders where id = p_fo_id for update;
  if not found then raise exception 'Fulfilment order not found'; end if;
  select * into v_from from public.facilities where id = v_fo.fulfiller_id;
  if v_from.type = 'warehouse' then
    perform public.assert_ops();
  else
    perform public.assert_facility_access(v_fo.fulfiller_id);
  end if;
  if v_fo.status not in ('open', 'partially_dispatched') then
    raise exception 'Fulfilment order is %', v_fo.status;
  end if;
  select code into v_dest_code from public.facilities where id = v_fo.facility_id;

  v_no := public.next_doc_no('DSP');
  insert into public.shipments (shipment_no, request_id, facility_id, fulfilment_order_id, from_facility_id, dispatched_at,
                                uniware_ref, invoice_no, dc_no, dn_no, carton_count, courier, awb_no, notes)
  values (
    v_no, v_fo.request_id, v_fo.facility_id, p_fo_id, v_fo.fulfiller_id,
    coalesce(nullif(p_header ->> 'dispatched_at', '')::date, current_date),
    p_header ->> 'uniware_ref', p_header ->> 'invoice_no', p_header ->> 'dc_no', p_header ->> 'dn_no',
    nullif(p_header ->> 'carton_count', '')::int, nullif(p_header ->> 'courier', ''), nullif(p_header ->> 'awb_no', ''),
    p_header ->> 'notes'
  )
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    v_fl_id := nullif(v_line ->> 'fo_line_id', '')::bigint;
    v_sku := nullif(v_line ->> 'sku', '');
    v_fl_sku := null;
    v_rl_id := null;
    if v_fl_id is not null then
      select sku, request_line_id into v_fl_sku, v_rl_id
      from public.fulfilment_order_lines where id = v_fl_id and fo_id = p_fo_id;
      if not found then raise exception 'Line does not belong to this fulfilment order'; end if;
      v_sku := coalesce(v_sku, v_fl_sku);
    end if;
    if not exists (select 1 from public.items where sku = v_sku) then
      raise exception 'Unknown SKU %', v_sku;
    end if;
    insert into public.shipment_lines (shipment_id, request_line_id, fo_line_id, sku, qty, is_substitute)
    values (v_id, v_rl_id, v_fl_id, v_sku, v_qty, v_fl_id is not null and v_fl_sku <> v_sku);
    -- Frido WH stock lives in Uniware; a super stockist's stock leaves it now
    if v_from.type <> 'warehouse' then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
      values (v_fo.fulfiller_id, v_sku, 'sellable', -v_qty, 'dispatch', 'shipment', v_id, v_no, 'To ' || v_dest_code);
    end if;
  end loop;

  if not exists (select 1 from public.shipment_lines where shipment_id = v_id) then
    raise exception 'Shipment has no quantities';
  end if;
  perform public._refresh_fo_status(p_fo_id);
  perform public.refresh_request_status(v_fo.request_id);
  return v_id;
end;
$$;

-- ================================================================ inward (GRN): reject at the door, quarantine outside-ambit units
create or replace function public.post_grn(
  p_shipment_id bigint,
  p_header jsonb,  -- {dn_no, invoice_no, dc_no, gate_pass_no, cartons_received, notes}
  p_lines jsonb    -- [{shipment_line_id, sku, bucket, received_qty, damaged_qty, rejected_qty, reject_reason, reason, notes}]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship record;
  v_id bigint;
  v_no text;
  v_line jsonb;
  v_expected int;
  v_recv int;
  v_dmg int;
  v_rej int;
  v_acc int;
  v_quar int;
  v_reason public.discrepancy_reason;
  v_bucket public.stock_bucket;
  v_sku text;
  v_line_id bigint;
  v_disc boolean := false;
  v_ret_id bigint;
  v_ret_no text;
  v_to bigint;
begin
  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Shipment not found'; end if;
  perform public.assert_facility_access(v_ship.facility_id);
  if v_ship.status <> 'in_transit' then raise exception 'Shipment already received'; end if;

  v_no := public.next_doc_no('GRN');
  insert into public.grns (grn_no, shipment_id, facility_id, dn_no, invoice_no, dc_no, gate_pass_no, cartons_received, notes)
  values (
    v_no, p_shipment_id, v_ship.facility_id,
    p_header ->> 'dn_no', p_header ->> 'invoice_no', p_header ->> 'dc_no', p_header ->> 'gate_pass_no',
    nullif(p_header ->> 'cartons_received', '')::int, p_header ->> 'notes'
  )
  returning id into v_id;

  if v_ship.carton_count is not null
     and nullif(p_header ->> 'cartons_received', '')::int is distinct from v_ship.carton_count then
    v_disc := true;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    v_line_id := nullif(v_line ->> 'shipment_line_id', '')::bigint;
    v_expected := 0;
    if v_line_id is not null then
      select sl.qty, sl.sku into v_expected, v_sku from public.shipment_lines sl
      where sl.id = v_line_id and sl.shipment_id = p_shipment_id;
      if not found then raise exception 'Line does not belong to this shipment'; end if;
    else
      v_sku := v_line ->> 'sku';
      if not exists (select 1 from public.items where sku = v_sku) then raise exception 'Unknown SKU %', v_sku; end if;
    end if;
    v_recv := coalesce((v_line ->> 'received_qty')::int, 0);
    v_dmg := coalesce((v_line ->> 'damaged_qty')::int, 0);
    v_rej := coalesce((v_line ->> 'rejected_qty')::int, 0);
    v_bucket := coalesce(nullif(v_line ->> 'bucket', '')::public.stock_bucket, 'sellable');
    if v_bucket in ('damaged', 'quarantine') then v_bucket := 'sellable'; end if;

    -- good units beyond what was dispatched (or never dispatched at all) are outside the ambit: quarantine
    if v_line_id is null then
      v_acc := 0;
    else
      v_acc := least(v_recv, greatest(v_expected - v_dmg - v_rej, 0));
    end if;
    v_quar := v_recv - v_acc;

    v_reason := coalesce(nullif(v_line ->> 'reason', '')::public.discrepancy_reason,
      case
        when v_rej > 0 then 'rejected'
        when v_line_id is null then 'wrong_sku'
        when v_dmg > 0 then 'damaged'
        when v_recv + v_dmg + v_rej < v_expected then 'short'
        when v_recv + v_dmg + v_rej > v_expected then 'excess'
        else 'ok'
      end::public.discrepancy_reason);
    if v_reason <> 'ok' or v_dmg > 0 or v_rej > 0 or v_quar > 0 or v_recv + v_dmg + v_rej <> v_expected then
      v_disc := true;
    end if;

    insert into public.grn_lines (grn_id, shipment_line_id, sku, bucket, expected_qty, received_qty, damaged_qty,
                                  rejected_qty, quarantine_qty, reason, notes)
    values (v_id, v_line_id, v_sku, v_bucket, v_expected, v_recv, v_dmg, v_rej, v_quar, v_reason, v_line ->> 'notes');

    if v_acc > 0 then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no)
      values (v_ship.facility_id, v_sku, v_bucket, v_acc, 'receipt', 'grn', v_id, v_no);
    end if;
    if v_quar > 0 then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
      values (v_ship.facility_id, v_sku, 'quarantine', v_quar, 'receipt', 'grn', v_id, v_no,
              'Outside the shipment – awaiting Frido decision');
    end if;
    if v_dmg > 0 then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
      values (v_ship.facility_id, v_sku, 'damaged', v_dmg, 'receipt', 'grn', v_id, v_no, 'Received damaged');
    end if;

    -- refused at the door: never enters stock, goes straight back to whoever sent it
    if v_rej > 0 then
      if v_ret_id is null then
        v_to := coalesce(v_ship.from_facility_id,
                         (select warehouse_id from public.order_requests where id = v_ship.request_id),
                         public.default_warehouse_id());
        v_ret_no := public.next_doc_no('RTN');
        insert into public.wh_returns (return_no, facility_id, to_facility_id, origin, grn_id, notes)
        values (v_ret_no, v_ship.facility_id, v_to, 'rejected_at_inward', v_id,
                'Refused at inward against ' || v_ship.shipment_no)
        returning id into v_ret_id;
      end if;
      insert into public.wh_return_lines (return_id, sku, bucket, qty, reason)
      values (v_ret_id, v_sku,
              case when v_line ->> 'reject_reason' = 'damaged' then 'damaged' else 'sellable' end::public.stock_bucket,
              v_rej, coalesce(nullif(v_line ->> 'reject_reason', ''), 'refused') || coalesce(' – ' || nullif(v_line ->> 'notes', ''), ''));
    end if;
  end loop;

  -- dispatched lines that were not sent back in p_lines count as fully short
  insert into public.grn_lines (grn_id, shipment_line_id, sku, bucket, expected_qty, received_qty, damaged_qty, reason)
  select v_id, sl.id, sl.sku, 'sellable', sl.qty, 0, 0, 'short'
  from public.shipment_lines sl
  where sl.shipment_id = p_shipment_id
    and not exists (select 1 from public.grn_lines g where g.grn_id = v_id and g.shipment_line_id = sl.id);
  if found then v_disc := true; end if;

  update public.grns set has_discrepancy = v_disc where id = v_id;
  update public.shipments set status = 'received', delivered_at = coalesce(delivered_at, now()) where id = p_shipment_id;
  perform public.refresh_request_status(v_ship.request_id);
  return v_id;
end;
$$;

-- ================================================================ returns to a fulfiller (Frido WH or super stockist)
create or replace function public.create_wh_return(
  p_facility_id bigint,
  p_header jsonb,  -- {to_facility_id, courier, awb_no, carton_count, notes}
  p_lines jsonb    -- [{sku, bucket, qty, reason}]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_no text;
  v_line jsonb;
  v_bucket public.stock_bucket;
  v_to bigint;
  v_has_quarantine boolean := false;
begin
  perform public.assert_facility_access(p_facility_id);
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Add at least one SKU'; end if;
  v_to := coalesce(nullif(p_header ->> 'to_facility_id', '')::bigint, nullif(p_header ->> 'warehouse_id', '')::bigint,
                   public.default_warehouse_id());
  if not exists (select 1 from public.facilities where id = v_to and type in ('warehouse', 'super_stockist') and is_active) then
    raise exception 'Returns go to Frido WH or a super stockist';
  end if;
  if v_to = p_facility_id then raise exception 'A facility can''t return stock to itself'; end if;
  select exists (select 1 from jsonb_array_elements(p_lines) x where x.value ->> 'bucket' = 'quarantine') into v_has_quarantine;

  v_no := public.next_doc_no('RTN');
  insert into public.wh_returns (return_no, facility_id, to_facility_id, origin, courier, awb_no, carton_count, notes)
  values (v_no, p_facility_id, v_to, case when v_has_quarantine then 'quarantine' else 'stock' end,
          nullif(p_header ->> 'courier', ''), nullif(p_header ->> 'awb_no', ''),
          nullif(p_header ->> 'carton_count', '')::int, p_header ->> 'notes')
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_bucket := coalesce(nullif(v_line ->> 'bucket', '')::public.stock_bucket, 'sellable');
    insert into public.wh_return_lines (return_id, sku, bucket, qty, reason)
    values (v_id, v_line ->> 'sku', v_bucket, (v_line ->> 'qty')::int, v_line ->> 'reason');
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
    values (p_facility_id, v_line ->> 'sku', v_bucket, -(v_line ->> 'qty')::int, 'return_to_wh', 'return', v_id, v_no,
            v_line ->> 'reason');
  end loop;
  return v_id;
end;
$$;

-- the receiving side books a return in (a super stockist gets the units back into its stock)
create or replace function public.receive_return(p_return_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ret record;
  v_type public.facility_type;
begin
  select * into v_ret from public.wh_returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if v_ret.status <> 'in_transit' then raise exception 'Return already received'; end if;
  select type into v_type from public.facilities where id = v_ret.to_facility_id;
  if v_type is null or v_type = 'warehouse' then
    perform public.assert_ops();
  else
    perform public.assert_facility_access(v_ret.to_facility_id);
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
    select v_ret.to_facility_id, l.sku,
           case when l.bucket = 'damaged' then 'damaged' else 'sellable' end::public.stock_bucket,
           l.qty, 'return_in', 'return', v_ret.id, v_ret.return_no,
           'Returned by ' || (select code from public.facilities where id = v_ret.facility_id)
    from public.wh_return_lines l where l.return_id = p_return_id;
  end if;
  update public.wh_returns set status = 'received', received_at = now(), received_by = auth.uid() where id = p_return_id;
end;
$$;

-- Frido's decision on quarantined units: accept into a bucket, or send them back
create or replace function public.resolve_quarantine(
  p_facility_id bigint,
  p_sku text,
  p_qty int,
  p_action text,                         -- 'accept' | 'return'
  p_bucket public.stock_bucket,          -- accept: target bucket (default sellable)
  p_to_facility_id bigint,               -- return: destination (default mapped SS, else Frido WH)
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac record;
begin
  perform public.assert_ops();
  if p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into v_fac from public.facilities where id = p_facility_id;
  if p_action = 'accept' then
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, note)
    values (p_facility_id, p_sku, 'quarantine', -p_qty, 'bucket_transfer', 'quarantine', coalesce(p_note, 'Accepted by Frido')),
           (p_facility_id, p_sku, coalesce(nullif(p_bucket::text, 'quarantine'), 'sellable')::public.stock_bucket, p_qty,
            'bucket_transfer', 'quarantine', coalesce(p_note, 'Accepted by Frido'));
    return null;
  elsif p_action = 'return' then
    return public.create_wh_return(
      p_facility_id,
      jsonb_build_object('to_facility_id', coalesce(p_to_facility_id, v_fac.fulfiller_ss_id, public.default_warehouse_id()),
                         'notes', coalesce(p_note, 'Quarantined units returned by Frido decision')),
      jsonb_build_array(jsonb_build_object('sku', p_sku, 'bucket', 'quarantine', 'qty', p_qty,
                                           'reason', coalesce(p_note, 'Outside shipment'))));
  else
    raise exception 'Unknown action %', p_action;
  end if;
end;
$$;

-- ================================================================ demand planning
-- suggested qty = clamp(velocity x (lead time + review + safety days) x season, min, max)
--                 - on hand - in transit - already requested/approved but not dispatched
create or replace function public._demand_lines(p_facility_id bigint)
returns table (
  sku text, item_name text, category_name text, bucket public.stock_bucket,
  on_hand int, in_transit int, pending int, sold_30d int, velocity numeric,
  lead_time_days numeric, season_factor numeric, min_qty int, max_qty int, target numeric, suggested_qty int
)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select * from public.facilities where id = p_facility_id
  ),
  raw_skus as (
    select a.sku, a.default_bucket as bucket, a.min_qty, a.max_qty
    from public.facility_assortment a where a.facility_id = p_facility_id and a.is_active
    union all
    -- a super stockist plans for everything its retailers carry
    select a.sku, 'sellable'::public.stock_bucket, 0, 0
    from public.facility_assortment a join public.facilities r on r.id = a.facility_id
    where r.fulfiller_ss_id = p_facility_id and a.is_active and (select type from f) = 'super_stockist'
  ),
  skus as (
    select s.sku, s.bucket, max(s.min_qty) as min_qty, max(s.max_qty) as max_qty from raw_skus s group by s.sku, s.bucket
  ),
  sellers as (
    select p_facility_id as id
    union
    select r.id from public.facilities r where r.fulfiller_ss_id = p_facility_id and (select type from f) = 'super_stockist'
  ),
  sold as (
    select l.sku, sum(l.qty)::int as qty from public.sale_lines l join public.sales s on s.id = l.sale_id
    where s.facility_id in (select id from sellers) and s.sold_at >= now() - interval '30 days'
    group by l.sku
  ),
  first_in as (
    select g.sku, min(g.created_at) as first_at from public.stock_ledger g
    where g.facility_id = p_facility_id and g.qty_delta > 0 group by g.sku
  ),
  transit as (
    select sl.sku, sum(sl.qty)::int as qty from public.shipment_lines sl join public.shipments s on s.id = sl.shipment_id
    where s.facility_id = p_facility_id and s.status = 'in_transit' group by sl.sku
  ),
  pend as (
    select x.sku, sum(x.qty)::int as qty from (
      select fl.sku, greatest(fl.qty - coalesce((select sum(sl.qty) from public.shipment_lines sl where sl.fo_line_id = fl.id), 0), 0) as qty
      from public.fulfilment_order_lines fl join public.fulfilment_orders fo on fo.id = fl.fo_id
      where fo.facility_id = p_facility_id and fo.status in ('open', 'partially_dispatched')
      union all
      select rl.sku, rl.qty from public.order_request_lines rl join public.order_requests r on r.id = rl.request_id
      where r.facility_id = p_facility_id and r.status in ('submitted', 'pending_approval')
    ) x group by x.sku
  ),
  lead as (
    select avg(extract(epoch from (g.received_at - r.decided_at)) / 86400.0) as days
    from public.grns g join public.shipments s on s.id = g.shipment_id join public.order_requests r on r.id = s.request_id
    where g.facility_id = p_facility_id and r.decided_at is not null and g.received_at >= now() - interval '120 days'
  ),
  calc as (
    select k.sku, i.name as item_name, i.category_name, k.bucket,
      coalesce((select b.qty from public.stock_balances b
                where b.facility_id = p_facility_id and b.sku = k.sku and b.bucket = k.bucket), 0) as on_hand,
      coalesce(t.qty, 0) as in_transit,
      coalesce(p.qty, 0) as pending,
      coalesce(sd.qty, 0) as sold_30d,
      case when (select type from f) = 'super_stockist' or fi.first_at is null then 30
           else least(30, greatest(1, extract(day from now() - fi.first_at)::int + 1)) end as window_days,
      round(coalesce((select days from lead), (select lead_time_days from f)), 1) as lead_time_days,
      coalesce((select sf.factor from public.season_factors sf
                where sf.category_name = i.category_name
                  and sf.month = extract(month from now() at time zone 'Asia/Kolkata')::int), 1) as season_factor,
      k.min_qty, k.max_qty
    from skus k
    join public.items i on i.sku = k.sku
    left join sold sd on sd.sku = k.sku
    left join first_in fi on fi.sku = k.sku
    left join transit t on t.sku = k.sku
    left join pend p on p.sku = k.sku
  ),
  tgt as (
    select c.*,
      round(c.sold_30d::numeric / c.window_days, 3) as velocity,
      greatest(
        (c.sold_30d::numeric / c.window_days)
          * (c.lead_time_days + (select review_days from f) + (select safety_days from f)) * c.season_factor,
        c.min_qty
      ) as raw_target
    from calc c
  )
  select t.sku, t.item_name, t.category_name, t.bucket, t.on_hand, t.in_transit, t.pending, t.sold_30d, t.velocity,
         t.lead_time_days, t.season_factor, t.min_qty, t.max_qty,
         round(case when t.max_qty > 0 then least(t.raw_target, t.max_qty) else t.raw_target end, 1) as target,
         greatest(ceil((case when t.max_qty > 0 then least(t.raw_target, t.max_qty) else t.raw_target end)
                       - t.on_hand - t.in_transit - t.pending), 0)::int as suggested_qty
  from tgt t
  order by t.item_name
$$;

create or replace function public.demand_suggestions(p_facility_id bigint)
returns table (
  sku text, item_name text, category_name text, bucket public.stock_bucket,
  on_hand int, in_transit int, pending int, sold_30d int, velocity numeric,
  lead_time_days numeric, season_factor numeric, min_qty int, max_qty int, target numeric, suggested_qty int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_facility_access(p_facility_id);
  return query select * from public._demand_lines(p_facility_id);
end;
$$;

-- weekly (pg_cron) or on demand: one draft request per facility that needs stock
create or replace function public._generate_demand_drafts(p_facility_id bigint, p_trigger text, p_run_by uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_fac record;
  v_req bigint;
  v_lines jsonb;
  v_n int;
  v_planned int := 0;
  v_drafts int := 0;
  v_total int := 0;
begin
  insert into public.demand_runs (trigger, run_by) values (p_trigger, p_run_by) returning id into v_run;
  for v_fac in
    select * from public.facilities
    where is_active and planning_enabled and type in ('retailer', 'super_stockist', 'internal')
      and (p_facility_id is null or id = p_facility_id)
    order by id
  loop
    v_planned := v_planned + 1;
    begin
      -- an untouched scheduled draft from an earlier run is replaced rather than duplicated
      delete from public.order_requests
      where facility_id = v_fac.id and status = 'draft' and source = 'schedule' and lines_edited_at is null;

      select coalesce(jsonb_agg(jsonb_build_object('sku', d.sku, 'bucket', d.bucket, 'qty', d.suggested_qty,
                                                   'suggested_qty', d.suggested_qty)), '[]'::jsonb),
             count(*)
      into v_lines, v_n
      from public._demand_lines(v_fac.id) d where d.suggested_qty > 0;

      if v_n > 0 and not exists (select 1 from public.order_requests
                                 where facility_id = v_fac.id and status = 'draft' and source = 'schedule') then
        insert into public.order_requests (request_no, facility_id, warehouse_id, status, source, demand_run_id, notes)
        values (public.next_doc_no('REQ'), v_fac.id, public.default_warehouse_id(), 'draft', 'schedule', v_run,
                'Demand plan ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'))
        returning id into v_req;
        perform public._replace_request_lines(v_req, v_lines);
        v_drafts := v_drafts + 1;
        v_total := v_total + v_n;
      end if;
    exception when others then
      -- one facility's bad data must not stop the rest of the run
      raise warning 'Demand planning skipped facility %: %', v_fac.code, sqlerrm;
    end;
  end loop;
  update public.demand_runs
  set facilities_planned = v_planned, drafts_created = v_drafts, lines_suggested = v_total
  where id = v_run;
  return v_run;
end;
$$;

create or replace function public.run_demand_planning(p_facility_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return public._generate_demand_drafts(p_facility_id, 'manual', auth.uid());
end;
$$;

-- Mondays 06:00 IST
create extension if not exists pg_cron;
select cron.schedule('partner-hub-weekly-demand', '30 0 * * 1',
                     $$select public._generate_demand_drafts(null, 'schedule', null)$$);

-- ================================================================ views
create or replace view public.v_request_lines with (security_invoker = true) as
select
  l.id request_line_id, l.request_id, r.request_no, r.po_no, r.facility_id, r.status request_status, r.created_at,
  l.sku, i.name item_name, i.category_name, i.size, i.color, i.hsn_code, l.bucket, l.qty requested_qty,
  l.msp, l.margin_pct, l.gst_pct, l.unit_price,
  round(l.unit_price * l.qty, 2) line_total,
  round(l.unit_price * l.qty / (1 + l.gst_pct / 100), 2) line_taxable,
  round(l.unit_price * l.qty - l.unit_price * l.qty / (1 + l.gst_pct / 100), 2) line_gst,
  coalesce(d.dispatched, 0) dispatched_qty,
  coalesce(d.substituted, 0) substituted_qty,
  coalesce(g.received, 0) received_qty,
  coalesce(g.damaged, 0) damaged_qty,
  greatest(l.qty - coalesce(d.dispatched, 0), 0) pending_dispatch_qty,
  l.suggested_qty,
  coalesce(g.rejected, 0) rejected_qty
from public.order_request_lines l
join public.order_requests r on r.id = l.request_id
join public.items i on i.sku = l.sku
left join lateral (
  select sum(sl.qty) dispatched, sum(sl.qty) filter (where sl.is_substitute) substituted
  from public.shipment_lines sl where sl.request_line_id = l.id
) d on true
left join lateral (
  select sum(gl.received_qty) received, sum(gl.damaged_qty) damaged, sum(gl.rejected_qty) rejected
  from public.grn_lines gl join public.shipment_lines sl on sl.id = gl.shipment_line_id
  where sl.request_line_id = l.id
) g on true;

create view public.v_fo_lines with (security_invoker = true) as
select
  fl.id fo_line_id, fl.fo_id, fo.fo_no, fo.status fo_status, fo.request_id, r.request_no, r.po_no,
  fo.fulfiller_id, fo.facility_id, fl.request_line_id, fl.sku, i.name item_name, i.size, i.color, i.hsn_code,
  coalesce(rl.bucket, 'sellable') bucket, fl.qty,
  coalesce(d.dispatched, 0) dispatched_qty,
  greatest(fl.qty - coalesce(d.dispatched, 0), 0) pending_qty,
  rl.msp, rl.margin_pct, rl.gst_pct, rl.unit_price,
  round(coalesce(rl.unit_price, 0) * fl.qty, 2) line_total,
  round(coalesce(rl.unit_price, 0) * fl.qty / (1 + coalesce(rl.gst_pct, 18) / 100), 2) line_taxable,
  round(coalesce(rl.unit_price, 0) * fl.qty - coalesce(rl.unit_price, 0) * fl.qty / (1 + coalesce(rl.gst_pct, 18) / 100), 2) line_gst
from public.fulfilment_order_lines fl
join public.fulfilment_orders fo on fo.id = fl.fo_id
join public.order_requests r on r.id = fo.request_id
join public.items i on i.sku = fl.sku
left join public.order_request_lines rl on rl.id = fl.request_line_id
left join lateral (select sum(sl.qty) dispatched from public.shipment_lines sl where sl.fo_line_id = fl.id) d on true;

-- ================================================================ backfill: approved requests from before routing existed
update public.order_requests set decided_at = coalesce(decided_at, created_at)
where status in ('approved', 'partially_dispatched', 'dispatched', 'received', 'closed');
do $$
declare
  v_id bigint;
begin
  for v_id in
    select r.id from public.order_requests r
    where r.status in ('approved', 'partially_dispatched', 'dispatched', 'received')
      and not exists (select 1 from public.fulfilment_orders fo where fo.request_id = r.id)
  loop
    perform public._route_request(v_id);
  end loop;
end $$;

-- ================================================================ function privileges
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_manager(), public.reserved_qty(bigint, text), public.available_qty(bigint, text),
  public.default_warehouse_id(),
  public.create_order_request(bigint, bigint, text, jsonb), public.update_request_lines(bigint, jsonb, text),
  public.send_for_approval(bigint), public.approve_request(bigint, text), public.reject_request(bigint, text),
  public.set_request_state(bigint, public.request_status),
  public.dispatch_fulfilment_order(bigint, jsonb, jsonb), public.post_grn(bigint, jsonb, jsonb),
  public.create_wh_return(bigint, jsonb, jsonb), public.receive_return(bigint),
  public.resolve_quarantine(bigint, text, int, text, public.stock_bucket, bigint, text),
  public.demand_suggestions(bigint), public.run_demand_planning(bigint)
to authenticated;
revoke execute on function
  public._sku_allowed(bigint, text), public._replace_request_lines(bigint, jsonb), public._refresh_fo_status(bigint),
  public._route_request(bigint), public._demand_lines(bigint), public._generate_demand_drafts(bigint, text, uuid),
  public.apply_ledger_to_balance()
from authenticated;
