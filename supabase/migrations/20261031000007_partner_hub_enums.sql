-- Frido Partner Hub (v2): enum changes. Kept separate because new enum values must be committed before use.

-- facilities: partner clinics are now "retailers"; super stockists join the network
alter type public.facility_type rename value 'partner_clinic' to 'retailer';
alter type public.facility_type add value if not exists 'super_stockist';

-- requests now go draft/submitted -> pending_approval -> approved (the old "raised" meant approved)
alter type public.request_status rename value 'raised' to 'approved';
alter type public.request_status add value if not exists 'draft' before 'approved';
alter type public.request_status add value if not exists 'submitted' before 'approved';
alter type public.request_status add value if not exists 'pending_approval' before 'approved';
alter type public.request_status add value if not exists 'rejected' after 'approved';

-- the manager approves requests in-app
alter type public.user_role add value if not exists 'manager' after 'admin';

-- units received outside the ambit of a shipment wait here until Frido decides
alter type public.stock_bucket add value if not exists 'quarantine';

-- stock leaving a super stockist on dispatch, and returns arriving back at one
alter type public.movement_type add value if not exists 'dispatch';
alter type public.movement_type add value if not exists 'return_in';

-- units refused at the door during inward
alter type public.discrepancy_reason add value if not exists 'rejected';
