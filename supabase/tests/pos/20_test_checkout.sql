-- pos_checkout: pricing, idempotency, stock, discount limits, numbering, payments, Hub posting.
\set ON_ERROR_STOP 1
select id as fac from public.facilities where code = 'NEU-BNR' \gset
select id as reg from public.pos_registers where facility_id = :fac \gset
select tests.uid('cashier@neu.test') as cashier, tests.uid('manager@neu.test') as manager,
       tests.uid('admin@frido.test') as admin \gset
select public.pos__fy(now()) as fy \gset

select tests.login('cashier@neu.test');
set role authenticated;

-- ------------------------------------------------------------ PIN switch and shift
select tests.ok((public.pos_pin_login(:fac, :reg, :'cashier', '0000') ->> 'ok')::boolean = false, 'wrong PIN is refused');
select public.pos_pin_login(:fac, :reg, :'cashier', '1111') ->> 'token' as ctok \gset
select tests.ok(length(:'ctok') = 48, 'PIN login returns a staff token');
select public.pos_pin_login(:fac, :reg, :'manager', '2222') ->> 'token' as mtok \gset
select public.pos_pin_login(:fac, :reg, :'admin', '9999') ->> 'token' as atok \gset

select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1}]}', '[{"mode":"cash","amount":1000}]'), '%open a shift%', 'checkout needs an open shift');
select (public.pos_open_shift(:fac, :reg, :'ctok', 2000) ->> 'id') as shift \gset
select tests.ok((public.pos_open_shift(:fac, :reg, :'ctok', 0) ->> 'id')::bigint = :shift, 'opening a shift twice returns the open one');

-- ------------------------------------------------------------ pricing
select public.pos_price_cart(:fac, '{"lines":[{"sku":"T-KNEE-M","qty":2}]}') as q \gset
select tests.ok((:'q'::jsonb ->> 'grand_total')::numeric = 2000, 'priced at the facility MSP, not the Rs 50 Uniware MRP');
select tests.ok((:'q'::jsonb ->> 'taxable_total')::numeric = 1904.76 and (:'q'::jsonb ->> 'cgst_total')::numeric = 47.62
                and (:'q'::jsonb ->> 'sgst_total')::numeric = 47.62, 'GST 5% split into CGST/SGST from the inclusive price');
select tests.ok(:'q'::jsonb -> 'lines' -> 0 -> 'mrp' = 'null'::jsonb, 'placeholder MRP is not printed');
select public.pos_price_cart(:fac, '{"lines":[{"sku":"T-NOHSN","qty":1},{"sku":"T-GST15","qty":1},{"sku":"T-NOMSP","qty":1},
  {"sku":"T-NOTSOLD","qty":1},{"sku":"NOPE","qty":1}]}') as q2 \gset
select tests.ok((select array_agg(p ->> 'code' order by p ->> 'code') from jsonb_array_elements(:'q2'::jsonb -> 'problems') p
                 where p ->> 'code' <> 'insufficient_stock')
  = array['bad_gst', 'no_hsn', 'no_price', 'not_in_assortment', 'unknown'], 'data problems are reported per line');
select public.pos_price_cart(:fac, '{"lines":[{"sku":"T-KNEE-M","qty":1},{"sku":"T-WHEEL","qty":1}],
                                     "cart_discount":{"kind":"amount","value":110}}') as q3 \gset
select tests.ok((:'q3'::jsonb -> 'lines' -> 0 ->> 'cart_discount')::numeric = 10
                and (:'q3'::jsonb -> 'lines' -> 1 ->> 'cart_discount')::numeric = 100, 'cart discount is pro-rated across lines');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-NOHSN","qty":1}]}', '[{"mode":"cash","amount":300}]'), '%no HSN%', 'checkout blocks a SKU without HSN');

-- ------------------------------------------------------------ a cash sale end to end
select gen_random_uuid() as ref1 \gset
select public.pos_checkout(:'ref1', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":2}]}', '[{"mode":"cash","amount":2000,"tendered":2000}]') as r1 \gset
select tests.ok(:'r1'::jsonb ->> 'status' = 'paid', 'cash sale is paid at once');
select tests.ok(:'r1'::jsonb ->> 'invoice_no' = 'NMB1/' || :'fy' || '/000001', 'first invoice is NMB1/<FY>/000001');
select tests.ok(length(:'r1'::jsonb ->> 'invoice_no') = 16, 'invoice number is 16 characters');
select tests.ok((select qty from public.stock_balances b join public.facilities f on f.id = b.facility_id
                 where f.code = 'NEU-BNR' and sku = 'T-KNEE-M' and bucket = 'sellable') = 8, 'stock reduced in the Hub');
select tests.ok(exists (select 1 from public.sales s join public.sale_lines l on l.sale_id = s.id
                        where s.bill_ref = :'r1'::jsonb ->> 'invoice_no' and l.sku = 'T-KNEE-M' and l.qty = 2 and l.msp = 1000
                          and l.margin_pct = 30), 'Hub sale booked via create_sale with MSP and margin for settlement');
select tests.ok((select hub_sale_id is not null from public.pos_invoices where id = (:'r1'::jsonb ->> 'id')::bigint),
                'invoice links to the Hub sale');

-- ------------------------------------------------------------ idempotency
select public.pos_checkout(:'ref1', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":2}]}', '[{"mode":"cash","amount":2000}]') as r1b \gset
select tests.ok((:'r1b'::jsonb ->> 'replay')::boolean and :'r1b'::jsonb ->> 'id' = :'r1'::jsonb ->> 'id',
                'retrying the same checkout returns the same invoice');
select tests.ok((select qty from public.stock_balances b join public.facilities f on f.id = b.facility_id
                 where f.code = 'NEU-BNR' and sku = 'T-KNEE-M' and bucket = 'sellable') = 8, 'a retry does not touch stock again');
select tests.ok((select count(*) from public.pos_invoices where client_ref = :'ref1') = 1, 'one invoice per checkout reference');

-- ------------------------------------------------------------ stock never goes negative
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-L","qty":4}]}', '[{"mode":"cash","amount":4000}]'), 'Only 3 of T-KNEE-L in stock', 'cannot sell more than on hand');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-L","qty":2},{"sku":"T-KNEE-L","qty":2}]}', '[{"mode":"cash","amount":4000}]'),
  'Only 3 of T-KNEE-L in stock', 'the same SKU on two lines is checked together');

-- ------------------------------------------------------------ payments
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-L","qty":1}]}', '[{"mode":"cash","amount":900}]'), '%must add up%', 'payments must equal the total');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-L","qty":1}]}', '[{"mode":"upi_static","amount":1000}]'), '%UTR%', 'static UPI needs the UTR');
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-KNEE-L","qty":1},{"sku":"T-SCAN","qty":1}]}',
  '[{"mode":"cash","amount":500},{"mode":"card_edc","amount":1000,"reference":"RRN123456"}]') as r2 \gset
select tests.ok(:'r2'::jsonb ->> 'invoice_no' = 'NMB1/' || :'fy' || '/000002', 'failed checkouts leave no gap in the series');
select tests.ok(jsonb_array_length(:'r2'::jsonb -> 'payments') = 2, 'split payment across cash and card');
select tests.ok((select count(*) from public.sale_lines l join public.sales s on s.id = l.sale_id
                 where s.bill_ref = :'r2'::jsonb ->> 'invoice_no') = 1, 'service line is not posted to Hub stock');

-- bank transfer: waits for the UTR, holds the stock, no number until paid
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-KNEE-L","qty":2}]}',
  '[{"mode":"bank_transfer","amount":2000}]') as r3 \gset
select tests.ok(:'r3'::jsonb ->> 'status' = 'awaiting_payment' and :'r3'::jsonb ->> 'invoice_no' is null,
                'bank transfer waits with no invoice number');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-L","qty":1}]}', '[{"mode":"cash","amount":1000}]'), 'Only 0 of T-KNEE-L in stock',
  'an unpaid draft holds its stock');
select public.pos_confirm_payment((:'r3'::jsonb -> 'payments' -> 0 ->> 'id')::bigint, :'ctok', 'UTR998877') as r3b \gset
select tests.ok(:'r3b'::jsonb ->> 'status' = 'paid' and :'r3b'::jsonb ->> 'invoice_no' = 'NMB1/' || :'fy' || '/000003',
                'confirming the transfer numbers and posts the invoice');

-- ------------------------------------------------------------ discount limits (cashier 5%, manager 10%, admin above)
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":5}]}', '[{"mode":"cash","amount":950}]') as r4 \gset
select tests.ok(:'r4'::jsonb ->> 'status' = 'paid', 'cashier can give 5% without approval');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":8}]}', '[{"mode":"cash","amount":920}]'),
  '%needs a manager%', '8% from a cashier needs a manager PIN');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":3},{"sku":"T-WHEEL","qty":1}],
    "cart_discount":{"kind":"amount","value":400}}', '[{"mode":"cash","amount":10570}]'),
  '%needs a manager%', 'limit applies per line after pro-rating, not to the cart average');
select tests.ok((public.pos_approve_discount(:fac, :'ctok', :'manager', '1234', 8, 'Loyal patient') ->> 'ok')::boolean = false,
                'manager approval with a wrong PIN is refused');
select tests.ok((public.pos_approve_discount(:fac, :'ctok', :'cashier', '1111', 8, 'x') ->> 'ok')::boolean = false,
                'a cashier cannot approve');
select (public.pos_approve_discount(:fac, :'ctok', :'manager', '2222', 8, 'Loyal patient') ->> 'approval_id') as appr \gset
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok',
  format('{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":8}],"approval_id":%s}', :appr)::jsonb,
  '[{"mode":"cash","amount":920}]') as r5 \gset
select tests.ok(:'r5'::jsonb ->> 'status' = 'paid', '8% goes through with the manager''s approval');
select tests.ok((select approver_id = :'manager' and used_at is not null from public.pos_discount_approvals where id = :appr),
                'approver is logged and the approval is used up');
select tests.throws(format('select public.pos_checkout(gen_random_uuid(), %s, %s, %L, %L, %L)', :fac, :reg, :'ctok',
  format('{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":8}],"approval_id":%s}', :appr),
  '[{"mode":"cash","amount":920}]'), '%needs a manager%', 'an approval cannot be reused');
select tests.ok((public.pos_approve_discount(:fac, :'ctok', :'manager', '2222', 12, 'Big order') ->> 'ok')::boolean = false,
                'a manager cannot approve above 10%');
select (public.pos_approve_discount(:fac, :'ctok', :'admin', '9999', 12, 'Big order') ->> 'approval_id') as appr2 \gset
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok',
  format('{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":12}],"approval_id":%s}', :appr2)::jsonb,
  '[{"mode":"cash","amount":880}]') as r6 \gset
select tests.ok(:'r6'::jsonb ->> 'status' = 'paid', 'a Frido admin can approve 12%');
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'mtok',
  '{"lines":[{"sku":"T-KNEE-M","qty":1,"disc_kind":"pct","disc_value":10}]}', '[{"mode":"cash","amount":900}]') as r7 \gset
select tests.ok((select approver_id = :'manager' and approver_level = 'manager' from public.pos_discount_approvals a
                 join public.pos_invoices i on i.approval_id = a.id where i.id = (:'r7'::jsonb ->> 'id')::bigint),
                'a manager''s own 10% sale is self-approved and logged');

-- ------------------------------------------------------------ Razorpay webhook path (service role, no user)
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-KNEE-M","qty":1}]}',
  '[{"mode":"upi_razorpay","amount":1000}]') as r8 \gset
reset role;
select tests.logout();
set role service_role;
select public.pos_attach_gateway_ref((:'r8'::jsonb -> 'payments' -> 0 ->> 'id')::bigint, 'qr_TEST1');
select public.pos_gateway_payment('qr_TEST1', 'pay_TEST1', 1000, 'captured') as r8b \gset
select tests.ok(:'r8b'::jsonb ->> 'status' = 'paid' and :'r8b'::jsonb ->> 'invoice_no' is not null,
                'webhook confirmation finalises the invoice without a user session');
select public.pos_gateway_payment('qr_TEST1', 'pay_TEST1', 1000, 'captured') as r8c \gset
select tests.ok(:'r8c'::jsonb ->> 'invoice_no' = :'r8b'::jsonb ->> 'invoice_no', 'webhook retries are idempotent');
reset role;
select tests.ok((select created_by = tests.uid('cashier@neu.test') from public.sales where bill_ref = :'r8b'::jsonb ->> 'invoice_no'),
                'Hub sale from the webhook is attributed to the cashier');

-- confirmed payment + stock gone meanwhile -> needs attention, money not lost
select tests.login('cashier@neu.test');
set role authenticated;
select public.pos_checkout(gen_random_uuid(), :fac, :reg, :'ctok', '{"lines":[{"sku":"T-WHEEL","qty":2}]}',
  '[{"mode":"bank_transfer","amount":20000}]') as r9 \gset
reset role;
select tests.login('admin@frido.test');
select public.create_sale(:fac, '{"notes": "sold outside the POS"}', '[{"sku": "T-WHEEL", "qty": 1}]');
select tests.login('cashier@neu.test');
set role authenticated;
select public.pos_confirm_payment((:'r9'::jsonb -> 'payments' -> 0 ->> 'id')::bigint, :'ctok', 'UTR555000') as r9b \gset
select tests.ok(:'r9b'::jsonb ->> 'status' = 'needs_attention' and :'r9b'::jsonb ->> 'attention_reason' ilike '%Insufficient stock%',
                'a confirmed payment that cannot finalise goes to Needs attention');
select tests.ok((select status from public.pos_payments where id = (:'r9'::jsonb -> 'payments' -> 0 ->> 'id')::bigint) = 'confirmed',
                'the confirmed payment is kept');
reset role;
select tests.logout();
