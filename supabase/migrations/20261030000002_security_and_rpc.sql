-- Frido WMS: auth helpers, RLS, posting functions (RPC), reporting views

-- ---------------------------------------------------------------- helpers
create or replace function public.try_numeric(p text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(trim(p), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.auth_facility()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select facility_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('admin', 'ops'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'admin', false)
$$;

create or replace function public.can_access_facility(p_facility_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ops() or (public.auth_role() is not null and p_facility_id = public.auth_facility())
$$;

create or replace function public.assert_facility_access(p_facility_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access_facility(p_facility_id) then
    raise exception 'Not allowed for this facility' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.assert_ops()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops() then
    raise exception 'Only admin / ops users can do this' using errcode = '42501';
  end if;
end;
$$;

-- New auth user -> profile. The very first user becomes admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'facility_staff'::public.user_role
         else 'admin'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Price used for PO and consignment settlement: MSP (assortment override or item MRP) less margin
create or replace function public.price_for(p_facility_id bigint, p_sku text)
returns table (msp numeric, margin_pct numeric, gst_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(a.msp, i.mrp, 0),
    coalesce(a.margin_pct, m.margin_pct, f.default_margin_pct, 0),
    coalesce(i.gst_pct, 18)
  from public.items i
  cross join public.facilities f
  left join public.facility_assortment a on a.facility_id = f.id and a.sku = i.sku
  left join public.facility_category_margins m on m.facility_id = f.id and m.category_name = i.category_name
  where i.sku = p_sku and f.id = p_facility_id
$$;

-- ---------------------------------------------------------------- RLS
alter table public.facilities enable row level security;
alter table public.profiles enable row level security;
alter table public.item_imports enable row level security;
alter table public.items enable row level security;
alter table public.bundle_components enable row level security;
alter table public.facility_category_margins enable row level security;
alter table public.facility_assortment enable row level security;
alter table public.doc_counters enable row level security;
alter table public.order_requests enable row level security;
alter table public.order_request_lines enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_lines enable row level security;
alter table public.grns enable row level security;
alter table public.grn_lines enable row level security;
alter table public.grn_photos enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.wh_returns enable row level security;
alter table public.wh_return_lines enable row level security;
alter table public.stock_issues enable row level security;
alter table public.stock_issue_lines enable row level security;
alter table public.stock_ledger enable row level security;
alter table public.stock_balances enable row level security;

-- reference data: readable by any signed-in user
create policy "read facilities" on public.facilities for select to authenticated using (true);
create policy "ops insert facilities" on public.facilities for insert to authenticated with check ((select public.is_ops()));
create policy "ops update facilities" on public.facilities for update to authenticated using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "read items" on public.items for select to authenticated using (true);
create policy "read bundles" on public.bundle_components for select to authenticated using (true);
create policy "read imports" on public.item_imports for select to authenticated using ((select public.is_ops()));

create policy "read own or ops profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_ops()));
create policy "admin update profiles" on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "read margins" on public.facility_category_margins for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "ops write margins" on public.facility_category_margins for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "read assortment" on public.facility_assortment for select to authenticated
  using (public.can_access_facility(facility_id));
create policy "ops write assortment" on public.facility_assortment for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

-- documents: read by ops or the owning facility; all writes go through the functions below
create policy "read requests" on public.order_requests for select to authenticated using (public.can_access_facility(facility_id));
create policy "read request lines" on public.order_request_lines for select to authenticated
  using (exists (select 1 from public.order_requests r where r.id = request_id and public.can_access_facility(r.facility_id)));
create policy "read shipments" on public.shipments for select to authenticated using (public.can_access_facility(facility_id));
create policy "read shipment lines" on public.shipment_lines for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id and public.can_access_facility(s.facility_id)));
create policy "read grns" on public.grns for select to authenticated using (public.can_access_facility(facility_id));
create policy "read grn lines" on public.grn_lines for select to authenticated
  using (exists (select 1 from public.grns g where g.id = grn_id and public.can_access_facility(g.facility_id)));
create policy "read grn photos" on public.grn_photos for select to authenticated
  using (exists (select 1 from public.grns g where g.id = grn_id and public.can_access_facility(g.facility_id)));
create policy "read sales" on public.sales for select to authenticated using (public.can_access_facility(facility_id));
create policy "read sale lines" on public.sale_lines for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id and public.can_access_facility(s.facility_id)));
create policy "read counts" on public.stock_counts for select to authenticated using (public.can_access_facility(facility_id));
create policy "read count lines" on public.stock_count_lines for select to authenticated
  using (exists (select 1 from public.stock_counts c where c.id = count_id and public.can_access_facility(c.facility_id)));
create policy "read returns" on public.wh_returns for select to authenticated using (public.can_access_facility(facility_id));
create policy "read return lines" on public.wh_return_lines for select to authenticated
  using (exists (select 1 from public.wh_returns r where r.id = return_id and public.can_access_facility(r.facility_id)));
create policy "read issues" on public.stock_issues for select to authenticated using (public.can_access_facility(facility_id));
create policy "read issue lines" on public.stock_issue_lines for select to authenticated
  using (exists (select 1 from public.stock_issues i where i.id = issue_id and public.can_access_facility(i.facility_id)));
create policy "read ledger" on public.stock_ledger for select to authenticated using (public.can_access_facility(facility_id));
create policy "read balances" on public.stock_balances for select to authenticated using (public.can_access_facility(facility_id));

-- ---------------------------------------------------------------- request status
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
  if v_status in ('closed', 'cancelled') then
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
      when v_shipments = 0 then 'raised'
      when v_dispatched < v_requested then 'partially_dispatched'
      when v_open_shipments > 0 then 'dispatched'
      else 'received'
    end::public.request_status
  where id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: order request (+ PO)
create or replace function public.create_order_request(
  p_facility_id bigint,
  p_warehouse_id bigint,
  p_notes text,
  p_lines jsonb   -- [{sku, bucket, qty, notes}]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_restrict boolean;
  v_line jsonb;
  v_price record;
  v_sku text;
begin
  perform public.assert_ops();
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then
    raise exception 'Add at least one SKU';
  end if;
  select restrict_to_assortment into v_restrict from public.facilities where id = p_facility_id and is_active;
  if not found then raise exception 'Facility not found or inactive'; end if;

  insert into public.order_requests (request_no, po_no, facility_id, warehouse_id, notes)
  values (public.next_doc_no('REQ'), public.next_doc_no('PO'), p_facility_id, p_warehouse_id, p_notes)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_sku := v_line ->> 'sku';
    if not exists (select 1 from public.items where sku = v_sku) then
      raise exception 'Unknown SKU %', v_sku;
    end if;
    if v_restrict and not exists (
      select 1 from public.facility_assortment where facility_id = p_facility_id and sku = v_sku and is_active
    ) then
      raise exception 'SKU % is not in this facility''s assortment', v_sku;
    end if;
    select * into v_price from public.price_for(p_facility_id, v_sku);
    insert into public.order_request_lines (request_id, sku, bucket, qty, msp, margin_pct, gst_pct, notes)
    values (
      v_id, v_sku,
      coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable'),
      (v_line ->> 'qty')::int,
      v_price.msp, v_price.margin_pct, v_price.gst_pct,
      v_line ->> 'notes'
    );
  end loop;
  return v_id;
end;
$$;

create or replace function public.set_request_state(p_request_id bigint, p_status public.request_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  if p_status = 'cancelled' and exists (select 1 from public.shipments where request_id = p_request_id) then
    raise exception 'Cannot cancel a request that already has dispatches; close it instead';
  end if;
  if p_status = 'closed' then
    update public.order_requests set status = 'closed', closed_at = now() where id = p_request_id;
  elsif p_status = 'cancelled' then
    update public.order_requests set status = 'cancelled', closed_at = now() where id = p_request_id;
  else
    update public.order_requests set status = 'raised', closed_at = null where id = p_request_id;
    perform public.refresh_request_status(p_request_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------- RPC: dispatch entry
create or replace function public.create_shipment(
  p_request_id bigint,
  p_header jsonb,  -- {dispatched_at, uniware_ref, invoice_no, dc_no, dn_no, carton_count, courier, awb_no, notes}
  p_lines jsonb    -- [{request_line_id, sku, qty}]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_id bigint;
  v_line jsonb;
  v_rl_id bigint;
  v_rl_sku text;
  v_sku text;
begin
  perform public.assert_ops();
  select * into v_req from public.order_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status in ('closed', 'cancelled') then raise exception 'Request is %', v_req.status; end if;

  insert into public.shipments (shipment_no, request_id, facility_id, dispatched_at, uniware_ref, invoice_no,
                                dc_no, dn_no, carton_count, courier, awb_no, notes)
  values (
    public.next_doc_no('DSP'), p_request_id, v_req.facility_id,
    coalesce((p_header ->> 'dispatched_at')::date, current_date),
    p_header ->> 'uniware_ref', p_header ->> 'invoice_no', p_header ->> 'dc_no', p_header ->> 'dn_no',
    nullif(p_header ->> 'carton_count', '')::int, p_header ->> 'courier', p_header ->> 'awb_no', p_header ->> 'notes'
  )
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'qty')::int, 0) <= 0 then continue; end if;
    v_sku := nullif(v_line ->> 'sku', '');
    v_rl_id := null;
    v_rl_sku := null;
    if nullif(v_line ->> 'request_line_id', '') is not null then
      select id, sku into v_rl_id, v_rl_sku from public.order_request_lines
      where id = (v_line ->> 'request_line_id')::bigint and request_id = p_request_id;
      if not found then raise exception 'Request line does not belong to this request'; end if;
      v_sku := coalesce(v_sku, v_rl_sku);
    end if;
    if not exists (select 1 from public.items where sku = v_sku) then
      raise exception 'Unknown SKU %', v_sku;
    end if;
    insert into public.shipment_lines (shipment_id, request_line_id, sku, qty, is_substitute)
    values (v_id, v_rl_id, v_sku, (v_line ->> 'qty')::int, v_rl_id is not null and v_rl_sku <> v_sku);
  end loop;

  if not exists (select 1 from public.shipment_lines where shipment_id = v_id) then
    raise exception 'Shipment has no quantities';
  end if;
  perform public.refresh_request_status(p_request_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: receipt (GRN)
create or replace function public.post_grn(
  p_shipment_id bigint,
  p_header jsonb,  -- {dn_no, invoice_no, dc_no, gate_pass_no, cartons_received, notes}
  p_lines jsonb    -- [{shipment_line_id, sku, bucket, received_qty, damaged_qty, reason, notes}]
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
  v_reason public.discrepancy_reason;
  v_bucket public.stock_bucket;
  v_sku text;
  v_line_id bigint;
  v_disc boolean := false;
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

  if v_ship.carton_count is not null and nullif(p_header ->> 'cartons_received', '')::int is distinct from v_ship.carton_count then
    v_disc := true;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
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
    v_bucket := coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable');
    v_reason := coalesce(nullif(v_line ->> 'reason', '')::public.discrepancy_reason,
      case
        when v_line_id is null then 'wrong_sku'
        when v_dmg > 0 then 'damaged'
        when v_recv + v_dmg < v_expected then 'short'
        when v_recv + v_dmg > v_expected then 'excess'
        else 'ok'
      end::public.discrepancy_reason);
    if v_reason <> 'ok' or v_dmg > 0 or v_recv + v_dmg <> v_expected then v_disc := true; end if;

    insert into public.grn_lines (grn_id, shipment_line_id, sku, bucket, expected_qty, received_qty, damaged_qty, reason, notes)
    values (v_id, v_line_id, v_sku, v_bucket, v_expected, v_recv, v_dmg, v_reason, v_line ->> 'notes');

    if v_recv > 0 then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no)
      values (v_ship.facility_id, v_sku, v_bucket, v_recv, 'receipt', 'grn', v_id, v_no);
    end if;
    if v_dmg > 0 then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
      values (v_ship.facility_id, v_sku, 'damaged', v_dmg, 'receipt', 'grn', v_id, v_no, 'Received damaged');
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
  update public.shipments set status = 'received' where id = p_shipment_id;
  perform public.refresh_request_status(v_ship.request_id);
  return v_id;
end;
$$;

create or replace function public.add_grn_photo(p_grn_id bigint, p_grn_line_id bigint, p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fac bigint;
  v_id bigint;
begin
  select facility_id into v_fac from public.grns where id = p_grn_id;
  if not found then raise exception 'GRN not found'; end if;
  perform public.assert_facility_access(v_fac);
  insert into public.grn_photos (grn_id, grn_line_id, storage_path) values (p_grn_id, p_grn_line_id, p_path)
  returning id into v_id;
  return v_id;
end;
$$;

