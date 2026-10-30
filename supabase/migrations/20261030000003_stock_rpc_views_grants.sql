-- Frido WMS: stock posting functions, item import, reporting views, grants, storage

-- ---------------------------------------------------------------- RPC: sale (consignment)
create or replace function public.create_sale(
  p_facility_id bigint,
  p_header jsonb,  -- {customer_name, customer_phone, bill_ref, notes}
  p_lines jsonb    -- [{sku, qty, bucket}]
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
  v_price record;
  v_bucket public.stock_bucket;
  v_qty int;
begin
  perform public.assert_facility_access(p_facility_id);
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Add at least one SKU'; end if;
  v_no := public.next_doc_no('SAL');
  insert into public.sales (sale_no, facility_id, customer_name, customer_phone, bill_ref, notes)
  values (v_no, p_facility_id, p_header ->> 'customer_name', p_header ->> 'customer_phone',
          p_header ->> 'bill_ref', p_header ->> 'notes')
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty')::int;
    v_bucket := coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable');
    select * into v_price from public.price_for(p_facility_id, v_line ->> 'sku');
    if not found then raise exception 'Unknown SKU %', v_line ->> 'sku'; end if;
    insert into public.sale_lines (sale_id, sku, bucket, qty, msp, margin_pct, gst_pct)
    values (v_id, v_line ->> 'sku', v_bucket, v_qty, v_price.msp, v_price.margin_pct, v_price.gst_pct);
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no)
    values (p_facility_id, v_line ->> 'sku', v_bucket, -v_qty, 'sale', 'sale', v_id, v_no);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: stock count (open count, adjusts immediately)
create or replace function public.post_stock_count(
  p_facility_id bigint,
  p_notes text,
  p_lines jsonb  -- [{sku, bucket, counted_qty}]
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
  v_sys int;
  v_cnt int;
  v_bucket public.stock_bucket;
begin
  perform public.assert_facility_access(p_facility_id);
  v_no := public.next_doc_no('CNT');
  insert into public.stock_counts (count_no, facility_id, notes) values (v_no, p_facility_id, p_notes)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_bucket := coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable');
    v_cnt := (v_line ->> 'counted_qty')::int;
    if not exists (select 1 from public.items where sku = v_line ->> 'sku') then
      raise exception 'Unknown SKU %', v_line ->> 'sku';
    end if;
    select coalesce(max(qty), 0) into v_sys from public.stock_balances
    where facility_id = p_facility_id and sku = v_line ->> 'sku' and bucket = v_bucket;
    insert into public.stock_count_lines (count_id, sku, bucket, system_qty, counted_qty)
    values (v_id, v_line ->> 'sku', v_bucket, v_sys, v_cnt);
    if v_cnt <> v_sys then
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no)
      values (p_facility_id, v_line ->> 'sku', v_bucket, v_cnt - v_sys, 'count_adjustment', 'count', v_id, v_no);
    end if;
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: return to warehouse
create or replace function public.create_wh_return(
  p_facility_id bigint,
  p_header jsonb,  -- {warehouse_id, courier, awb_no, carton_count, notes}
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
begin
  perform public.assert_facility_access(p_facility_id);
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Add at least one SKU'; end if;
  v_no := public.next_doc_no('RTN');
  insert into public.wh_returns (return_no, facility_id, warehouse_id, courier, awb_no, carton_count, notes)
  values (v_no, p_facility_id, nullif(p_header ->> 'warehouse_id', '')::bigint, p_header ->> 'courier',
          p_header ->> 'awb_no', nullif(p_header ->> 'carton_count', '')::int, p_header ->> 'notes')
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_bucket := coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable');
    insert into public.wh_return_lines (return_id, sku, bucket, qty, reason)
    values (v_id, v_line ->> 'sku', v_bucket, (v_line ->> 'qty')::int, v_line ->> 'reason');
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
    values (p_facility_id, v_line ->> 'sku', v_bucket, -(v_line ->> 'qty')::int, 'return_to_wh', 'return', v_id, v_no,
            v_line ->> 'reason');
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: issue (training / demo / samples)
create or replace function public.create_stock_issue(
  p_facility_id bigint,
  p_purpose public.issue_purpose,
  p_issued_to text,
  p_notes text,
  p_lines jsonb  -- [{sku, bucket, qty}]
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
begin
  perform public.assert_facility_access(p_facility_id);
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Add at least one SKU'; end if;
  v_no := public.next_doc_no('ISS');
  insert into public.stock_issues (issue_no, facility_id, purpose, issued_to, notes)
  values (v_no, p_facility_id, p_purpose, p_issued_to, p_notes)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_bucket := coalesce((v_line ->> 'bucket')::public.stock_bucket, 'sellable');
    insert into public.stock_issue_lines (issue_id, sku, bucket, qty)
    values (v_id, v_line ->> 'sku', v_bucket, (v_line ->> 'qty')::int);
    insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
    values (p_facility_id, v_line ->> 'sku', v_bucket, -(v_line ->> 'qty')::int, 'issue', 'issue', v_id, v_no,
            p_purpose::text);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- RPC: move between buckets
create or replace function public.move_stock(
  p_facility_id bigint,
  p_sku text,
  p_from public.stock_bucket,
  p_to public.stock_bucket,
  p_qty int,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_facility_access(p_facility_id);
  if p_qty <= 0 or p_from = p_to then raise exception 'Invalid move'; end if;
  insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, note)
  values (p_facility_id, p_sku, p_from, -p_qty, 'bucket_transfer', 'move', p_note),
         (p_facility_id, p_sku, p_to, p_qty, 'bucket_transfer', 'move', p_note);
end;
$$;

-- ---------------------------------------------------------------- RPC: item master import (Uniware CSV)
create or replace function public.start_item_import(p_file_name text, p_total_rows int)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform public.assert_ops();
  insert into public.item_imports (file_name, total_rows) values (p_file_name, p_total_rows) returning id into v_id;
  return v_id;
end;
$$;

-- p_rows: CSV rows keyed by the Uniware export headers ("Product Code", "Name", "MRP", ...)
create or replace function public.import_items_chunk(p_import_id bigint, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ins int;
  v_upd int;
begin
  perform public.assert_ops();

  with src as (
    select distinct on (trim(r ->> 'Product Code')) r
    from jsonb_array_elements(p_rows) r
    where nullif(trim(r ->> 'Product Code'), '') is not null
    order by trim(r ->> 'Product Code')
  ), up as (
    insert into public.items as i (
      sku, name, description, category_code, category_name, sub_category, brand, color, size,
      scan_identifier, ean, hsn_code, gst_pct, base_price, cost_price, mrp, item_type, enabled,
      image_url, product_url, length_mm, width_mm, height_mm, weight_g, uniware_updated_at, last_import_id, updated_at
    )
    select
      trim(r ->> 'Product Code'),
      coalesce(nullif(trim(r ->> 'Name'), ''), trim(r ->> 'Product Code')),
      nullif(trim(r ->> 'Description'), ''),
      nullif(trim(r ->> 'Category Code'), ''),
      nullif(trim(r ->> 'Category Name'), ''),
      nullif(trim(r ->> 'Sub_category'), ''),
      nullif(upper(trim(r ->> 'Brand')), ''),
      nullif(trim(r ->> 'Color'), ''),
      nullif(trim(r ->> 'Size'), ''),
      nullif(trim(r ->> 'Scan Identifier'), ''),
      nullif(trim(r ->> 'EAN'), ''),
      nullif(trim(r ->> 'HSN CODE'), ''),
      public.try_numeric(r ->> 'GST Tax Type Code'),
      public.try_numeric(r ->> 'Base Price'),
      public.try_numeric(r ->> 'Cost Price'),
      public.try_numeric(r ->> 'MRP'),
      coalesce(nullif(upper(trim(r ->> 'Type')), ''), 'SIMPLE'),
      coalesce(lower(trim(r ->> 'Enabled')) = 'true', false),
      nullif(trim(r ->> 'Image Url'), ''),
      nullif(trim(r ->> 'Product Page Url'), ''),
      public.try_numeric(r ->> 'Length (mm)'),
      public.try_numeric(r ->> 'Width (mm)'),
      public.try_numeric(r ->> 'Height (mm)'),
      public.try_numeric(r ->> 'Weight (gms)'),
      case when (r ->> 'Updated') ~ '^\d{4}-\d{2}-\d{2}'
           then ((r ->> 'Updated')::timestamp at time zone 'Asia/Kolkata') end,
      p_import_id,
      now()
    from src
    on conflict (sku) do update set
      name = excluded.name, description = excluded.description, category_code = excluded.category_code,
      category_name = excluded.category_name, sub_category = excluded.sub_category, brand = excluded.brand,
      color = excluded.color, size = excluded.size, scan_identifier = excluded.scan_identifier, ean = excluded.ean,
      hsn_code = excluded.hsn_code, gst_pct = excluded.gst_pct, base_price = excluded.base_price,
      cost_price = excluded.cost_price, mrp = excluded.mrp, item_type = excluded.item_type, enabled = excluded.enabled,
      image_url = excluded.image_url, product_url = excluded.product_url, length_mm = excluded.length_mm,
      width_mm = excluded.width_mm, height_mm = excluded.height_mm, weight_g = excluded.weight_g,
      uniware_updated_at = excluded.uniware_updated_at, last_import_id = excluded.last_import_id, updated_at = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_ins, v_upd from up;

  -- bundle composition: one CSV row per component
  insert into public.bundle_components (bundle_sku, component_sku, qty, price)
  select distinct on (trim(r ->> 'Product Code'), trim(r ->> 'Component Product Code'))
    trim(r ->> 'Product Code'), trim(r ->> 'Component Product Code'),
    coalesce(public.try_numeric(r ->> 'Component Quantity'), 1), public.try_numeric(r ->> 'Component Price')
  from jsonb_array_elements(p_rows) r
  where upper(trim(r ->> 'Type')) = 'BUNDLE' and nullif(trim(r ->> 'Component Product Code'), '') is not null
  order by trim(r ->> 'Product Code'), trim(r ->> 'Component Product Code')
  on conflict (bundle_sku, component_sku) do update set qty = excluded.qty, price = excluded.price;

  update public.item_imports set inserted = inserted + v_ins, updated = updated + v_upd where id = p_import_id;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd);
end;
$$;

-- SKUs absent from a complete export are disabled (never deleted)
create or replace function public.finish_item_import(p_import_id bigint, p_disable_missing boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dis int := 0;
begin
  perform public.assert_ops();
  if p_disable_missing then
    update public.items set enabled = false, updated_at = now()
    where enabled and last_import_id is distinct from p_import_id;
    get diagnostics v_dis = row_count;
  end if;
  update public.item_imports set disabled = v_dis, status = 'done', finished_at = now() where id = p_import_id;
  return (select to_jsonb(x) from public.item_imports x where id = p_import_id);
end;
$$;

-- ---------------------------------------------------------------- reporting views (RLS of base tables applies)
create view public.v_stock with (security_invoker = true) as
select
  b.facility_id, f.code facility_code, f.name facility_name,
  b.sku, i.name item_name, i.category_name, i.size, i.color, i.enabled,
  b.bucket, b.qty,
  coalesce(a.msp, i.mrp, 0) msp,
  coalesce(a.msp, i.mrp, 0) * b.qty value_msp,
  coalesce(i.cost_price, 0) * b.qty value_cost,
  a.min_qty, a.max_qty,
  b.updated_at
from public.stock_balances b
join public.items i on i.sku = b.sku
join public.facilities f on f.id = b.facility_id
left join public.facility_assortment a on a.facility_id = b.facility_id and a.sku = b.sku;

create view public.v_request_lines with (security_invoker = true) as
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
  greatest(l.qty - coalesce(d.dispatched, 0), 0) pending_dispatch_qty
from public.order_request_lines l
join public.order_requests r on r.id = l.request_id
join public.items i on i.sku = l.sku
left join lateral (
  select sum(sl.qty) dispatched, sum(sl.qty) filter (where sl.is_substitute) substituted
  from public.shipment_lines sl where sl.request_line_id = l.id
) d on true
left join lateral (
  select sum(gl.received_qty) received, sum(gl.damaged_qty) damaged
  from public.grn_lines gl join public.shipment_lines sl on sl.id = gl.shipment_line_id
  where sl.request_line_id = l.id
) g on true;

create view public.v_sales_lines with (security_invoker = true) as
select
  s.id sale_id, s.sale_no, s.facility_id, f.code facility_code, f.name facility_name, s.sold_at,
  (s.sold_at at time zone 'Asia/Kolkata')::date sold_on,
  to_char(s.sold_at at time zone 'Asia/Kolkata', 'YYYY-MM') period,
  s.customer_name, s.customer_phone, s.bill_ref,
  l.sku, i.name item_name, i.category_name, l.bucket, l.qty, l.msp, l.margin_pct, l.gst_pct, l.payable_unit,
  round(l.msp * l.qty, 2) gross_msp,
  round(l.payable_unit * l.qty, 2) payable_total,
  round(l.payable_unit * l.qty / (1 + l.gst_pct / 100), 2) payable_taxable
from public.sales s
join public.sale_lines l on l.sale_id = s.id
join public.facilities f on f.id = s.facility_id
join public.items i on i.sku = l.sku;

-- ---------------------------------------------------------------- function privileges
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.auth_role(), public.auth_facility(), public.is_ops(), public.is_admin(), public.can_access_facility(bigint),
  public.price_for(bigint, text),
  public.create_order_request(bigint, bigint, text, jsonb), public.set_request_state(bigint, public.request_status),
  public.create_shipment(bigint, jsonb, jsonb), public.post_grn(bigint, jsonb, jsonb),
  public.add_grn_photo(bigint, bigint, text), public.create_sale(bigint, jsonb, jsonb),
  public.post_stock_count(bigint, text, jsonb), public.create_wh_return(bigint, jsonb, jsonb),
  public.create_stock_issue(bigint, public.issue_purpose, text, text, jsonb),
  public.move_stock(bigint, text, public.stock_bucket, public.stock_bucket, int, text),
  public.start_item_import(text, int), public.import_items_chunk(bigint, jsonb), public.finish_item_import(bigint, boolean)
to authenticated;
-- internal-only helpers
revoke execute on function public.next_doc_no(text), public.refresh_request_status(bigint),
  public.apply_ledger_to_balance(), public.handle_new_user(), public.assert_ops(), public.assert_facility_access(bigint),
  public.try_numeric(text)
from authenticated;

-- ---------------------------------------------------------------- storage: GRN photos (path: <facility_id>/<grn_id>/<file>)
insert into storage.buckets (id, name, public) values ('grn-photos', 'grn-photos', false)
on conflict (id) do nothing;

create policy "grn photos read" on storage.objects for select to authenticated
  using (bucket_id = 'grn-photos' and public.can_access_facility(((storage.foldername(name))[1])::bigint));
create policy "grn photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'grn-photos' and public.can_access_facility(((storage.foldername(name))[1])::bigint));
