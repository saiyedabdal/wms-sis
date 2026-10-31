#!/usr/bin/env bash
# Concurrency: many tills checking out at the same moment.
#  1. Ten parallel retries of ONE checkout reference create exactly one invoice.
#  2. More parallel checkouts than units in stock: the extra ones fail, stock ends at 0 (never negative),
#     and the invoice numbers that were issued are unique and gap-free.
set -euo pipefail
q() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fac=$(q -c "select id from public.facilities where code = 'NEU-BNR'")
reg=$(q -c "select id from public.pos_registers where facility_id = $fac")
cashier=$(q -c "select tests.uid('cashier@neu.test')")
claims="{\"sub\":\"$cashier\",\"role\":\"authenticated\"}"
as_cashier="select set_config('request.jwt.claims', '$claims', false); set role authenticated;"
tok=$(q -c "$as_cashier select public.pos_pin_login($fac, $reg, '$cashier', '1111') ->> 'token'" | tail -1)
checkout() {  # $1 = client ref
  q -c "$as_cashier select public.pos_checkout('$1', $fac, $reg, '$tok', '{\"lines\":[{\"sku\":\"T-CONC\",\"qty\":1}]}',
        '[{\"mode\":\"cash\",\"amount\":100}]') ->> 'invoice_no'" 2>&1 | grep -E '^NMB1/|ERROR' | tail -1
}
fail() { echo "not ok - $1"; exit 1; }

# 1. same reference, 10 at once
ref=$(q -c "select gen_random_uuid()")
for i in $(seq 1 10); do checkout "$ref" > "$tmp/same.$i" & done
wait
grep -q '^NMB1/' "$tmp/same.1" || fail "checkout failed: $(cat "$tmp/same.1")"
[ "$(cat "$tmp"/same.* | sort -u | wc -l)" = 1 ] || fail "parallel retries returned different invoices: $(cat "$tmp"/same.* | sort -u | tr '\n' ' ')"
[ "$(q -c "select count(*) from public.pos_invoices where client_ref = '$ref'")" = 1 ] || fail "parallel retries created more than one invoice"
echo "ok - 10 parallel retries of one checkout create exactly one invoice ($(cat "$tmp/same.1"))"

# 2. drain the stock from 10 more tills than there are units
stock=$(q -c "select qty from public.stock_balances where facility_id = $fac and sku = 'T-CONC' and bucket = 'sellable'")
before=$(q -c "select coalesce(max(seq), 0) from public.pos_invoices where series_code = 'NMB1'")
n=$((stock + 10))
for i in $(seq 1 "$n"); do checkout "$(cat /proc/sys/kernel/random/uuid)" > "$tmp/drain.$i" & done
wait
won=$(cat "$tmp"/drain.* | grep -c '^NMB1/' || true)
lost=$(cat "$tmp"/drain.* | grep -c 'in stock' || true)
[ "$won" = "$stock" ] || fail "expected $stock sales, got $won ($(cat "$tmp"/drain.* | sort | uniq -c | head -5))"
[ "$lost" = 10 ] || fail "expected 10 out-of-stock refusals, got $lost: $(cat "$tmp"/drain.* | grep -v '^NMB1/' | sort | uniq -c)"
echo "ok - $n tills raced for $stock units: $won sold, $lost refused for stock"
[ "$(q -c "select qty from public.stock_balances where facility_id = $fac and sku = 'T-CONC' and bucket = 'sellable'")" = 0 ] \
  || fail "stock did not end at 0"
echo "ok - stock ends at exactly 0, never negative"
read -r cnt mn mx dist <<<"$(q -F ' ' -c "select count(*), min(seq), max(seq), count(distinct seq) from public.pos_invoices
                                         where series_code = 'NMB1' and seq > $before")"
[ "$cnt" = "$stock" ] && [ "$dist" = "$cnt" ] && [ "$mn" = $((before + 1)) ] && [ "$mx" = $((before + stock)) ] \
  || fail "numbers not gap-free: count=$cnt distinct=$dist min=$mn max=$mx after $before"
echo "ok - $cnt invoice numbers issued in parallel are unique and gap-free ($mn..$mx)"
