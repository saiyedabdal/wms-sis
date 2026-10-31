-- Super admin: an admin who can also switch the portal to any role's view (manager, ops, retailer, SS).
-- Own migration because a new enum value can't be used in the transaction that adds it.
alter type public.user_role add value if not exists 'super_admin' before 'admin';
