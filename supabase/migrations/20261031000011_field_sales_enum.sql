-- Field sales: Frido's field team, working for the retailers / super stockists assigned to them.
-- Own migration because a new enum value can't be used in the transaction that adds it.
alter type public.user_role add value if not exists 'field_sales' after 'ops';
