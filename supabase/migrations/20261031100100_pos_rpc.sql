-- Frido POS: pricing, checkout, payments, returns, shifts, cash, admin and reporting functions.
-- The browser only reads pos_ tables (RLS); every write goes through these functions.
-- pos__* functions are internal helpers and are not callable by signed-in users.

-- ================================================================ internal helpers
-- Indian financial year of a moment, e.g. 2026-10-30 -> '2627', 2027-03-31 -> '2627'
create or replace function public.pos__fy(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when extract(month from p_at at time zone 'Asia/Kolkata') >= 4
    then to_char(p_at at time zone 'Asia/Kolkata', 'YY') || to_char((p_at at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
    else to_char((p_at at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || to_char(p_at at time zone 'Asia/Kolkata', 'YY')
  end
$$;

-- Next gap-free number in a series: SSSS/FYFY/NNNNNN (always 16 characters).
-- The counter row stays locked until the calling transaction ends; a rollback returns the number.
create or replace function public.pos__next_no(p_series text, p_fy text, out doc_no text, out seq int)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pos_series_counters as c (series_code, fy, last_no) values (p_series, p_fy, 1)
  on conflict (series_code, fy) do update set last_no = c.last_no + 1
  returning c.last_no into seq;
  doc_no := p_series || '/' || p_fy || '/' || lpad(seq::text, 6, '0');
end;
$$;

create or replace function public.pos__settings(p_facility_id bigint)
returns public.pos_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.pos_settings;
begin
  select * into v from public.pos_settings where facility_id = p_facility_id;
  if not found or not v.is_enabled then
    raise exception 'The POS is not set up for this facility' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Who is selling right now: resolves the PIN-switch token for this facility
create or replace function public.pos__staff(p_token text, p_facility_id bigint)
returns public.pos_staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.pos_staff;
begin
  select s.* into v
  from public.pos_staff_sessions t
  join public.pos_staff s on s.user_id = t.user_id
  where t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and t.revoked_at is null and t.expires_at > now()
    and t.facility_id = p_facility_id and s.is_active
    and (s.facility_id = p_facility_id or s.pos_role = 'admin');
  if not found then
    raise exception 'Enter your staff PIN again' using errcode = 'P0001', hint = 'pin_required';
  end if;
  return v;
end;
$$;

-- PIN check with lockout; returns an error message, or null when the PIN is right.
-- Never raises, so the failed-attempt count is kept.
create or replace function public.pos__check_pin(p_user_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.pos_staff;
begin
  select * into v from public.pos_staff where user_id = p_user_id for update;
  if not found or not v.is_active then return 'Unknown staff member'; end if;
  if v.pin_hash is null then return 'No PIN set for ' || v.display_name || '. Ask a Frido admin to set one.'; end if;
  if v.pin_locked_until > now() then
    return 'Too many wrong PINs. Try again after '
      || to_char(v.pin_locked_until at time zone 'Asia/Kolkata', 'HH24:MI') || '.';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' or extensions.crypt(p_pin, v.pin_hash) <> v.pin_hash then
    update public.pos_staff
    set pin_failed = case when pin_failed + 1 >= 5 then 0 else pin_failed + 1 end,
        pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '5 minutes' else pin_locked_until end
    where user_id = p_user_id;
    return case when v.pin_failed + 1 >= 5 then 'Wrong PIN. Locked for 5 minutes.'
                else 'Wrong PIN. ' || (4 - v.pin_failed) || ' tries left.' end;
  end if;
  update public.pos_staff set pin_failed = 0, pin_locked_until = null where user_id = p_user_id;
  return null;
end;
$$;

-- Prices a cart at the facility's MSP: line and cart discounts (cart discount pro-rated to lines for GST),
-- GST split, stock availability. Strict mode raises on the first problem and locks the stock rows it checks.
create or replace function public.pos__price(
  p_facility_id bigint,
  p_lines jsonb,          -- [{sku, qty, disc_kind: 'pct'|'amount', disc_value}]
  p_cart_discount jsonb,  -- {kind: 'pct'|'amount', value} or null
  p_strict boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.pos_settings;
  v_entity public.pos_entities;
  v_n int := jsonb_array_length(coalesce(p_lines, '[]'));
  v_l jsonb;
  v_i int;
  v_sku text;
  v_qty int;
  v_item record;
  v_kind text;
  v_val numeric;
  v_gross numeric;
  v_own numeric;
  v_skus text[] := '{}';
  v_qtys int[] := '{}';
  v_grosses numeric[] := '{}';
  v_owns numeric[] := '{}';
  v_items jsonb[] := '{}';
  v_problems jsonb := '[]';
  v_base numeric := 0;
  v_cd numeric := 0;
  v_cd_kind text := nullif(p_cart_discount ->> 'kind', '');
  v_cd_val numeric := coalesce(nullif(p_cart_discount ->> 'value', '')::numeric, 0);
  v_alloc numeric := 0;
  v_share numeric;
  v_net numeric;
  v_taxable numeric;
  v_tax numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_pct numeric;
  v_lines jsonb := '[]';
  v_t_gross numeric := 0;
  v_t_disc numeric := 0;
  v_t_net numeric := 0;
  v_t_taxable numeric := 0;
  v_t_cgst numeric := 0;
  v_t_sgst numeric := 0;
  v_t_igst numeric := 0;
  v_max numeric := 0;
  v_grand numeric;
  v_intra boolean;
  v_stock record;
  v_have int;
  v_held int;
  v_skip text[] := '{}';   -- SKUs that cannot be sold here at all; no point reporting their stock
begin
  v_settings := public.pos__settings(p_facility_id);
  select * into v_entity from public.pos_entities where id = v_settings.entity_id;
  v_intra := true;  -- counter sale: place of supply is the facility's state (Decision 1)

  if v_n = 0 then
    if p_strict then raise exception 'The cart is empty' using errcode = 'P0001'; end if;
  end if;
  if v_n > 100 then raise exception 'Too many lines in one bill (max 100)' using errcode = 'P0001'; end if;

  -- 1. each line at MSP with its own discount
  for v_i in 0 .. v_n - 1 loop
    v_l := p_lines -> v_i;
    v_sku := trim(v_l ->> 'sku');
    v_qty := coalesce(nullif(v_l ->> 'qty', '')::int, 0);
    select i.sku, i.name, i.size, i.color, i.category_name, i.hsn_code, i.gst_pct, i.mrp, i.enabled,
           a.msp, a.sku is not null as in_assortment,
           exists (select 1 from public.pos_service_skus s where s.sku = i.sku) as is_service
    into v_item
    from public.items i
    left join public.facility_assortment a on a.facility_id = p_facility_id and a.sku = i.sku and a.is_active
    where i.sku = v_sku;

    if not found then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'unknown',
        'message', format('%s is not a Frido SKU', v_sku));
      v_skip := v_skip || v_sku;
    elsif not v_item.in_assortment then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'not_in_assortment',
        'message', format('%s is not sold at this clinic', v_sku));
      v_skip := v_skip || v_sku;
    elsif not v_item.enabled then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'disabled',
        'message', format('%s is disabled in the item master', v_sku));
    elsif v_item.msp is null or v_item.msp <= 0 then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'no_price',
        'message', format('%s has no selling price (MSP) for this clinic', v_sku));
    elsif nullif(trim(v_item.hsn_code), '') is null then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'no_hsn',
        'message', format('%s has no HSN code in the item master', v_sku));
    elsif v_item.gst_pct is null or v_item.gst_pct not in (0, 5, 12, 18, 28, 40) then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'bad_gst',
        'message', format('%s has no valid GST rate (%s)', v_sku, coalesce(v_item.gst_pct::text, 'blank')));
    end if;
    if v_qty < 1 or v_qty > 999 then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'qty',
        'message', 'Quantity must be between 1 and 999');
      v_qty := greatest(least(v_qty, 999), 1);
    end if;

    v_gross := round(coalesce(v_item.msp, 0) * v_qty, 2);
    v_kind := nullif(v_l ->> 'disc_kind', '');
    v_val := coalesce(nullif(v_l ->> 'disc_value', '')::numeric, 0);
    if v_val < 0 then
      v_problems := v_problems || jsonb_build_object('line_no', v_i + 1, 'sku', v_sku, 'code', 'discount',
        'message', 'A discount cannot be negative');
      v_val := 0;
    end if;
    v_own := case v_kind
      when 'pct' then round(v_gross * least(v_val, 100) / 100, 2)
      when 'amount' then least(round(v_val, 2), v_gross)
      else 0 end;

    v_skus := v_skus || v_sku;
    v_qtys := v_qtys || v_qty;
    v_grosses := v_grosses || v_gross;
    v_owns := v_owns || v_own;
    v_items := v_items || jsonb_build_object(
      'sku', v_sku, 'name', coalesce(v_item.name, v_sku), 'size', v_item.size, 'color', v_item.color,
      'category_name', v_item.category_name, 'hsn_code', v_item.hsn_code, 'gst_pct', coalesce(v_item.gst_pct, 0),
      'unit_price', coalesce(v_item.msp, 0),
      'mrp', case when v_item.mrp > v_item.msp then v_item.mrp end,   -- Uniware MRP is often a Rs 50 placeholder
      'is_service', coalesce(v_item.is_service, false),
      'disc_kind', case when v_own > 0 then v_kind end, 'disc_value', case when v_own > 0 then v_val end);
    v_base := v_base + v_gross - v_own;
  end loop;

  -- 2. stock: sellable on hand less what unpaid POS drafts are holding; rows locked in SKU order in strict mode
  for v_stock in
    select x.sku, sum(x.qty)::int as qty
    from unnest(v_skus, v_qtys) with ordinality as x (sku, qty, ord)
    where not coalesce((v_items[x.ord::int] ->> 'is_service')::boolean, false) and not (x.sku = any (v_skip))
    group by x.sku order by x.sku
  loop
    if p_strict then
      select qty into v_have from public.stock_balances
      where facility_id = p_facility_id and sku = v_stock.sku and bucket = 'sellable' for update;
    else
      select qty into v_have from public.stock_balances
      where facility_id = p_facility_id and sku = v_stock.sku and bucket = 'sellable';
    end if;
    select coalesce(sum(l.qty), 0) into v_held
    from public.pos_invoice_lines l join public.pos_invoices i on i.id = l.invoice_id
    where i.facility_id = p_facility_id and i.status = 'awaiting_payment' and l.sku = v_stock.sku and not l.is_service;
    if coalesce(v_have, 0) - v_held < v_stock.qty then
      v_problems := v_problems || jsonb_build_object('sku', v_stock.sku, 'code', 'insufficient_stock',
        'available', greatest(coalesce(v_have, 0) - v_held, 0),
        'message', format('Only %s of %s in stock', greatest(coalesce(v_have, 0) - v_held, 0), v_stock.sku));
    end if;
  end loop;

  -- 3. cart discount, pro-rated to lines; the last line takes the rounding remainder
  if v_cd_val < 0 then
    v_problems := v_problems || jsonb_build_object('code', 'discount', 'message', 'A discount cannot be negative');
    v_cd_val := 0;
  end if;
  v_cd := case v_cd_kind
    when 'pct' then round(v_base * least(v_cd_val, 100) / 100, 2)
    when 'amount' then least(round(v_cd_val, 2), v_base)
    else 0 end;

  for v_i in 1 .. v_n loop
    if v_base > 0 and v_cd > 0 then
      v_share := case when v_i = v_n then v_cd - v_alloc
                      else round(v_cd * (v_grosses[v_i] - v_owns[v_i]) / v_base, 2) end;
    else
      v_share := 0;
    end if;
    v_alloc := v_alloc + v_share;
    v_net := v_grosses[v_i] - v_owns[v_i] - v_share;
    v_taxable := round(v_net / (1 + (v_items[v_i] ->> 'gst_pct')::numeric / 100), 2);
    v_tax := v_net - v_taxable;
    if v_intra then
      v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;
    v_pct := case when v_grosses[v_i] > 0 then round((v_owns[v_i] + v_share) * 100 / v_grosses[v_i], 2) else 0 end;
    v_max := greatest(v_max, v_pct);
    v_lines := v_lines || (v_items[v_i] || jsonb_build_object(
      'line_no', v_i, 'qty', v_qtys[v_i], 'gross', v_grosses[v_i], 'line_discount', v_owns[v_i],
      'cart_discount', v_share, 'disc_pct', v_pct, 'net_amount', v_net, 'taxable', v_taxable,
      'cgst', v_cgst, 'sgst', v_sgst, 'igst', v_igst));
    v_t_gross := v_t_gross + v_grosses[v_i];
    v_t_disc := v_t_disc + v_owns[v_i] + v_share;
    v_t_net := v_t_net + v_net;
    v_t_taxable := v_t_taxable + v_taxable;
    v_t_cgst := v_t_cgst + v_cgst;
    v_t_sgst := v_t_sgst + v_sgst;
    v_t_igst := v_t_igst + v_igst;
  end loop;

  v_grand := round(v_t_net, 0);

  if p_strict and jsonb_array_length(v_problems) > 0 then
    raise exception '%', v_problems -> 0 ->> 'message' using errcode = 'P0001', detail = v_problems::text;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'problems', v_problems,
    'cart_discount', case when v_cd > 0 then jsonb_build_object('kind', v_cd_kind, 'value', v_cd_val, 'amount', v_cd) end,
    'gross_total', v_t_gross, 'discount_total', v_t_disc, 'net_total', v_t_net,
    'taxable_total', v_t_taxable, 'cgst_total', v_t_cgst, 'sgst_total', v_t_sgst, 'igst_total', v_t_igst,
    'round_off', v_grand - v_t_net, 'grand_total', v_grand,
    'max_disc_pct', v_max, 'intra_state', v_intra, 'place_of_supply', v_entity.state_code,
    'limits', jsonb_build_object('cashier', v_settings.cashier_max_disc_pct, 'manager', v_settings.manager_max_disc_pct));
end;
$$;

create or replace function public.pos__invoice_summary(p_invoice_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'client_ref', i.client_ref, 'invoice_no', i.invoice_no, 'status', i.status,
    'grand_total', i.grand_total, 'share_token', i.share_token, 'attention_reason', i.attention_reason,
    'paid_total', coalesce((select sum(p.amount) from public.pos_payments p
                            where p.invoice_id = i.id and p.status = 'confirmed'), 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'mode', p.mode, 'amount', p.amount,
                            'status', p.status, 'reference', p.reference, 'tendered', p.tendered) order by p.id)
                          from public.pos_payments p where p.invoice_id = i.id), '[]'))
  from public.pos_invoices i where i.id = p_invoice_id
$$;

-- Numbers the invoice and posts it to the Partner Hub (stock + consignment settlement) via create_sale.
-- Raises if anything fails; callers decide whether that rolls back the whole checkout.
create or replace function public.pos__finalize(p_invoice_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.pos_invoices;
  v_paid numeric;
  v_series text;
  v_no record;
  v_sale bigint;
  v_lines jsonb;
begin
  select * into v_inv from public.pos_invoices where id = p_invoice_id for update;
  if v_inv.status = 'paid' then return; end if;
  if v_inv.status = 'cancelled' then raise exception 'This draft was cancelled' using errcode = 'P0001'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.pos_payments where invoice_id = p_invoice_id and status = 'confirmed';
  if v_paid < v_inv.grand_total then
    raise exception 'Invoice is not fully paid (% of %)', v_paid, v_inv.grand_total using errcode = 'P0001';
  end if;

  select code into v_series from public.pos_series where facility_id = v_inv.facility_id and doc_type = 'invoice' and is_active;
  if v_series is null then raise exception 'No invoice series is set up for this facility' using errcode = 'P0001'; end if;
  select * into v_no from public.pos__next_no(v_series, public.pos__fy(now()));

  select jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty, 'bucket', bucket) order by line_no) into v_lines
  from public.pos_invoice_lines where invoice_id = p_invoice_id and not is_service;

  if v_lines is not null then
    -- a gateway webhook runs without a user; post the sale as the cashier who rang it up
    if auth.uid() is null then
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', v_inv.created_by, 'role', 'authenticated')::text, true);
    end if;
    v_sale := public.create_sale(
      v_inv.facility_id,
      jsonb_build_object('customer_name', v_inv.customer_name, 'customer_phone', v_inv.customer_phone,
                         'bill_ref', v_no.doc_no, 'notes', 'POS invoice ' || v_no.doc_no),
      v_lines);
  end if;

  update public.pos_invoices
  set status = 'paid', invoice_no = v_no.doc_no, series_code = v_series, fy = public.pos__fy(now()), seq = v_no.seq,
      invoiced_at = now(), hub_sale_id = v_sale, attention_reason = null
  where id = p_invoice_id;
end;
$$;

-- After a payment is confirmed: finalise if fully paid. A failure never loses the confirmed payment;
-- the invoice goes to the manager's Needs attention list instead (Lesson 1).
create or replace function public.pos__try_finalize(p_invoice_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.pos_invoices;
  v_paid numeric;
begin
  select * into v_inv from public.pos_invoices where id = p_invoice_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.pos_payments where invoice_id = p_invoice_id and status = 'confirmed';
  if v_inv.status in ('awaiting_payment', 'needs_attention') and v_paid >= v_inv.grand_total then
    begin
      perform public.pos__finalize(p_invoice_id);
    exception when others then
      update public.pos_invoices set status = 'needs_attention', attention_reason = sqlerrm where id = p_invoice_id;
    end;
  end if;
  return public.pos__invoice_summary(p_invoice_id);
end;
$$;

-- ================================================================ session, PIN, context
create or replace function public.pos_context(p_facility_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_fac bigint;
  v_settings public.pos_settings;
begin
  select * into v_profile from public.profiles where id = auth.uid() and is_active;
  if not found then raise exception 'Your account is not active yet' using errcode = '42501'; end if;
  v_fac := coalesce(p_facility_id, v_profile.facility_id);
  if v_fac is not null then perform public.assert_facility_access(v_fac); end if;
  select * into v_settings from public.pos_settings where facility_id = v_fac;

  return jsonb_build_object(
    'user', jsonb_build_object('id', v_profile.id, 'email', v_profile.email, 'full_name', v_profile.full_name,
      'hub_role', v_profile.role, 'facility_id', v_profile.facility_id, 'is_ops', public.is_ops(),
      'pos_role', (select pos_role from public.pos_staff where user_id = v_profile.id and is_active)),
    'facilities', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name) order by f.name), '[]')
                   from public.facilities f join public.pos_settings s on s.facility_id = f.id
                   where s.is_enabled and public.can_access_facility(f.id)),
    'facility', (select jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'city', f.city, 'state', f.state,
                   'address', f.address) from public.facilities f where f.id = v_fac),
    'settings', case when v_settings.facility_id is not null then to_jsonb(v_settings) end,
    'entity', (select jsonb_build_object('id', e.id, 'code', e.code, 'kind', e.kind, 'legal_name', e.legal_name,
                 'gstin', e.gstin, 'state_code', e.state_code, 'upi_vpa', e.upi_vpa, 'upi_payee_name', e.upi_payee_name,
                 'razorpay_enabled', e.razorpay_enabled)
               from public.pos_entities e where e.id = v_settings.entity_id),
    'series', (select jsonb_object_agg(doc_type, code) from public.pos_series where facility_id = v_fac and is_active),
    'registers', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'printer', r.printer,
                     'scan_mode', r.scan_mode,
                     'open_shift', (select jsonb_build_object('id', sh.id, 'opened_at', sh.opened_at,
                                      'opening_float', sh.opening_float, 'opened_by', st.display_name)
                                    from public.pos_shifts sh join public.pos_staff st on st.user_id = sh.opened_by
                                    where sh.register_id = r.id and sh.status = 'open')) order by r.name), '[]')
                  from public.pos_registers r where r.facility_id = v_fac and r.is_active),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'display_name', s.display_name,
                  'pos_role', s.pos_role, 'has_pin', s.pin_hash is not null) order by s.pos_role desc, s.display_name), '[]')
              from public.pos_staff s where s.is_active and (s.facility_id = v_fac or s.pos_role = 'admin')),
    'therapists', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind) order by t.name), '[]')
                   from public.pos_therapists t where t.facility_id = v_fac and t.is_active)
  );
end;
$$;

-- PIN switch: proves who is at the till and returns a 12-hour staff token
create or replace function public.pos_pin_login(p_facility_id bigint, p_register_id bigint, p_user_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.pos_staff;
  v_err text;
  v_token text;
  v_exp timestamptz := now() + interval '12 hours';
begin
  perform public.assert_facility_access(p_facility_id);
  perform public.pos__settings(p_facility_id);
  if p_register_id is not null and not exists (
    select 1 from public.pos_registers where id = p_register_id and facility_id = p_facility_id and is_active) then
    raise exception 'Unknown till' using errcode = 'P0001';
  end if;
  select * into v_staff from public.pos_staff where user_id = p_user_id;
  if not found or (v_staff.facility_id is distinct from p_facility_id and v_staff.pos_role <> 'admin') then
    return jsonb_build_object('ok', false, 'error', 'This person is not on this clinic''s POS staff list');
  end if;
  v_err := public.pos__check_pin(p_user_id, p_pin);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.pos_staff_sessions (token_hash, user_id, facility_id, register_id, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_user_id, p_facility_id, p_register_id, v_exp);
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp,
    'staff', jsonb_build_object('user_id', v_staff.user_id, 'display_name', v_staff.display_name, 'pos_role', v_staff.pos_role));
end;
$$;

create or replace function public.pos_pin_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pos_staff_sessions set revoked_at = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null
    and (device_user = (select auth.uid()) or user_id = (select auth.uid()))
$$;

-- ================================================================ pricing and discount approval
create or replace function public.pos_price_cart(p_facility_id bigint, p_cart jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_facility_access(p_facility_id);
  return public.pos__price(p_facility_id, p_cart -> 'lines', p_cart -> 'cart_discount', false);
end;
$$;

-- A manager (up to the manager limit) or a Frido admin (any %) approves a discount with their PIN
create or replace function public.pos_approve_discount(
  p_facility_id bigint, p_requester_token text, p_approver_id uuid, p_pin text, p_pct numeric, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.pos_settings;
  v_requester public.pos_staff;
  v_approver public.pos_staff;
  v_err text;
  v_id bigint;
begin
  perform public.assert_facility_access(p_facility_id);
  v_settings := public.pos__settings(p_facility_id);
  v_requester := public.pos__staff(p_requester_token, p_facility_id);
  if nullif(trim(p_reason), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Give a reason for the discount');
  end if;
  if p_pct is null or p_pct <= 0 or p_pct > 100 then
    return jsonb_build_object('ok', false, 'error', 'Invalid discount %');
  end if;
  select * into v_approver from public.pos_staff where user_id = p_approver_id and is_active;
  if not found or v_approver.pos_role = 'cashier'
     or (v_approver.pos_role = 'manager' and v_approver.facility_id is distinct from p_facility_id) then
    return jsonb_build_object('ok', false, 'error', 'Only a manager of this clinic or a Frido admin can approve');
  end if;
  if v_approver.pos_role = 'manager' and p_pct > v_settings.manager_max_disc_pct then
    return jsonb_build_object('ok', false, 'error',
      format('Managers can approve up to %s%%. Above that a Frido admin must approve.', v_settings.manager_max_disc_pct));
  end if;
  v_err := public.pos__check_pin(p_approver_id, p_pin);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  insert into public.pos_discount_approvals (facility_id, requested_by, approver_id, approver_level, approved_pct, reason, expires_at)
  values (p_facility_id, v_requester.user_id, p_approver_id, case v_approver.pos_role when 'admin' then 'admin' else 'manager' end,
          round(p_pct, 2), trim(p_reason), now() + interval '15 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'approval_id', v_id, 'approved_pct', round(p_pct, 2),
    'approver', v_approver.display_name, 'level', case v_approver.pos_role when 'admin' then 'admin' else 'manager' end);
end;
$$;

-- ================================================================ customers
create or replace function public.pos_upsert_customer(p_facility_id bigint, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := right(regexp_replace(coalesce(p_customer ->> 'phone', ''), '\D', '', 'g'), 10);
  v_consent boolean := coalesce((p_customer ->> 'marketing_consent')::boolean, false);
  v_row public.pos_customers;
begin
  perform public.assert_facility_access(p_facility_id);
  perform public.pos__settings(p_facility_id);
  if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number' using errcode = 'P0001'; end if;

  insert into public.pos_customers as c (facility_id, phone, name, email, gstin, company_name, lead_source,
                                         marketing_consent, consent_at, consent_channel)
  values (p_facility_id, v_phone, nullif(trim(p_customer ->> 'name'), ''), nullif(lower(trim(p_customer ->> 'email')), ''),
          nullif(upper(trim(p_customer ->> 'gstin')), ''), nullif(trim(p_customer ->> 'company_name'), ''),
          nullif(p_customer ->> 'lead_source', ''), v_consent, case when v_consent then now() end,
          case when v_consent then coalesce(nullif(p_customer ->> 'consent_channel', ''), 'pos_counter') end)
  on conflict (facility_id, phone) do update set
    name = coalesce(excluded.name, c.name),
    email = coalesce(excluded.email, c.email),
    gstin = case when p_customer ? 'gstin' then excluded.gstin else c.gstin end,
    company_name = case when p_customer ? 'company_name' then excluded.company_name else c.company_name end,
    lead_source = coalesce(c.lead_source, excluded.lead_source),     -- first answer wins
    marketing_consent = case when p_customer ? 'marketing_consent' then excluded.marketing_consent else c.marketing_consent end,
    consent_at = case when not (p_customer ? 'marketing_consent') then c.consent_at
                      when excluded.marketing_consent and c.marketing_consent then c.consent_at
                      else excluded.consent_at end,
    consent_channel = case when not (p_customer ? 'marketing_consent') then c.consent_channel
                           when excluded.marketing_consent and c.marketing_consent then c.consent_channel
                           else excluded.consent_channel end,
    updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object(
    'visits', (select count(*) from public.pos_invoices i where i.customer_id = v_row.id and i.status = 'paid'),
    'last_visit', (select max(invoiced_at) from public.pos_invoices i where i.customer_id = v_row.id and i.status = 'paid'));
end;
$$;

-- ================================================================ shifts and cash
create or replace function public.pos_open_shift(p_facility_id bigint, p_register_id bigint, p_staff_token text, p_opening_float numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.pos_staff;
  v_shift public.pos_shifts;
begin
  perform public.assert_facility_access(p_facility_id);
  perform public.pos__settings(p_facility_id);
  v_staff := public.pos__staff(p_staff_token, p_facility_id);
  if not exists (select 1 from public.pos_registers where id = p_register_id and facility_id = p_facility_id and is_active) then
    raise exception 'Unknown till' using errcode = 'P0001';
  end if;
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'Enter the opening cash float (0 or more)' using errcode = 'P0001';
  end if;
  select * into v_shift from public.pos_shifts where register_id = p_register_id and status = 'open';
  if found then return to_jsonb(v_shift) || '{"existing": true}'; end if;
  begin
    insert into public.pos_shifts (facility_id, register_id, opened_by, opening_float)
    values (p_facility_id, p_register_id, v_staff.user_id, round(p_opening_float, 2))
    returning * into v_shift;
  exception when unique_violation then
    select * into v_shift from public.pos_shifts where register_id = p_register_id and status = 'open';
    return to_jsonb(v_shift) || '{"existing": true}';
  end;
  return to_jsonb(v_shift);
end;
$$;

-- X/Z report for a shift: takings by mode and staff, cash movements, expected cash in the drawer
create or replace function public.pos__shift_report(p_shift_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sh as (
    select s.*, r.name as register_name from public.pos_shifts s join public.pos_registers r on r.id = s.register_id
    where s.id = p_shift_id
  ), pay as (
    select p.mode, p.status, sum(p.amount) as amount, count(*) as n
    from public.pos_payments p join public.pos_invoices i on i.id = p.invoice_id
    where p.shift_id = p_shift_id and i.status <> 'cancelled'
    group by p.mode, p.status
  ), inv as (
    select i.* from public.pos_invoices i where i.shift_id = p_shift_id and i.status = 'paid'
  ), mv as (
    select kind, sum(amount) as amount from public.pos_cash_movements where shift_id = p_shift_id group by kind
  ), totals as (
    select
      coalesce((select amount from pay where mode = 'cash' and status = 'confirmed'), 0) as cash_sales,
      coalesce((select amount from mv where kind = 'cash_in'), 0) as cash_in,
      coalesce((select amount from mv where kind = 'petty_cash'), 0) as petty_cash,
      coalesce((select amount from mv where kind = 'bank_deposit'), 0) as bank_deposit
  )
  select jsonb_build_object(
    'shift_id', sh.id, 'register', sh.register_name, 'status', sh.status, 'opened_at', sh.opened_at,
    'closed_at', sh.closed_at, 'opening_float', sh.opening_float,
    'opened_by', (select display_name from public.pos_staff where user_id = sh.opened_by),
    'invoices', (select count(*) from inv),
    'gross_total', (select coalesce(sum(gross_total), 0) from inv),
    'discount_total', (select coalesce(sum(discount_total), 0) from inv),
    'sales_total', (select coalesce(sum(grand_total), 0) from inv),
    'tax_total', (select coalesce(sum(cgst_total + sgst_total + igst_total), 0) from inv),
    'by_mode', (select coalesce(jsonb_object_agg(mode, amount), '{}') from pay where status = 'confirmed'),
    'pending_by_mode', (select coalesce(jsonb_object_agg(mode, amount), '{}') from pay where status = 'pending'),
    'by_staff', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]') from (
                   select jsonb_build_object('name', st.display_name, 'invoices', count(*), 'sales', sum(i.grand_total)) x
                   from inv i join public.pos_staff st on st.user_id = i.seller_id group by st.display_name) s),
    'credit_notes', (select count(*) from public.pos_credit_notes c where c.shift_id = p_shift_id),
    'credit_total', (select coalesce(sum(grand_total), 0) from public.pos_credit_notes c where c.shift_id = p_shift_id),
    'open_drafts', (select count(*) from public.pos_invoices i where i.shift_id = p_shift_id and i.status in ('awaiting_payment', 'needs_attention')),
    'cash_sales', t.cash_sales, 'cash_in', t.cash_in, 'petty_cash', t.petty_cash, 'bank_deposit', t.bank_deposit,
    'expected_cash', sh.opening_float + t.cash_sales + t.cash_in - t.petty_cash - t.bank_deposit,
    'counted_cash', sh.counted_cash, 'variance', sh.variance, 'close_note', sh.close_note,
    'closed_by', (select display_name from public.pos_staff where user_id = sh.closed_by))
  from sh cross join totals t
$$;

create or replace function public.pos_shift_report(p_shift_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fac bigint;
begin
  select facility_id into v_fac from public.pos_shifts where id = p_shift_id;
  if not found then raise exception 'Shift not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_fac);
  return public.pos__shift_report(p_shift_id);
end;
$$;

create or replace function public.pos_add_cash_movement(
  p_shift_id bigint, p_staff_token text, p_kind text, p_amount numeric, p_category text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts;
  v_staff public.pos_staff;
  v_expected numeric;
  v_row public.pos_cash_movements;
begin
  select * into v_shift from public.pos_shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_shift.facility_id);
  v_staff := public.pos__staff(p_staff_token, v_shift.facility_id);
  if v_shift.status <> 'open' then raise exception 'This shift is closed' using errcode = 'P0001'; end if;
  if p_kind not in ('petty_cash', 'bank_deposit', 'cash_in') then raise exception 'Unknown cash movement' using errcode = 'P0001'; end if;
  if p_kind in ('petty_cash', 'bank_deposit') and v_staff.pos_role = 'cashier' then
    raise exception 'Petty cash and bank deposits need a manager' using errcode = 'P0001', hint = 'manager_required';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount' using errcode = 'P0001'; end if;
  if p_kind = 'petty_cash' and nullif(trim(p_category), '') is null then
    raise exception 'Choose a petty cash category' using errcode = 'P0001';
  end if;
  if p_kind in ('petty_cash', 'bank_deposit') then
    v_expected := (public.pos__shift_report(p_shift_id) ->> 'expected_cash')::numeric;
    if round(p_amount, 2) > v_expected then
      raise exception 'Only ₹% cash should be in the drawer', v_expected using errcode = 'P0001';
    end if;
  end if;
  insert into public.pos_cash_movements (facility_id, shift_id, kind, category, amount, note, staff_id)
  values (v_shift.facility_id, p_shift_id, p_kind, nullif(trim(p_category), ''), round(p_amount, 2), nullif(trim(p_note), ''), v_staff.user_id)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.pos_close_shift(p_shift_id bigint, p_staff_token text, p_counted_cash numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts;
  v_staff public.pos_staff;
  v_report jsonb;
  v_expected numeric;
begin
  select * into v_shift from public.pos_shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_shift.facility_id);
  v_staff := public.pos__staff(p_staff_token, v_shift.facility_id);
  if v_staff.pos_role = 'cashier' then
    raise exception 'Closing the day needs a manager' using errcode = 'P0001', hint = 'manager_required';
  end if;
  if v_shift.status = 'closed' then return v_shift.z_report; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash you counted' using errcode = 'P0001'; end if;
  v_report := public.pos__shift_report(p_shift_id);
  v_expected := (v_report ->> 'expected_cash')::numeric;
  if round(p_counted_cash, 2) <> v_expected and nullif(trim(p_note), '') is null then
    raise exception 'Cash is off by ₹%. Add a note explaining the difference.', round(p_counted_cash, 2) - v_expected
      using errcode = 'P0001', hint = 'variance_note_required';
  end if;
  update public.pos_shifts
  set status = 'closed', closed_by = v_staff.user_id, closed_at = now(), expected_cash = v_expected,
      counted_cash = round(p_counted_cash, 2), variance = round(p_counted_cash, 2) - v_expected,
      close_note = nullif(trim(p_note), '')
  where id = p_shift_id;
  v_report := public.pos__shift_report(p_shift_id);
  update public.pos_shifts set z_report = v_report where id = p_shift_id;
  return v_report;
end;
$$;

-- ================================================================ checkout
-- One transaction: validate cart, prices, stock and discount authority; record payments; and when the money is
-- in, number the invoice gap-free and post it to the Hub with create_sale. Idempotent on p_client_ref.
create or replace function public.pos_checkout(
  p_client_ref uuid,
  p_facility_id bigint,
  p_register_id bigint,
  p_staff_token text,
  p_cart jsonb,       -- {lines, cart_discount, customer_id, therapist_id, approval_id, notes}
  p_payments jsonb    -- [{mode, amount, reference, tendered, credit_note_id}]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pos_invoices;
  v_settings public.pos_settings;
  v_entity public.pos_entities;
  v_staff public.pos_staff;
  v_shift public.pos_shifts;
  v_fac public.facilities;
  v_price jsonb;
  v_max numeric;
  v_allow numeric;
  v_approval public.pos_discount_approvals;
  v_approval_id bigint;
  v_customer public.pos_customers;
  v_therapist bigint;
  v_pay jsonb;
  v_mode text;
  v_amount numeric;
  v_ref text;
  v_status text;
  v_cn public.pos_credit_notes;
  v_pay_total numeric := 0;
  v_all_confirmed boolean := true;
  v_id bigint;
  v_line jsonb;
begin
  if p_client_ref is null then raise exception 'Missing checkout reference' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos_checkout:' || p_client_ref::text, 0));
  select * into v_existing from public.pos_invoices where client_ref = p_client_ref;
  if found then
    perform public.assert_facility_access(v_existing.facility_id);
    if v_existing.facility_id <> p_facility_id then
      raise exception 'This checkout reference belongs to another facility' using errcode = 'P0001';
    end if;
    return public.pos__invoice_summary(v_existing.id) || '{"replay": true}';
  end if;

  perform public.assert_facility_access(p_facility_id);
  v_settings := public.pos__settings(p_facility_id);
  v_staff := public.pos__staff(p_staff_token, p_facility_id);
  select * into v_entity from public.pos_entities where id = v_settings.entity_id;
  select * into v_fac from public.facilities where id = p_facility_id;
  select * into v_shift from public.pos_shifts s
  where s.register_id = p_register_id and s.facility_id = p_facility_id and s.status = 'open';
  if not found then raise exception 'Open a shift on this till first' using errcode = 'P0001', hint = 'shift_required'; end if;

  -- prices, stock (locked), GST
  v_price := public.pos__price(p_facility_id, p_cart -> 'lines', p_cart -> 'cart_discount', true);

  -- discount authority (Decision 6): cashier limit, manager limit, Frido admin above that
  v_max := (v_price ->> 'max_disc_pct')::numeric;
  v_allow := case v_staff.pos_role when 'cashier' then v_settings.cashier_max_disc_pct
                                   when 'manager' then v_settings.manager_max_disc_pct else 100 end;
  if v_max > v_allow then
    select * into v_approval from public.pos_discount_approvals
    where id = nullif(p_cart ->> 'approval_id', '')::bigint and facility_id = p_facility_id for update;
    if not found or v_approval.used_at is not null or v_approval.expires_at < now() then
      raise exception '%', case when v_max > v_settings.manager_max_disc_pct
                                then format('Discount of %s%% needs a Frido admin''s approval', trim_scale(v_max))
                                else format('Discount of %s%% needs a manager''s PIN', trim_scale(v_max)) end
        using errcode = 'P0001', hint = 'approval_required';
    end if;
    if v_approval.approved_pct < v_max
       or (v_approval.approver_level = 'manager' and v_max > v_settings.manager_max_disc_pct) then
      raise exception '%', format('The approval covers %s%%, but this bill has %s%%', trim_scale(v_approval.approved_pct), trim_scale(v_max))
        using errcode = 'P0001', hint = 'approval_required';
    end if;
    v_approval_id := v_approval.id;
  elsif v_max > v_settings.cashier_max_disc_pct then
    -- a manager selling above the cashier limit approves their own discount; it is still logged
    insert into public.pos_discount_approvals (facility_id, requested_by, approver_id, approver_level, approved_pct, reason, expires_at)
    values (p_facility_id, v_staff.user_id, v_staff.user_id, case v_staff.pos_role when 'admin' then 'admin' else 'manager' end,
            v_max, 'Own sale by ' || v_staff.display_name, now())
    returning id into v_approval_id;
  end if;

  -- customer and therapist
  if nullif(p_cart ->> 'customer_id', '') is not null then
    select * into v_customer from public.pos_customers
    where id = (p_cart ->> 'customer_id')::bigint and facility_id = p_facility_id;
    if not found then raise exception 'Customer not found at this clinic' using errcode = 'P0001'; end if;
  elsif v_settings.require_customer then
    raise exception 'Add the customer''s mobile number' using errcode = 'P0001', hint = 'customer_required';
  end if;
  if nullif(p_cart ->> 'therapist_id', '') is not null then
    select id into v_therapist from public.pos_therapists
    where id = (p_cart ->> 'therapist_id')::bigint and facility_id = p_facility_id and is_active;
    if not found then raise exception 'Therapist not found at this clinic' using errcode = 'P0001'; end if;
  end if;

  -- payments must cover the total exactly
  if jsonb_array_length(coalesce(p_payments, '[]')) = 0 then raise exception 'Add a payment' using errcode = 'P0001'; end if;
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_amount := round(coalesce(nullif(v_pay ->> 'amount', '')::numeric, 0), 2);
    if v_amount <= 0 then raise exception 'Each payment needs an amount' using errcode = 'P0001'; end if;
    v_pay_total := v_pay_total + v_amount;
  end loop;
  if v_pay_total <> (v_price ->> 'grand_total')::numeric then
    raise exception 'Payments (₹%) must add up to the bill total (₹%)', v_pay_total, v_price ->> 'grand_total'
      using errcode = 'P0001', hint = 'total_mismatch';
  end if;

  insert into public.pos_invoices (
    client_ref, facility_id, register_id, shift_id, entity_id, status, seller_id, therapist_id,
    customer_id, customer_name, customer_phone, customer_gstin, customer_company, is_b2b, is_new_customer, lead_source,
    supplier, place_of_supply, intra_state, cart_discount_kind, cart_discount_value,
    gross_total, discount_total, taxable_total, cgst_total, sgst_total, igst_total, round_off, grand_total,
    max_disc_pct, approval_id, notes)
  values (
    p_client_ref, p_facility_id, p_register_id, v_shift.id, v_entity.id, 'awaiting_payment', v_staff.user_id, v_therapist,
    v_customer.id, v_customer.name, v_customer.phone, v_customer.gstin, v_customer.company_name, v_customer.gstin is not null,
    case when v_customer.id is not null then not exists (
      select 1 from public.pos_invoices i where i.customer_id = v_customer.id and i.status = 'paid') end,
    v_customer.lead_source,
    jsonb_build_object('legal_name', v_entity.legal_name, 'trade_name', v_entity.trade_name, 'gstin', v_entity.gstin,
      'address', v_entity.address, 'state_name', v_entity.state_name, 'state_code', v_entity.state_code,
      'pan', v_entity.pan, 'cin', v_entity.cin, 'kind', v_entity.kind,
      'facility_code', v_fac.code, 'facility_name', v_fac.name,
      'facility_address', concat_ws(', ', v_fac.address, v_fac.city, v_fac.state, v_fac.pincode),
      'footer', v_settings.invoice_footer),
    v_price ->> 'place_of_supply', (v_price ->> 'intra_state')::boolean,
    v_price -> 'cart_discount' ->> 'kind', (v_price -> 'cart_discount' ->> 'value')::numeric,
    (v_price ->> 'gross_total')::numeric, (v_price ->> 'discount_total')::numeric, (v_price ->> 'taxable_total')::numeric,
    (v_price ->> 'cgst_total')::numeric, (v_price ->> 'sgst_total')::numeric, (v_price ->> 'igst_total')::numeric,
    (v_price ->> 'round_off')::numeric, (v_price ->> 'grand_total')::numeric,
    v_max, v_approval_id, nullif(trim(p_cart ->> 'notes'), ''))
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(v_price -> 'lines') loop
    insert into public.pos_invoice_lines (
      invoice_id, line_no, sku, item_name, size, color, category_name, hsn_code, gst_pct, is_service, bucket, qty,
      unit_price, mrp, line_disc_kind, line_disc_value, line_discount, cart_discount, disc_pct, net_amount, taxable, cgst, sgst, igst)
    values (
      v_id, (v_line ->> 'line_no')::int, v_line ->> 'sku', v_line ->> 'name', v_line ->> 'size', v_line ->> 'color',
      v_line ->> 'category_name', v_line ->> 'hsn_code', (v_line ->> 'gst_pct')::numeric, (v_line ->> 'is_service')::boolean,
      case when (v_line ->> 'is_service')::boolean then null else 'sellable'::public.stock_bucket end,
      (v_line ->> 'qty')::int, (v_line ->> 'unit_price')::numeric, (v_line ->> 'mrp')::numeric,
      v_line ->> 'disc_kind', (v_line ->> 'disc_value')::numeric, (v_line ->> 'line_discount')::numeric,
      (v_line ->> 'cart_discount')::numeric, (v_line ->> 'disc_pct')::numeric, (v_line ->> 'net_amount')::numeric,
      (v_line ->> 'taxable')::numeric, (v_line ->> 'cgst')::numeric, (v_line ->> 'sgst')::numeric, (v_line ->> 'igst')::numeric);
  end loop;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_mode := v_pay ->> 'mode';
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    v_ref := nullif(trim(v_pay ->> 'reference'), '');
    v_cn := null;
    if v_mode = 'credit_note' then
      select * into v_cn from public.pos_credit_notes
      where id = nullif(v_pay ->> 'credit_note_id', '')::bigint and facility_id = p_facility_id for update;
      if not found or v_cn.settlement <> 'exchange' then
        raise exception 'That credit note cannot be used here' using errcode = 'P0001';
      end if;
      if v_cn.grand_total - v_cn.redeemed_total - v_cn.refunded_total < v_amount then
        raise exception 'Credit note % has only ₹% left', v_cn.credit_no,
          v_cn.grand_total - v_cn.redeemed_total - v_cn.refunded_total using errcode = 'P0001';
      end if;
      update public.pos_credit_notes set redeemed_total = redeemed_total + v_amount where id = v_cn.id;
      v_ref := v_cn.credit_no;
      v_status := 'confirmed';
    elsif not (v_mode = any (v_settings.payment_modes)) then
      raise exception 'Payment mode % is not enabled at this clinic', v_mode using errcode = 'P0001';
    elsif v_mode = 'cash' then
      if nullif(v_pay ->> 'tendered', '')::numeric < v_amount then
        raise exception 'Cash handed over is less than the cash amount' using errcode = 'P0001';
      end if;
      v_status := 'confirmed';
    elsif v_mode in ('upi_static', 'card_edc') then
      if coalesce(length(v_ref), 0) < 4 then
        raise exception '%', case v_mode when 'upi_static' then 'Enter the UPI reference (UTR) from the payment'
                                 else 'Enter the approval code or RRN from the card slip' end
          using errcode = 'P0001', hint = 'reference_required';
      end if;
      v_status := 'confirmed';
    elsif v_mode = 'upi_razorpay' then
      if not v_entity.razorpay_enabled then
        raise exception 'Razorpay UPI is not set up for %', v_entity.legal_name using errcode = 'P0001';
      end if;
      v_status := 'pending';
    elsif v_mode = 'bank_transfer' then
      v_status := 'pending';   -- confirmed when the UTR is checked against the bank
    else
      raise exception 'Unknown payment mode %', v_mode using errcode = 'P0001';
    end if;
    if v_status = 'pending' then v_all_confirmed := false; end if;

    insert into public.pos_payments (invoice_id, facility_id, shift_id, mode, amount, tendered, status, reference,
                                     credit_note_id, taken_by, confirmed_by, confirmed_at)
    values (v_id, p_facility_id, v_shift.id, v_mode, v_amount,
            case when v_mode = 'cash' then nullif(v_pay ->> 'tendered', '')::numeric end, v_status, v_ref, v_cn.id,
            v_staff.user_id, case when v_status = 'confirmed' then auth.uid() end,
            case when v_status = 'confirmed' then now() end);
  end loop;

  if v_approval_id is not null then
    update public.pos_discount_approvals set used_at = now() where id = v_approval_id and used_at is null;
  end if;

  -- money in hand: number and post now, in this transaction; any failure rolls the whole sale back
  if v_all_confirmed then
    perform public.pos__finalize(v_id);
  end if;
  return public.pos__invoice_summary(v_id) || jsonb_build_object('is_new_customer',
    (select is_new_customer from public.pos_invoices where id = v_id));
end;
$$;

-- Staff confirm a pending payment (bank transfer UTR checked, or a Razorpay QR checked by hand)
create or replace function public.pos_confirm_payment(p_payment_id bigint, p_staff_token text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.pos_payments;
  v_inv public.pos_invoices;
begin
  select * into v_pay from public.pos_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found' using errcode = 'P0001'; end if;
  select * into v_inv from public.pos_invoices where id = v_pay.invoice_id for update;
  perform public.assert_facility_access(v_inv.facility_id);
  perform public.pos__staff(p_staff_token, v_inv.facility_id);
  select * into v_pay from public.pos_payments where id = p_payment_id for update;
  if v_pay.status = 'confirmed' then return public.pos__try_finalize(v_inv.id); end if;
  if v_pay.status <> 'pending' or v_inv.status = 'cancelled' then
    raise exception 'This payment can no longer be confirmed' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_reference)), 0) < 4 then
    raise exception 'Enter the UTR / reference' using errcode = 'P0001', hint = 'reference_required';
  end if;
  update public.pos_payments
  set status = 'confirmed', reference = trim(p_reference), confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_payment_id;
  return public.pos__try_finalize(v_inv.id);
end;
$$;

-- Gateway webhook (service role only, from the pos-razorpay-webhook Edge Function). Idempotent on the payment id.
create or replace function public.pos_gateway_payment(p_gateway_ref text, p_gateway_payment_id text, p_amount numeric, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.pos_payments;
  v_inv public.pos_invoices;
begin
  select * into v_pay from public.pos_payments where gateway_ref = p_gateway_ref;
  if not found then raise exception 'Unknown gateway reference %', p_gateway_ref using errcode = 'P0001'; end if;
  select * into v_inv from public.pos_invoices where id = v_pay.invoice_id for update;
  select * into v_pay from public.pos_payments where id = v_pay.id for update;
  if v_pay.status = 'confirmed' then return public.pos__try_finalize(v_inv.id); end if;

  if p_status = 'failed' then
    update public.pos_payments set status = 'failed', gateway_payment_id = p_gateway_payment_id where id = v_pay.id;
    return public.pos__invoice_summary(v_inv.id);
  end if;

  update public.pos_payments
  set status = 'confirmed', gateway_payment_id = p_gateway_payment_id, reference = p_gateway_payment_id, confirmed_at = now()
  where id = v_pay.id;
  if round(p_amount, 2) <> v_pay.amount then
    update public.pos_invoices set status = 'needs_attention',
      attention_reason = format('Razorpay captured ₹%s but ₹%s was expected', round(p_amount, 2), v_pay.amount)
    where id = v_inv.id;
    return public.pos__invoice_summary(v_inv.id);
  end if;
  if v_inv.status = 'cancelled' then
    update public.pos_invoices set status = 'needs_attention',
      attention_reason = 'Payment arrived after the draft was cancelled: finish the sale or refund it'
    where id = v_inv.id;
    return public.pos__invoice_summary(v_inv.id);
  end if;
  return public.pos__try_finalize(v_inv.id);
end;
$$;

create or replace function public.pos_attach_gateway_ref(p_payment_id bigint, p_gateway_ref text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pos_payments set gateway_ref = p_gateway_ref
  where id = p_payment_id and mode = 'upi_razorpay' and status = 'pending'
$$;

-- Drop an unpaid draft (customer walked away). Released stock and credit-note balances go back.
create or replace function public.pos_cancel_invoice(p_invoice_id bigint, p_staff_token text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.pos_invoices;
begin
  select * into v_inv from public.pos_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_inv.facility_id);
  perform public.pos__staff(p_staff_token, v_inv.facility_id);
  if v_inv.status <> 'awaiting_payment' then
    raise exception 'Only unpaid drafts can be cancelled; use a return for a finished sale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pos_payments where invoice_id = p_invoice_id and status = 'confirmed'
             and mode in ('upi_razorpay', 'bank_transfer')) then
    raise exception 'Money has already arrived for this draft; finish the sale instead' using errcode = 'P0001';
  end if;
  update public.pos_credit_notes c set redeemed_total = c.redeemed_total - p.amount
  from public.pos_payments p
  where p.invoice_id = p_invoice_id and p.mode = 'credit_note' and p.status = 'confirmed' and c.id = p.credit_note_id;
  update public.pos_payments set status = 'cancelled' where invoice_id = p_invoice_id and status in ('pending', 'confirmed');
  update public.pos_invoices set status = 'cancelled', attention_reason = nullif(trim(p_reason), '') where id = p_invoice_id;
  if v_inv.approval_id is not null then
    update public.pos_discount_approvals set used_at = null where id = v_inv.approval_id and expires_at > now();
  end if;
  return public.pos__invoice_summary(p_invoice_id);
end;
$$;

-- ================================================================ returns (Decision 10)
-- Credit note in its own series, stock back into the Hub (sellable or damaged), then either an online refund
-- request paid by the invoicing entity, or a balance to spend in an exchange sale.
create or replace function public.pos_return(
  p_client_ref uuid,
  p_invoice_id bigint,
  p_staff_token text,
  p_lines jsonb,          -- [{invoice_line_id, qty, restock_bucket: 'sellable'|'damaged'}]
  p_reason text,
  p_settlement text,      -- 'refund' | 'exchange'
  p_refund jsonb,         -- {method: 'upi'|'bank_transfer'|'razorpay_api', payee_vpa, payee_account: {name, account_no, ifsc}}
  p_override_token text default null   -- a Frido admin's PIN token, needed after the return window
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pos_credit_notes;
  v_inv public.pos_invoices;
  v_settings public.pos_settings;
  v_staff public.pos_staff;
  v_admin public.pos_staff;
  v_age int;
  v_shift bigint;
  v_req record;
  v_line public.pos_invoice_lines;
  v_series text;
  v_no record;
  v_id bigint;
  v_amount numeric;
  v_already numeric;
  v_taxable numeric;
  v_tax numeric;
  v_cgst numeric;
  v_sgst numeric;
  v_igst numeric;
  v_t_net numeric := 0;
  v_t_taxable numeric := 0;
  v_t_cgst numeric := 0;
  v_t_sgst numeric := 0;
  v_t_igst numeric := 0;
  v_method text;
  v_refund_id bigint;
  v_cn public.pos_credit_notes;
begin
  if p_client_ref is null then raise exception 'Missing return reference' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos_return:' || p_client_ref::text, 0));
  select * into v_existing from public.pos_credit_notes where client_ref = p_client_ref;
  if found then
    perform public.assert_facility_access(v_existing.facility_id);
    return jsonb_build_object('id', v_existing.id, 'credit_no', v_existing.credit_no, 'grand_total', v_existing.grand_total,
      'share_token', v_existing.share_token, 'settlement', v_existing.settlement, 'replay', true);
  end if;

  select * into v_inv from public.pos_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_inv.facility_id);
  v_settings := public.pos__settings(v_inv.facility_id);
  v_staff := public.pos__staff(p_staff_token, v_inv.facility_id);
  if v_staff.pos_role = 'cashier' then
    raise exception 'Returns need a manager' using errcode = 'P0001', hint = 'manager_required';
  end if;
  if v_inv.status <> 'paid' then raise exception 'Only paid invoices can be returned' using errcode = 'P0001'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give a reason for the return' using errcode = 'P0001'; end if;
  if p_settlement not in ('refund', 'exchange') then raise exception 'Choose refund or exchange' using errcode = 'P0001'; end if;

  v_age := (now() at time zone 'Asia/Kolkata')::date - (v_inv.invoiced_at at time zone 'Asia/Kolkata')::date;
  if v_age > v_settings.return_days then
    if p_override_token is null then
      raise exception 'This invoice is % days old. Returns after % days need a Frido admin.', v_age, v_settings.return_days
        using errcode = 'P0001', hint = 'admin_override_required';
    end if;
    v_admin := public.pos__staff(p_override_token, v_inv.facility_id);
    if v_admin.pos_role <> 'admin' then
      raise exception 'Only a Frido admin can accept a late return' using errcode = 'P0001', hint = 'admin_override_required';
    end if;
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'Choose what is being returned' using errcode = 'P0001'; end if;

  select code into v_series from public.pos_series where facility_id = v_inv.facility_id and doc_type = 'credit_note' and is_active;
  if v_series is null then raise exception 'No credit note series is set up for this facility' using errcode = 'P0001'; end if;
  select id into v_shift from public.pos_shifts where facility_id = v_inv.facility_id and status = 'open'
  order by opened_at desc limit 1;
  select * into v_no from public.pos__next_no(v_series, public.pos__fy(now()));

  insert into public.pos_credit_notes (client_ref, facility_id, invoice_id, entity_id, shift_id, credit_no, series_code, fy, seq,
    reason, settlement, supplier, taxable_total, cgst_total, sgst_total, igst_total, grand_total, staff_id, late_override_by)
  values (p_client_ref, v_inv.facility_id, v_inv.id, v_inv.entity_id, v_shift, v_no.doc_no, v_series, public.pos__fy(now()), v_no.seq,
    trim(p_reason), p_settlement, v_inv.supplier, 0, 0, 0, 0, 0.01, v_staff.user_id, v_admin.user_id)
  returning id into v_id;

  for v_req in
    select (x ->> 'invoice_line_id')::bigint as line_id, sum((x ->> 'qty')::int)::int as qty,
           max(x ->> 'restock_bucket') as bucket
    from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    select * into v_line from public.pos_invoice_lines where id = v_req.line_id and invoice_id = v_inv.id for update;
    if not found then raise exception 'That line is not on this invoice' using errcode = 'P0001'; end if;
    if v_req.qty is null or v_req.qty < 1 or v_req.qty > v_line.qty - v_line.returned_qty then
      raise exception 'Only % of % can still be returned', v_line.qty - v_line.returned_qty, v_line.sku using errcode = 'P0001';
    end if;
    if not v_line.is_service and coalesce(v_req.bucket, '') not in ('sellable', 'damaged') then
      raise exception 'Say whether % goes back to sellable or damaged stock', v_line.sku using errcode = 'P0001';
    end if;

    -- pro-rata of what was charged; the last units take whatever is left so totals match exactly
    select coalesce(sum(net_amount), 0) into v_already from public.pos_credit_note_lines where invoice_line_id = v_line.id;
    v_amount := case when v_req.qty = v_line.qty - v_line.returned_qty then v_line.net_amount - v_already
                     else round(v_line.net_amount * v_req.qty / v_line.qty, 2) end;
    v_taxable := round(v_amount / (1 + v_line.gst_pct / 100), 2);
    v_tax := v_amount - v_taxable;
    if v_inv.intra_state then v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.pos_credit_note_lines (credit_note_id, invoice_line_id, sku, qty, restock_bucket, net_amount, taxable, cgst, sgst, igst)
    values (v_id, v_line.id, v_line.sku, v_req.qty,
            case when v_line.is_service then null else v_req.bucket::public.stock_bucket end,
            v_amount, v_taxable, v_cgst, v_sgst, v_igst);
    update public.pos_invoice_lines set returned_qty = returned_qty + v_req.qty where id = v_line.id;

    if not v_line.is_service then
      -- back into Hub stock. Settlement reversal is a Hub change still to agree (docs/POS-DESIGN.md, Hub proposal H2).
      insert into public.stock_ledger (facility_id, sku, bucket, qty_delta, movement, ref_type, ref_id, ref_no, note)
      values (v_inv.facility_id, v_line.sku, v_req.bucket::public.stock_bucket, v_req.qty, 'return_in', 'pos_credit_note',
              v_id, v_no.doc_no, 'Customer return against ' || v_inv.invoice_no || ': ' || trim(p_reason));
    end if;

    v_t_net := v_t_net + v_amount; v_t_taxable := v_t_taxable + v_taxable;
    v_t_cgst := v_t_cgst + v_cgst; v_t_sgst := v_t_sgst + v_sgst; v_t_igst := v_t_igst + v_igst;
  end loop;

  update public.pos_credit_notes
  set taxable_total = v_t_taxable, cgst_total = v_t_cgst, sgst_total = v_t_sgst, igst_total = v_t_igst, grand_total = v_t_net
  where id = v_id returning * into v_cn;

  if p_settlement = 'refund' then
    v_method := coalesce(p_refund ->> 'method', '');
    if v_method = 'razorpay_api' and not exists (
         select 1 from public.pos_payments where invoice_id = v_inv.id and mode = 'upi_razorpay' and status = 'confirmed') then
      raise exception 'This invoice was not paid through Razorpay; refund by UPI or bank transfer' using errcode = 'P0001';
    end if;
    if v_method = 'upi' and coalesce(p_refund ->> 'payee_vpa', '') !~ '^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$' then
      raise exception 'Enter the customer''s UPI ID for the refund' using errcode = 'P0001', hint = 'refund_details_required';
    end if;
    if v_method = 'bank_transfer' and (coalesce(p_refund -> 'payee_account' ->> 'account_no', '') = ''
                                        or coalesce(p_refund -> 'payee_account' ->> 'ifsc', '') !~ '^[A-Z]{4}0[A-Z0-9]{6}$') then
      raise exception 'Enter the customer''s bank account number and IFSC' using errcode = 'P0001', hint = 'refund_details_required';
    end if;
    if v_method not in ('upi', 'bank_transfer', 'razorpay_api') then
      raise exception 'Choose how the refund is paid' using errcode = 'P0001', hint = 'refund_details_required';
    end if;
    insert into public.pos_refunds (facility_id, entity_id, credit_note_id, amount, method, payee_vpa, payee_account)
    values (v_inv.facility_id, v_inv.entity_id, v_id, v_t_net, v_method,
            nullif(p_refund ->> 'payee_vpa', ''), case when v_method = 'bank_transfer' then p_refund -> 'payee_account' end)
    returning id into v_refund_id;
    update public.pos_credit_notes set refunded_total = grand_total where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'credit_no', v_no.doc_no, 'grand_total', v_t_net, 'share_token', v_cn.share_token,
    'settlement', p_settlement, 'refund_id', v_refund_id, 'invoice_no', v_inv.invoice_no);
end;
$$;

-- Turn what is left of an exchange credit note into an online refund (e.g. the new item cost less)
create or replace function public.pos_refund_credit_balance(p_credit_note_id bigint, p_staff_token text, p_refund jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cn public.pos_credit_notes;
  v_left numeric;
  v_method text := coalesce(p_refund ->> 'method', '');
  v_id bigint;
begin
  select * into v_cn from public.pos_credit_notes where id = p_credit_note_id for update;
  if not found then raise exception 'Credit note not found' using errcode = 'P0001'; end if;
  perform public.assert_facility_access(v_cn.facility_id);
  perform public.pos__staff(p_staff_token, v_cn.facility_id);
  v_left := v_cn.grand_total - v_cn.redeemed_total - v_cn.refunded_total;
  if v_left <= 0 then raise exception 'Nothing left on this credit note' using errcode = 'P0001'; end if;
  if v_method not in ('upi', 'bank_transfer') then raise exception 'Choose UPI or bank transfer' using errcode = 'P0001'; end if;
  insert into public.pos_refunds (facility_id, entity_id, credit_note_id, amount, method, payee_vpa, payee_account)
  values (v_cn.facility_id, v_cn.entity_id, v_cn.id, v_left, v_method, nullif(p_refund ->> 'payee_vpa', ''),
          case when v_method = 'bank_transfer' then p_refund -> 'payee_account' end)
  returning id into v_id;
  update public.pos_credit_notes set refunded_total = refunded_total + v_left where id = v_cn.id;
  return jsonb_build_object('refund_id', v_id, 'amount', v_left);
end;
$$;

-- The invoicing entity records that it paid (or could not pay) a refund. Frido-invoiced: Frido ops/finance.
-- Clinic-invoiced: the clinic's manager.
create or replace function public.pos_mark_refund(p_refund_id bigint, p_status text, p_utr text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.pos_refunds;
  v_kind text;
begin
  select * into v_ref from public.pos_refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found' using errcode = 'P0001'; end if;
  select kind into v_kind from public.pos_entities where id = v_ref.entity_id;
  if not (public.is_ops() or (v_kind = 'partner' and public.pos_is_manager(v_ref.facility_id))) then
    raise exception 'Only the invoicing entity can settle this refund' using errcode = '42501';
  end if;
  if v_ref.status not in ('pending', 'failed') then raise exception 'This refund is already %', v_ref.status using errcode = 'P0001'; end if;
  if p_status not in ('paid', 'failed', 'cancelled') then raise exception 'Unknown status' using errcode = 'P0001'; end if;
  if p_status = 'paid' and coalesce(length(trim(p_utr)), 0) < 4 then
    raise exception 'Enter the UTR of the refund payment' using errcode = 'P0001';
  end if;
  update public.pos_refunds
  set status = p_status, utr = nullif(trim(p_utr), ''), note = coalesce(nullif(trim(p_note), ''), note),
      paid_by = case when p_status = 'paid' then auth.uid() end, paid_at = case when p_status = 'paid' then now() end
  where id = p_refund_id returning * into v_ref;
  if p_status = 'cancelled' then
    update public.pos_credit_notes set refunded_total = refunded_total - v_ref.amount where id = v_ref.credit_note_id;
  end if;
  return to_jsonb(v_ref);
end;
$$;

-- ================================================================ connectivity (Decision 7)
create or replace function public.pos_log_connectivity(p_facility_id bigint, p_register_id bigint, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public.assert_facility_access(p_facility_id);
  insert into public.pos_connectivity_log (facility_id, register_id, started_at, ended_at, context)
  select p_facility_id, p_register_id, (e ->> 'started_at')::timestamptz, (e ->> 'ended_at')::timestamptz, left(e ->> 'context', 200)
  from jsonb_array_elements(coalesce(p_events, '[]')) e
  where (e ->> 'ended_at')::timestamptz >= (e ->> 'started_at')::timestamptz
  limit 200;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ================================================================ admin
-- Frido ops set up any staff; a clinic manager can add cashiers at their own clinic.
create or replace function public.pos_admin_set_staff(
  p_user_id uuid, p_facility_id bigint, p_pos_role text, p_display_name text, p_pin text, p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not (public.is_ops() or (p_pos_role = 'cashier' and p_facility_id is not null and public.pos_is_manager(p_facility_id))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = p_user_id and is_active;
  if not found then raise exception 'That user is not an active Partner Hub user' using errcode = 'P0001'; end if;
  if p_pos_role = 'admin' then
    if v_profile.role not in ('admin', 'ops', 'manager') then
      raise exception 'POS admins must be Frido admin, ops or manager users' using errcode = 'P0001';
    end if;
    p_facility_id := null;
  elsif v_profile.facility_id is distinct from p_facility_id then
    raise exception 'In the Partner Hub this user belongs to another facility' using errcode = 'P0001';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then raise exception 'A PIN is 4 to 6 digits' using errcode = 'P0001'; end if;

  insert into public.pos_staff as s (user_id, facility_id, pos_role, display_name, pin_hash, is_active)
  values (p_user_id, p_facility_id, p_pos_role, coalesce(nullif(trim(p_display_name), ''), v_profile.full_name),
          case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf', 8)) end, coalesce(p_is_active, true))
  on conflict (user_id) do update set
    facility_id = excluded.facility_id, pos_role = excluded.pos_role, display_name = excluded.display_name,
    pin_hash = coalesce(excluded.pin_hash, s.pin_hash), is_active = excluded.is_active,
    pin_failed = case when excluded.pin_hash is not null then 0 else s.pin_failed end,
    pin_locked_until = case when excluded.pin_hash is not null then null else s.pin_locked_until end;
  if not coalesce(p_is_active, true) then
    update public.pos_staff_sessions set revoked_at = now() where user_id = p_user_id and revoked_at is null;
  end if;
  return (select jsonb_build_object('user_id', user_id, 'facility_id', facility_id, 'pos_role', pos_role,
            'display_name', display_name, 'has_pin', pin_hash is not null, 'is_active', is_active)
          from public.pos_staff where user_id = p_user_id);
end;
$$;

create or replace function public.pos_change_my_pin(p_old_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_err text;
begin
  if p_new_pin !~ '^[0-9]{4,6}$' then return jsonb_build_object('ok', false, 'error', 'A PIN is 4 to 6 digits'); end if;
  v_err := public.pos__check_pin(auth.uid(), p_old_pin);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;
  update public.pos_staff set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)) where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- One call to put a facility on the POS: invoicing entity, series codes and settings
create or replace function public.pos_admin_setup_facility(
  p_facility_id bigint, p_entity_id bigint, p_invoice_series text, p_credit_series text, p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur text;
  v_doc text;
  v_code text;
begin
  perform public.assert_ops();
  if upper(p_invoice_series) = upper(p_credit_series) then
    raise exception 'Invoices and credit notes need different series codes' using errcode = 'P0001';
  end if;
  insert into public.pos_settings as s (facility_id, entity_id, payment_modes, cashier_max_disc_pct, manager_max_disc_pct,
                                        return_days, require_customer, invoice_footer, is_enabled)
  values (p_facility_id, p_entity_id,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p_settings -> 'payment_modes') x), '{cash,upi_static,card_edc}'),
          coalesce((p_settings ->> 'cashier_max_disc_pct')::numeric, 5), coalesce((p_settings ->> 'manager_max_disc_pct')::numeric, 10),
          coalesce((p_settings ->> 'return_days')::int, 10), coalesce((p_settings ->> 'require_customer')::boolean, true),
          p_settings ->> 'invoice_footer', coalesce((p_settings ->> 'is_enabled')::boolean, true))
  on conflict (facility_id) do update set
    entity_id = excluded.entity_id, payment_modes = excluded.payment_modes,
    cashier_max_disc_pct = excluded.cashier_max_disc_pct, manager_max_disc_pct = excluded.manager_max_disc_pct,
    return_days = excluded.return_days, require_customer = excluded.require_customer,
    invoice_footer = excluded.invoice_footer, is_enabled = excluded.is_enabled, updated_at = now();

  foreach v_doc in array array['invoice', 'credit_note'] loop
    v_code := upper(case v_doc when 'invoice' then p_invoice_series else p_credit_series end);
    select code into v_cur from public.pos_series where facility_id = p_facility_id and doc_type = v_doc and is_active;
    if v_cur is distinct from v_code then
      if exists (select 1 from public.pos_series where code = v_code) then
        raise exception 'Series code % is already used', v_code using errcode = 'P0001';
      end if;
      update public.pos_series set is_active = false where facility_id = p_facility_id and doc_type = v_doc and is_active;
      insert into public.pos_series (code, facility_id, doc_type) values (v_code, p_facility_id, v_doc);
    end if;
  end loop;
  return public.pos_context(p_facility_id);
end;
$$;

-- ================================================================ public invoice link (WhatsApp / SMS)
-- Anyone holding the unguessable token can view that one document; the phone number is masked.
create or replace function public.pos_public_document(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'type', 'invoice', 'number', i.invoice_no, 'date', i.invoiced_at, 'supplier', i.supplier,
       'customer', jsonb_build_object('name', i.customer_name, 'phone', case when i.customer_phone is not null
                     then 'XXXXXX' || right(i.customer_phone, 4) end, 'gstin', i.customer_gstin, 'company', i.customer_company),
       'is_b2b', i.is_b2b, 'place_of_supply', i.place_of_supply, 'intra_state', i.intra_state,
       'seller', (select display_name from public.pos_staff where user_id = i.seller_id),
       'gross_total', i.gross_total, 'discount_total', i.discount_total, 'taxable_total', i.taxable_total,
       'cgst_total', i.cgst_total, 'sgst_total', i.sgst_total, 'igst_total', i.igst_total, 'round_off', i.round_off,
       'grand_total', i.grand_total,
       'lines', (select jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.item_name, 'size', l.size, 'color', l.color,
                   'hsn', l.hsn_code, 'gst_pct', l.gst_pct, 'qty', l.qty, 'unit_price', l.unit_price, 'mrp', l.mrp,
                   'discount', l.line_discount + l.cart_discount, 'net', l.net_amount, 'taxable', l.taxable,
                   'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst) order by l.line_no)
                 from public.pos_invoice_lines l where l.invoice_id = i.id),
       'payments', (select jsonb_agg(jsonb_build_object('mode', p.mode, 'amount', p.amount) order by p.id)
                    from public.pos_payments p where p.invoice_id = i.id and p.status = 'confirmed'))
     from public.pos_invoices i where i.share_token = p_token and i.status = 'paid'),
    (select jsonb_build_object(
       'type', 'credit_note', 'number', c.credit_no, 'date', c.issued_at, 'supplier', c.supplier,
       'against', i.invoice_no, 'against_date', i.invoiced_at, 'reason', c.reason, 'settlement', c.settlement,
       'customer', jsonb_build_object('name', i.customer_name, 'phone', case when i.customer_phone is not null
                     then 'XXXXXX' || right(i.customer_phone, 4) end, 'gstin', i.customer_gstin, 'company', i.customer_company),
       'intra_state', i.intra_state, 'place_of_supply', i.place_of_supply,
       'taxable_total', c.taxable_total, 'cgst_total', c.cgst_total, 'sgst_total', c.sgst_total,
       'igst_total', c.igst_total, 'grand_total', c.grand_total,
       'lines', (select jsonb_agg(jsonb_build_object('sku', cl.sku, 'name', l.item_name, 'size', l.size, 'hsn', l.hsn_code,
                   'gst_pct', l.gst_pct, 'qty', cl.qty, 'net', cl.net_amount, 'taxable', cl.taxable,
                   'cgst', cl.cgst, 'sgst', cl.sgst, 'igst', cl.igst) order by l.line_no)
                 from public.pos_credit_note_lines cl join public.pos_invoice_lines l on l.id = cl.invoice_line_id
                 where cl.credit_note_id = c.id))
     from public.pos_credit_notes c join public.pos_invoices i on i.id = c.invoice_id where c.share_token = p_token)
  )
$$;

-- ================================================================ catalogue and reports (RLS applies: security invoker)
create view public.pos_v_catalog with (security_invoker = true) as
select
  a.facility_id, a.sku, i.name, i.size, i.color, i.category_name, i.image_url, i.hsn_code, i.gst_pct, i.scan_identifier,
  a.msp, case when i.mrp > a.msp then i.mrp end as mrp,
  (s.sku is not null) as is_service,
  coalesce(b.qty, 0) as sellable_qty,
  (a.msp is not null and nullif(trim(i.hsn_code), '') is not null and i.gst_pct in (0, 5, 12, 18, 28, 40) and i.enabled) as sale_ready
from public.facility_assortment a
join public.items i on i.sku = a.sku
left join public.pos_service_skus s on s.sku = a.sku
left join public.stock_balances b on b.facility_id = a.facility_id and b.sku = a.sku and b.bucket = 'sellable'
where a.is_active;
revoke all on public.pos_v_catalog from anon;

create or replace function public.pos_report(p_facility_id bigint, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with inv as (
    select i.* from public.pos_invoices i
    where i.facility_id = p_facility_id and i.status = 'paid'
      and (i.invoiced_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), lines as (
    select l.*, i.seller_id, i.therapist_id, (i.invoiced_at at time zone 'Asia/Kolkata')::date as day
    from public.pos_invoice_lines l join inv i on i.id = l.invoice_id
  ), cn as (
    select c.* from public.pos_credit_notes c
    where c.facility_id = p_facility_id and (c.issued_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), cnl as (
    select cl.*, (c.issued_at at time zone 'Asia/Kolkata')::date as day
    from public.pos_credit_note_lines cl join cn c on c.id = cl.credit_note_id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'kpi', jsonb_build_object(
      'orders', (select count(*) from inv),
      'gross_qty', (select coalesce(sum(qty), 0) from lines),
      'returned_qty', (select coalesce(sum(qty), 0) from cnl),
      'net_qty', (select coalesce(sum(qty), 0) from lines) - (select coalesce(sum(qty), 0) from cnl),
      'gross_sales', (select coalesce(sum(grand_total), 0) from inv),
      'returned_sales', (select coalesce(sum(grand_total), 0) from cn),
      'net_sales', (select coalesce(sum(grand_total), 0) from inv) - (select coalesce(sum(grand_total), 0) from cn),
      'discount_total', (select coalesce(sum(discount_total), 0) from inv),
      'new_customers', (select count(*) from inv where is_new_customer),
      'returning_customers', (select count(*) from inv where is_new_customer = false),
      'avg_bill', (select coalesce(round(avg(grand_total), 2), 0) from inv)),
    'by_day', (select coalesce(jsonb_agg(d order by d ->> 'day'), '[]') from (
        select jsonb_build_object('day', day, 'orders', count(distinct invoice_id), 'qty', sum(qty), 'sales', sum(net_amount)) d
        from lines group by day) x),
    'by_sku', (select coalesce(jsonb_agg(d order by (d ->> 'sales')::numeric desc), '[]') from (
        select jsonb_build_object('sku', sku, 'name', max(item_name), 'category', max(category_name),
          'qty', sum(qty), 'sales', sum(net_amount),
          'returned_qty', coalesce((select sum(qty) from cnl where cnl.sku = lines.sku), 0)) d
        from lines group by sku) x),
    'by_category', (select coalesce(jsonb_agg(d order by (d ->> 'sales')::numeric desc), '[]') from (
        select jsonb_build_object('category', coalesce(category_name, 'Uncategorised'), 'qty', sum(qty), 'sales', sum(net_amount)) d
        from lines group by category_name) x),
    'by_staff', (select coalesce(jsonb_agg(d order by (d ->> 'sales')::numeric desc), '[]') from (
        select jsonb_build_object('name', s.display_name, 'orders', count(*), 'sales', sum(i.grand_total),
          'discount', sum(i.discount_total)) d
        from inv i join public.pos_staff s on s.user_id = i.seller_id group by s.display_name) x),
    'by_therapist', (select coalesce(jsonb_agg(d order by (d ->> 'sales')::numeric desc), '[]') from (
        select jsonb_build_object('name', coalesce(t.name, 'No referral'), 'kind', t.kind, 'orders', count(*),
          'sales', sum(i.grand_total)) d
        from inv i left join public.pos_therapists t on t.id = i.therapist_id group by t.name, t.kind) x),
    'by_mode', (select coalesce(jsonb_agg(d order by d ->> 'mode'), '[]') from (
        select jsonb_build_object('mode', p.mode, 'confirmed', sum(p.amount) filter (where p.status = 'confirmed'),
          'pending', coalesce(sum(p.amount) filter (where p.status = 'pending'), 0), 'count', count(*)) d
        from public.pos_payments p join inv i on i.id = p.invoice_id group by p.mode) x),
    'refunds', (select jsonb_build_object('pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
                  'paid', coalesce(sum(amount) filter (where status = 'paid'), 0))
                from public.pos_refunds r join cn c on c.id = r.credit_note_id)
  )
$$;

-- ================================================================ privileges
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'pos\_%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- internal helpers and gateway entry points are not for the browser
revoke execute on function
  public.pos__fy(timestamptz), public.pos__next_no(text, text), public.pos__settings(bigint), public.pos__staff(text, bigint),
  public.pos__check_pin(uuid, text), public.pos__price(bigint, jsonb, jsonb, boolean), public.pos__invoice_summary(bigint),
  public.pos__finalize(bigint), public.pos__try_finalize(bigint), public.pos__shift_report(bigint),
  public.pos_gateway_payment(text, text, numeric, text), public.pos_attach_gateway_ref(bigint, text)
from authenticated;
grant execute on function public.pos_gateway_payment(text, text, numeric, text), public.pos_attach_gateway_ref(bigint, text)
to service_role;

grant execute on function
  public.pos_context(bigint), public.pos_pin_login(bigint, bigint, uuid, text), public.pos_pin_logout(text),
  public.pos_price_cart(bigint, jsonb), public.pos_approve_discount(bigint, text, uuid, text, numeric, text),
  public.pos_upsert_customer(bigint, jsonb), public.pos_open_shift(bigint, bigint, text, numeric),
  public.pos_shift_report(bigint), public.pos_add_cash_movement(bigint, text, text, numeric, text, text),
  public.pos_close_shift(bigint, text, numeric, text),
  public.pos_checkout(uuid, bigint, bigint, text, jsonb, jsonb), public.pos_confirm_payment(bigint, text, text),
  public.pos_cancel_invoice(bigint, text, text),
  public.pos_return(uuid, bigint, text, jsonb, text, text, jsonb, text), public.pos_refund_credit_balance(bigint, text, jsonb),
  public.pos_mark_refund(bigint, text, text, text), public.pos_log_connectivity(bigint, bigint, jsonb),
  public.pos_admin_set_staff(uuid, bigint, text, text, text, boolean), public.pos_change_my_pin(text, text),
  public.pos_admin_setup_facility(bigint, bigint, text, text, jsonb), public.pos_report(bigint, date, date),
  public.pos_public_document(text)
to authenticated;
grant execute on function public.pos_public_document(text) to anon;
