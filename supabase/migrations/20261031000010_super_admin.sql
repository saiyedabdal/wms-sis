-- Super admin = admin rights + a "View as" switch in the portal (UI only; data access stays super admin).

-- ================================================================ roles
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'super_admin', false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('super_admin', 'admin', 'manager'), false)
$$;

create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('super_admin', 'admin', 'manager', 'ops'), false)
$$;

-- only a super admin can make someone super admin, or change / deactivate a super admin
-- (server-side callers with no auth.uid(), e.g. the service role, are not limited)
create or replace function public.guard_super_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.role = 'super_admin' or new.role = 'super_admin')
     and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Only a super admin can change a super admin login' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_super_admin_profile
before update on public.profiles
for each row execute function public.guard_super_admin_profile();

-- ================================================================ requests
-- p_submit: Frido users (e.g. a super admin in the retailer view) can submit on the facility's behalf,
-- which puts the request straight into the ops review queue instead of creating a draft.
drop function public.create_order_request(bigint, bigint, text, jsonb);
create function public.create_order_request(
  p_facility_id bigint,
  p_warehouse_id bigint,
  p_notes text,
  p_lines jsonb,   -- [{sku, bucket, qty, suggested_qty, notes}]
  p_submit boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_draft boolean := public.is_ops() and not coalesce(p_submit, false);
begin
  perform public.assert_facility_access(p_facility_id);
  if not exists (select 1 from public.facilities where id = p_facility_id and is_active and type <> 'warehouse') then
    raise exception 'Facility not found or inactive';
  end if;
  insert into public.order_requests (request_no, facility_id, warehouse_id, notes, status, source, submitted_by, submitted_at)
  values (
    public.next_doc_no('REQ'), p_facility_id, coalesce(p_warehouse_id, public.default_warehouse_id()), p_notes,
    case when v_draft then 'draft' else 'submitted' end::public.request_status,
    case when v_draft then 'ops' else 'retailer' end,
    case when v_draft then null else auth.uid() end,
    case when v_draft then null else now() end
  )
  returning id into v_id;
  perform public._replace_request_lines(v_id, p_lines);
  return v_id;
end;
$$;

-- ================================================================ privileges
revoke execute on function public.is_super_admin(), public.guard_super_admin_profile(),
  public.create_order_request(bigint, bigint, text, jsonb, boolean) from public, anon;
grant execute on function public.is_super_admin(), public.create_order_request(bigint, bigint, text, jsonb, boolean) to authenticated;
revoke execute on function public.guard_super_admin_profile() from authenticated;
