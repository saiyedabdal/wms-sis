-- Self-signups wait for an admin to activate them; the very first account is an active admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when v_first then 'admin' else 'facility_staff' end::public.user_role,
    v_first
  );
  return new;
end;
$$;

-- reference data only for active users
drop policy "read facilities" on public.facilities;
create policy "read facilities" on public.facilities for select to authenticated
  using ((select public.auth_role()) is not null);
drop policy "read items" on public.items;
create policy "read items" on public.items for select to authenticated
  using ((select public.auth_role()) is not null);
drop policy "read bundles" on public.bundle_components;
create policy "read bundles" on public.bundle_components for select to authenticated
  using ((select public.auth_role()) is not null);
