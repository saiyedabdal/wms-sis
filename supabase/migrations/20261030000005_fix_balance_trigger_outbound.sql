-- CHECK (qty >= 0) is evaluated on the proposed INSERT row before ON CONFLICT,
-- so outbound movements must update the existing balance row directly.
create or replace function public.apply_ledger_to_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
revoke execute on function public.apply_ledger_to_balance() from public, anon, authenticated;
