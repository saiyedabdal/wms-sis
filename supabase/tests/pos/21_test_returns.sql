-- pos_return: who may return, window and admin override, pro-rata credit, restock, refunds, exchange, idempotency.
\set ON_ERROR_STOP 1
select id as fac from public.facilities where code = 'NEU-BNR' \gset
select id as reg from public.pos_registers where facility_id = :fac \gset
select tests.uid('cashier@neu.test') as cashier, tests.uid('manager@neu.test') as manager,
       tests.uid('admin@frido.test') as admin \gset
select public.pos__fy(now()) as fy \gset

select tests.login('cashier@neu.test');
set role authenticated;
select public.pos_pin_login(:fac, :reg, :'cashier', '1111') ->> 'token' as ctok \gset
select public.pos_pin_login(:fac, :reg, :'manager', '2222') ->> 'token' as mtok \gset
select public.pos_pin_login(:fac, :reg, :'admin', '9999') ->> 'token' as atok \gset

-- a 3-unit sale with a cart discount so the credit has to be pro-rated
select public.pos_upsert_customer(:fac, '{"phone": "+91 98765 43210", "name": "Meera"}') ->> 'id' as cust \gset
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok',
  format('{"lines":[{"sku":"T-CONC","qty":3}],"cart_discount":{"kind":"amount","value":10},"customer_id":%s}', :cust)::jsonb,
  '[{"mode":"cash","amount":290}]') as inv \gset
select id as line from public.pos_invoice_lines where invoice_id = (:'inv'::jsonb ->> 'id')::bigint \gset
select tests.ok((select is_new_customer from public.pos_invoices where id = (:'inv'::jsonb ->> 'id')::bigint), 'first visit is a new customer');

select tests.throws(format('select public.pos_return(gen_random_uuid(), %s, %L, %L, %L, %L, %L)', :'inv'::jsonb ->> 'id', :'ctok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :line), 'Wrong size', 'refund',
  '{"method":"upi","payee_vpa":"meera@okaxis"}'), 'Returns need a manager', 'a cashier cannot do returns');

select gen_random_uuid() as rref \gset
select public.pos_return(:'rref', (:'inv'::jsonb ->> 'id')::bigint, :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :line)::jsonb, 'Wrong size', 'refund',
  '{"method":"upi","payee_vpa":"meera@okaxis"}') as cn1 \gset
select tests.ok(:'cn1'::jsonb ->> 'credit_no' = 'NMR1/' || :'fy' || '/000001', 'credit note uses its own series');
select tests.ok((:'cn1'::jsonb ->> 'grand_total')::numeric = 96.67, 'one of three units credits a third of what was charged');
select tests.ok((select qty from public.stock_balances where facility_id = :fac and sku = 'T-CONC' and bucket = 'sellable') = 28,
                'returned unit is back in sellable stock');
select tests.ok((select status = 'pending' and amount = 96.67 and method = 'upi' from public.pos_refunds
                 where credit_note_id = (:'cn1'::jsonb ->> 'id')::bigint), 'an online refund request is queued');
select tests.ok(exists (select 1 from public.stock_ledger where ref_type = 'pos_credit_note' and ref_no = :'cn1'::jsonb ->> 'credit_no'
                        and movement = 'return_in' and qty_delta = 1), 'Hub ledger records the return');

select public.pos_return(:'rref', (:'inv'::jsonb ->> 'id')::bigint, :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :line)::jsonb, 'Wrong size', 'refund',
  '{"method":"upi","payee_vpa":"meera@okaxis"}') as cn1b \gset
select tests.ok((:'cn1b'::jsonb ->> 'replay')::boolean and :'cn1b'::jsonb ->> 'id' = :'cn1'::jsonb ->> 'id', 'a retried return is not doubled');
select tests.ok((select qty from public.stock_balances where facility_id = :fac and sku = 'T-CONC' and bucket = 'sellable') = 28,
                'a retried return does not restock twice');

select tests.throws(format('select public.pos_return(gen_random_uuid(), %s, %L, %L, %L, %L, %L)', :'inv'::jsonb ->> 'id', :'mtok',
  format('[{"invoice_line_id":%s,"qty":3,"restock_bucket":"sellable"}]', :line), 'x', 'refund',
  '{"method":"upi","payee_vpa":"meera@okaxis"}'), 'Only 2 of T-CONC can still be returned', 'cannot return more than is left');
select tests.throws(format('select public.pos_return(gen_random_uuid(), %s, %L, %L, %L, %L, %L)', :'inv'::jsonb ->> 'id', :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :line), 'x', 'refund', '{"method":"upi"}'),
  '%UPI ID%', 'a UPI refund needs the customer''s UPI ID');

-- the rest, as damaged, settled as an exchange
select public.pos_return(gen_random_uuid(), (:'inv'::jsonb ->> 'id')::bigint, :'mtok',
  format('[{"invoice_line_id":%s,"qty":2,"restock_bucket":"damaged"}]', :line)::jsonb, 'Torn stitching', 'exchange', null) as cn2 \gset
select tests.ok((:'cn1'::jsonb ->> 'grand_total')::numeric + (:'cn2'::jsonb ->> 'grand_total')::numeric
                = (select net_amount from public.pos_invoice_lines where id = :line), 'credits add up exactly to what was charged');
select tests.ok((select qty from public.stock_balances where facility_id = :fac and sku = 'T-CONC' and bucket = 'damaged') = 2,
                'damaged units go to the damaged bucket');

-- exchange: spend the credit note on a new sale, then refund what is left
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-CONC","qty":1}]}',
  format('[{"mode":"credit_note","amount":100,"credit_note_id":%s}]', :'cn2'::jsonb ->> 'id')::jsonb) as ex1 \gset
select tests.ok(:'ex1'::jsonb ->> 'status' = 'paid', 'a credit note pays for the exchange item');
select tests.ok((select redeemed_total from public.pos_credit_notes where id = (:'cn2'::jsonb ->> 'id')::bigint) = 100,
                'credit note balance is reduced');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-CONC","qty":1}]}', format('[{"mode":"credit_note","amount":100,"credit_note_id":%s}]', :'cn2'::jsonb ->> 'id')),
  '%has only ₹93.33 left%', 'cannot spend more than the credit note balance');
select tests.ok((public.pos_refund_credit_balance((:'cn2'::jsonb ->> 'id')::bigint, :'ctok',
                 '{"method":"upi","payee_vpa":"meera@okaxis"}') ->> 'amount')::numeric = 93.33, 'leftover credit becomes an online refund');

-- after the 10-day window only a Frido admin can accept a return
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-CONC","qty":1}]}',
  '[{"mode":"cash","amount":100}]') as old \gset
reset role;
update public.pos_invoices set invoiced_at = now() - interval '12 days' where id = (:'old'::jsonb ->> 'id')::bigint;
set role authenticated;
select id as oldline from public.pos_invoice_lines where invoice_id = (:'old'::jsonb ->> 'id')::bigint \gset
select tests.throws(format('select public.pos_return(gen_random_uuid(), %s, %L, %L, %L, %L, %L)', :'old'::jsonb ->> 'id', :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :oldline), 'Late', 'exchange', null),
  '%12 days old%Frido admin%', 'a 12-day-old invoice needs a Frido admin');
select tests.throws(format('select public.pos_return(gen_random_uuid(), %s, %L, %L, %L, %L, %L, %L)', :'old'::jsonb ->> 'id', :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :oldline), 'Late', 'exchange', null, :'mtok'),
  '%Only a Frido admin%', 'a manager cannot override the window');
select public.pos_return(gen_random_uuid(), (:'old'::jsonb ->> 'id')::bigint, :'mtok',
  format('[{"invoice_line_id":%s,"qty":1,"restock_bucket":"sellable"}]', :oldline)::jsonb, 'Late', 'exchange', null, :'atok') as late \gset
select tests.ok((select late_override_by = :'admin' from public.pos_credit_notes where id = (:'late'::jsonb ->> 'id')::bigint),
                'the admin override is recorded');

-- the invoicing entity settles refunds: Frido-invoiced means Frido ops, not the clinic
select id as refund from public.pos_refunds where credit_note_id = (:'cn1'::jsonb ->> 'id')::bigint \gset
select tests.throws(format('select public.pos_mark_refund(%s, %L, %L, null)', :refund, 'paid', 'UTR123'),
  '%invoicing entity%', 'clinic staff cannot settle a Frido-invoiced refund');
reset role;
select tests.login('admin@frido.test');
set role authenticated;
select tests.throws(format('select public.pos_mark_refund(%s, %L, null, null)', :refund, 'paid'), '%UTR%', 'paying a refund needs the UTR');
select tests.ok(public.pos_mark_refund(:refund, 'paid', 'UTR777111', 'Paid via ICICI') ->> 'status' = 'paid', 'Frido ops marks the refund paid');
reset role;
select tests.logout();
