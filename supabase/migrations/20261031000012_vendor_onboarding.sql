-- Vendor onboarding: retailers and super stockists apply from the login page, an admin approves
-- (creates the facility + a login with a temporary password) or removes the application.
-- Also: field sales access to their assigned facilities, and a forced password change on first sign-in.

-- ================================================================ field sales
-- field sales work for the facilities they are assigned to (facility_ops), like that facility's own staff
create or replace function public.can_access_facility(p_facility_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ops()
    or (public.auth_role() is not null and p_facility_id = public.auth_facility())
    or (public.auth_role() = 'field_sales'
        and exists (select 1 from public.facility_ops o where o.user_id = auth.uid() and o.facility_id = p_facility_id))
$$;

-- ================================================================ first sign-in
alter table public.profiles add column must_change_password boolean not null default false;

-- called after the person sets their own password
create or replace function public.password_changed()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set must_change_password = false where id = auth.uid() and must_change_password
$$;

-- ================================================================ applications
create table public.vendor_applications (
  id bigint generated always as identity primary key,
  applying_as public.facility_type not null check (applying_as in ('retailer', 'super_stockist')),
  -- business
  business_name text not null,
  business_type text,
  legal_name text,
  gstin text,
  address text not null,
  city text not null,
  state text not null,
  pincode text not null,
  -- point of contact (their email becomes the login)
  poc_name text not null,
  poc_designation text,
  poc_phone text not null,
  poc_email text not null,
  -- what they sell
  product_categories text[] not null default '{}',
  products_other text,
  -- stock
  maintains_stock boolean not null,
  stock_location text,          -- where the stock is kept, if they maintain it
  stock_tracking text,          -- how they track it today
  stock_poc_name text,
  stock_poc_phone text,
  stock_poc_email text,
  frido_manage_stock boolean,   -- if they don't maintain stock: should Frido maintain it for them
  referred_by text,
  notes text,
  -- decision
  status text not null default 'pending' check (status in ('pending', 'approved', 'removed')),
  facility_id bigint references public.facilities (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.vendor_applications (status, created_at desc);
create unique index vendor_applications_one_pending_per_email on public.vendor_applications (lower(poc_email)) where status = 'pending';

alter table public.vendor_applications enable row level security;
-- written only through the functions below; admins read them on the Onboarding page
create policy "admins read applications" on public.vendor_applications for select to authenticated
  using ((select public.is_admin()));

-- public: the form on the login page (anon)
create or replace function public.submit_vendor_application(p jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_email text := lower(trim(p ->> 'poc_email'));
  v_maintains boolean := (p ->> 'maintains_stock')::boolean;
  -- trimmed text, capped so the form can't be used to store large blobs
  t text;
begin
  if coalesce(p ->> 'applying_as', '') not in ('retailer', 'super_stockist') then
    raise exception 'Choose retailer or super stockist';
  end if;
  foreach t in array array['business_name', 'address', 'city', 'state', 'pincode', 'poc_name', 'poc_phone', 'poc_email'] loop
    if nullif(trim(p ->> t), '') is null then
      raise exception 'Please fill in %', replace(replace(t, 'poc_', 'contact '), '_', ' ');
    end if;
  end loop;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if regexp_replace(p ->> 'poc_phone', '\D', '', 'g') !~ '^\d{10,13}$' then raise exception 'Enter a valid phone number'; end if;
  if nullif(trim(p ->> 'pincode'), '') !~ '^\d{6}$' then raise exception 'Enter a 6-digit pincode'; end if;
  if nullif(trim(p ->> 'gstin'), '') is not null and upper(trim(p ->> 'gstin')) !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5';
  end if;
  if v_maintains is null then raise exception 'Tell us whether you maintain stock'; end if;
  if v_maintains and nullif(trim(p ->> 'stock_location'), '') is null then raise exception 'Tell us where the stock is kept'; end if;
  if not v_maintains and (p ->> 'frido_manage_stock') is null then
    raise exception 'Tell us whether Frido should maintain the stock for you';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'This email already has a Partner Hub login. Sign in instead, or use another email.';
  end if;
  if exists (select 1 from public.vendor_applications where lower(poc_email) = v_email and status = 'pending') then
    raise exception 'An application for this email is already waiting for approval.';
  end if;
  -- a public form: refuse floods
  if (select count(*) from public.vendor_applications where created_at > now() - interval '1 hour') >= 50 then
    raise exception 'Too many applications right now. Please try again in a while.';
  end if;

  insert into public.vendor_applications (
    applying_as, business_name, business_type, legal_name, gstin, address, city, state, pincode,
    poc_name, poc_designation, poc_phone, poc_email, product_categories, products_other,
    maintains_stock, stock_location, stock_tracking, stock_poc_name, stock_poc_phone, stock_poc_email,
    frido_manage_stock, referred_by, notes
  ) values (
    (p ->> 'applying_as')::public.facility_type,
    left(trim(p ->> 'business_name'), 200), left(nullif(trim(p ->> 'business_type'), ''), 100),
    left(nullif(trim(p ->> 'legal_name'), ''), 200), upper(nullif(trim(p ->> 'gstin'), '')),
    left(trim(p ->> 'address'), 500), left(trim(p ->> 'city'), 100), left(trim(p ->> 'state'), 100), trim(p ->> 'pincode'),
    left(trim(p ->> 'poc_name'), 120), left(nullif(trim(p ->> 'poc_designation'), ''), 120),
    left(trim(p ->> 'poc_phone'), 20), v_email,
    coalesce((select array_agg(left(x, 60)) from (select jsonb_array_elements_text(p -> 'product_categories') x limit 30) c), '{}'),
    left(nullif(trim(p ->> 'products_other'), ''), 500),
    v_maintains,
    case when v_maintains then left(nullif(trim(p ->> 'stock_location'), ''), 500) end,
    case when v_maintains then left(nullif(trim(p ->> 'stock_tracking'), ''), 200) end,
    case when v_maintains then left(nullif(trim(p ->> 'stock_poc_name'), ''), 120) end,
    case when v_maintains then left(nullif(trim(p ->> 'stock_poc_phone'), ''), 20) end,
    case when v_maintains then lower(left(nullif(trim(p ->> 'stock_poc_email'), ''), 200)) end,
    case when not v_maintains then (p ->> 'frido_manage_stock')::boolean end,
    left(nullif(trim(p ->> 'referred_by'), ''), 120), left(nullif(trim(p ->> 'notes'), ''), 1000)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- admin: turn an application into a facility. The login itself is created by the admin-create-user Edge Function.
create or replace function public.approve_vendor_application(
  p_id bigint,
  p_code text,
  p_name text,
  p_fulfiller_ss_id bigint,
  p_margin_pct numeric,
  p_is_consignment boolean,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.vendor_applications;
  v_fac bigint;
  v_code text := upper(trim(p_code));
begin
  if not public.is_admin() then raise exception 'Only admins can approve applications' using errcode = '42501'; end if;
  select * into a from public.vendor_applications where id = p_id for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending' then raise exception 'This application is already %', a.status; end if;
  if exists (select 1 from public.facilities where code = v_code) then
    raise exception 'Facility code % is already used', v_code;
  end if;
  if p_fulfiller_ss_id is not null and not exists (
    select 1 from public.facilities where id = p_fulfiller_ss_id and type = 'super_stockist'
  ) then
    raise exception 'Pick a super stockist';
  end if;

  insert into public.facilities (
    code, name, type, legal_name, gstin, address, city, state, pincode, region,
    contact_name, contact_phone, contact_email, default_margin_pct, is_consignment, fulfiller_ss_id, notes
  ) values (
    v_code, coalesce(nullif(trim(p_name), ''), a.business_name), a.applying_as, a.legal_name, a.gstin,
    a.address, a.city, a.state, a.pincode, a.city,
    a.poc_name, a.poc_phone, a.poc_email, coalesce(p_margin_pct, 0), coalesce(p_is_consignment, false),
    case when a.applying_as = 'retailer' then p_fulfiller_ss_id end,
    concat_ws(E'\n',
      'Onboarded from application #' || a.id || coalesce(' (' || a.business_type || ')', ''),
      'Products: ' || nullif(concat_ws(', ', array_to_string(a.product_categories, ', '), a.products_other), ''),
      case when a.maintains_stock
        then 'Keeps its own stock at: ' || a.stock_location || coalesce(' · tracked in ' || a.stock_tracking, '')
             || coalesce(' · stock contact ' || nullif(concat_ws(' ', a.stock_poc_name, a.stock_poc_phone, a.stock_poc_email), ''), '')
        else 'Does not keep stock · Frido to maintain it: ' || case when a.frido_manage_stock then 'yes' else 'no' end
      end)
  )
  returning id into v_fac;

  update public.vendor_applications
  set status = 'approved', facility_id = v_fac, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id;
  return v_fac;
end;
$$;

create or replace function public.remove_vendor_application(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only admins can remove applications' using errcode = '42501'; end if;
  update public.vendor_applications
  set status = 'removed', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_id and status = 'pending';
  if not found then raise exception 'Only a pending application can be removed'; end if;
end;
$$;

-- ================================================================ privileges
revoke execute on function public.submit_vendor_application(jsonb), public.approve_vendor_application(bigint, text, text, bigint, numeric, boolean, text),
  public.remove_vendor_application(bigint, text), public.password_changed() from public;
grant execute on function public.submit_vendor_application(jsonb) to anon, authenticated;
grant execute on function public.approve_vendor_application(bigint, text, text, bigint, numeric, boolean, text),
  public.remove_vendor_application(bigint, text), public.password_changed() to authenticated;
revoke execute on function public.approve_vendor_application(bigint, text, text, bigint, numeric, boolean, text),
  public.remove_vendor_application(bigint, text), public.password_changed() from anon;
