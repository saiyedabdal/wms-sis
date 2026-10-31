-- RLS: staff at one clinic cannot see or act on another clinic's POS data; signed-out visitors see only shared links.
\set ON_ERROR_STOP 1
select id as neu from public.facilities where code = 'NEU-BNR' \gset
select id as oth from public.facilities where code = 'TST-OTHER' \gset
select id as oreg from public.pos_registers where facility_id = :oth \gset
select tests.uid('staff@other.test') as ostaff \gset
select share_token as neu_token from public.pos_invoices where facility_id = :neu and status = 'paid' order by id limit 1 \gset

select tests.login('staff@other.test');
set role authenticated;
select public.pos_pin_login(:oth, :oreg, :'ostaff', '3333') ->> 'token' as otok \gset
select public.pos_open_shift(:oth, :oreg, :'otok', 500) ->> 'id' as oshift \gset
select public.pos_checkout(gen_random_uuid(), :oth, :oreg, :'otok', '{"lines":[{"sku":"T-KNEE-M","qty":1}]}',
  '[{"mode":"cash","amount":1000}]') ->> 'invoice_no' as oinv \gset
select tests.ok(:'oinv' like 'OTH1/%/000001', 'numbering is per facility series');

select tests.ok((select count(*) from public.pos_invoices) = 1, 'sees only its own invoices');
select tests.ok((select count(*) from public.pos_invoices where facility_id = :neu) = 0, 'cannot see another clinic''s invoices');
select tests.ok((select count(*) from public.pos_invoice_lines l join public.pos_invoices i on i.id = l.invoice_id
                 where i.facility_id = :neu) = 0 and (select count(*) from public.pos_invoice_lines) = 1, 'invoice lines are isolated');
select tests.ok((select count(*) from public.pos_payments where facility_id = :neu) = 0, 'payments are isolated');
select tests.ok((select count(*) from public.pos_customers where facility_id = :neu) = 0, 'customers (patients) are isolated');
select tests.ok((select count(*) from public.pos_credit_notes where facility_id = :neu) = 0, 'credit notes are isolated');
select tests.ok((select count(*) from public.pos_refunds where facility_id = :neu) = 0, 'refunds are isolated');
select tests.ok((select count(*) from public.pos_shifts where facility_id = :neu) = 0, 'shifts are isolated');
select tests.ok((select count(*) from public.pos_staff where facility_id = :neu) = 0, 'staff lists are isolated');
select tests.ok((select count(*) from public.pos_v_catalog where facility_id = :neu) = 0, 'catalogue is isolated');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :neu, :oreg, :'otok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1}]}', '[{"mode":"cash","amount":1000}]'), 'Not allowed for this facility',
  'cannot check out at another clinic');
select tests.throws(format('select public.pos_price_cart(%s, %L)', :neu, '{"lines":[]}'), 'Not allowed for this facility',
  'cannot price at another clinic');
select tests.ok((public.pos_report(:neu, current_date - 30, current_date) -> 'kpi' ->> 'orders')::int = 0,
                'reports on another clinic return nothing');
select tests.throws('select pin_hash from public.pos_staff', '%permission denied%', 'PIN hashes are not readable');
select tests.throws('select * from public.pos_staff_sessions', '%permission denied%', 'staff sessions are not readable');
select tests.throws(format('insert into public.pos_invoices (client_ref, facility_id) values (gen_random_uuid(), %s)', :oth),
  '%row-level security%', 'invoices cannot be written directly');
with u as (update public.pos_invoices set grand_total = 0 returning 1) select count(*) as edited from u \gset
select tests.ok(:edited = 0, 'invoices cannot be edited directly');
select tests.throws('select public.pos__finalize(1)', '%permission denied%', 'internal helpers are not callable');
select tests.throws($$select public.pos_gateway_payment('x', 'y', 1, 'captured')$$, '%permission denied%',
  'only the webhook (service role) can confirm gateway payments');
reset role;
select tests.logout();

set role anon;
select tests.throws('select count(*) from public.pos_invoices', '%permission denied%', 'signed-out visitors cannot read invoices');
select tests.ok(public.pos_public_document(:'neu_token') ->> 'type' = 'invoice', 'the share link shows that one invoice');
select tests.ok(public.pos_public_document(:'neu_token') -> 'customer' ->> 'phone' like 'XXXXXX%' 
                or public.pos_public_document(:'neu_token') -> 'customer' ->> 'phone' is null, 'phone is masked on shared invoices');
select tests.ok(public.pos_public_document('not-a-token') is null, 'a wrong token shows nothing');
reset role;
