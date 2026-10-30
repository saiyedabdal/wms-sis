-- Test fixtures: two POS facilities, users in every role, items covering the data problems seen live, and stock.
-- Runs as the local superuser; RPCs that check the caller are run with request.jwt.claims set.

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;

create or replace function tests.uid(p_email text) returns uuid language sql stable security definer as $$
  select id from auth.users where email = p_email
$$;
-- act as a signed-in user (call before "set role authenticated")
create or replace function tests.login(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_email), 'role', 'authenticated')::text, false)
$$;
create or replace function tests.logout() returns void language sql as $$
  select set_config('request.jwt.claims', '', false)
$$;
create or replace function tests.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'not ok - %', p_name; end if;
  raise notice 'ok - %', p_name;
end;
$$;
-- runs p_sql and passes if it fails with a message matching p_pattern (ILIKE)
create or replace function tests.throws(p_sql text, p_pattern text, p_name text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then raise notice 'ok - % (%)', p_name, sqlerrm; return; end if;
    raise exception 'not ok - %: wrong error "%"', p_name, sqlerrm;
  end;
  raise exception 'not ok - %: expected an error matching "%"', p_name, p_pattern;
end;
$$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- ---------------------------------------------------------------- users (first signup becomes the Hub admin)
insert into auth.users (email, raw_user_meta_data) values ('admin@frido.test', '{"full_name": "Frido Admin"}');
insert into auth.users (email, raw_user_meta_data) values
  ('cashier@neu.test', '{"full_name": "Asha Cashier"}'),
  ('manager@neu.test', '{"full_name": "Rohan Manager"}'),
  ('staff@other.test', '{"full_name": "Other Clinic Staff"}');

insert into public.facilities (code, name, type, city, state, default_margin_pct, is_consignment, restrict_to_assortment, address)
values ('TST-OTHER', 'Other Clinic', 'retailer', 'Mumbai', 'Maharashtra', 30, true, true, 'Andheri');
update public.facilities set address = 'Baner Road', pincode = '411045' where code = 'NEU-BNR';

update public.profiles p set is_active = true, facility_id = f.id
from public.facilities f
where f.code = 'NEU-BNR' and p.email in ('cashier@neu.test', 'manager@neu.test');
update public.profiles p set is_active = true, facility_id = f.id
from public.facilities f where f.code = 'TST-OTHER' and p.email = 'staff@other.test';

-- ---------------------------------------------------------------- items: good, service, and the live data gaps
insert into public.items (sku, name, category_name, size, hsn_code, gst_pct, mrp, enabled) values
  ('T-KNEE-M', 'Knee Cap Support', 'Orthotics', 'M', '63079090', 5, 50, true),        -- Rs 50 placeholder MRP
  ('T-KNEE-L', 'Knee Cap Support', 'Orthotics', 'L', '63079090', 5, 50, true),
  ('T-WHEEL', 'Lightweight Wheelchair', 'Wheelchairs', null, '87131010', 5, 15000, true),
  ('T-SCAN', '3D Foot Scan', 'Services', null, '998319', 18, null, true),
  ('T-NOHSN', 'Arch Insole', 'Insole', 'M', null, 5, 50, true),
  ('T-GST15', 'Seat Cushion', 'Cushions', null, '94049099', 15, 50, true),
  ('T-NOMSP', 'Posture Corrector', 'Orthotics', 'M', '63079090', 5, 50, true),
  ('T-CONC', 'Concurrency Socks', 'Socks', 'M', '61159990', 5, 50, true),
  ('T-NOTSOLD', 'Not In Assortment', 'Orthotics', null, '63079090', 5, 50, true);
insert into public.pos_service_skus (sku, note) values ('T-SCAN', 'Foot scan done at the clinic');

insert into public.facility_assortment (facility_id, sku, msp)
select f.id, x.sku, x.msp from public.facilities f
cross join (values ('T-KNEE-M', 1000), ('T-KNEE-L', 1000), ('T-WHEEL', 10000), ('T-SCAN', 500),
                   ('T-NOHSN', 300), ('T-GST15', 300), ('T-NOMSP', null), ('T-CONC', 100)) as x (sku, msp)
where f.code = 'NEU-BNR';
insert into public.facility_assortment (facility_id, sku, msp)
select f.id, 'T-KNEE-M', 1000 from public.facilities f where f.code = 'TST-OTHER';

-- ---------------------------------------------------------------- POS setup, done the way an admin would
select tests.login('admin@frido.test');
insert into public.pos_entities (code, kind, legal_name, gstin, state_name, state_code, address, upi_vpa, upi_payee_name, razorpay_enabled)
values ('FRIDO-MH', 'frido', 'Frido Arcatron Mobility Pvt Ltd', '27AAACF1234A1Z5', 'Maharashtra', '27',
        'Pune, Maharashtra', 'frido@upi', 'Frido', true),
       ('OTHER-CLINIC', 'partner', 'Other Clinic LLP', '27AAACO1234B1Z2', 'Maharashtra', '27', 'Andheri, Mumbai',
        'other@upi', 'Other Clinic', false);

select public.pos_admin_setup_facility(
  (select id from public.facilities where code = 'NEU-BNR'), (select id from public.pos_entities where code = 'FRIDO-MH'),
  'NMB1', 'NMR1',
  '{"payment_modes": ["cash", "upi_static", "upi_razorpay", "card_edc", "bank_transfer"], "require_customer": false}');
select public.pos_admin_setup_facility(
  (select id from public.facilities where code = 'TST-OTHER'), (select id from public.pos_entities where code = 'OTHER-CLINIC'),
  'OTH1', 'OTR1', '{"payment_modes": ["cash"], "require_customer": false}');

insert into public.pos_registers (facility_id, name)
select id, 'Counter 1' from public.facilities where code in ('NEU-BNR', 'TST-OTHER');

select public.pos_admin_set_staff(tests.uid('cashier@neu.test'), (select id from public.facilities where code = 'NEU-BNR'),
                                  'cashier', 'Asha', '1111');
select public.pos_admin_set_staff(tests.uid('manager@neu.test'), (select id from public.facilities where code = 'NEU-BNR'),
                                  'manager', 'Rohan', '2222');
select public.pos_admin_set_staff(tests.uid('admin@frido.test'), null, 'admin', 'Frido Admin', '9999');
select public.pos_admin_set_staff(tests.uid('staff@other.test'), (select id from public.facilities where code = 'TST-OTHER'),
                                  'manager', 'Other Staff', '3333');

insert into public.pos_therapists (facility_id, name, kind)
select id, 'Dr Mehta', 'doctor' from public.facilities where code = 'NEU-BNR';

-- stock through the Hub's own count posting
select public.post_stock_count((select id from public.facilities where code = 'NEU-BNR'), 'POS test stock',
  '[{"sku": "T-KNEE-M", "bucket": "sellable", "counted_qty": 10},
    {"sku": "T-KNEE-L", "bucket": "sellable", "counted_qty": 3},
    {"sku": "T-WHEEL", "bucket": "sellable", "counted_qty": 2},
    {"sku": "T-CONC", "bucket": "sellable", "counted_qty": 30}]');
select public.post_stock_count((select id from public.facilities where code = 'TST-OTHER'), 'POS test stock',
  '[{"sku": "T-KNEE-M", "bucket": "sellable", "counted_qty": 5}]');
select tests.logout();
