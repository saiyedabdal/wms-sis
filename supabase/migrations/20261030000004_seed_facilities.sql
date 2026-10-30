-- Initial facilities. Neuromatics margins from "Neuromatics-Products_List-FINAL-29THOCT.xlsx":
-- non-mobility 30% + GST on MSP, mobility 10% + GST on MSP.
insert into public.facilities (code, name, type, city, state, default_margin_pct, is_consignment, restrict_to_assortment, notes)
values
  ('WH-MAIN', 'Frido Central Warehouse', 'warehouse', null, 'Maharashtra', 0, false, false,
   'Runs on Uniware. Dispatches are entered manually in the WMS.'),
  ('NEU-BNR', 'Neuromatics, Baner', 'partner_clinic', 'Pune', 'Maharashtra', 30, true, true,
   'Physio partner. Consignment stock; first delivery 27 Oct 2026.'),
  ('STF-ATP', 'STF Area, ATP', 'internal', 'Pune', 'Maharashtra', 0, false, false,
   'STF team stock for trainings, demos and samples.')
on conflict (code) do nothing;

insert into public.facility_category_margins (facility_id, category_name, margin_pct)
select f.id, c.category_name, c.margin_pct
from public.facilities f
cross join (values
  ('Orthotics', 30), ('Cushions', 30), ('Pillows', 30), ('Socks', 30), ('Footwear', 30), ('Insole', 30),
  ('Medical Cushions', 30), ('Ankle Support', 30), ('Health and wellness', 30), ('Mouse Wrist', 30),
  ('Mobility', 10), ('Wheelchairs', 10), ('Wheelchair Accessories', 10), ('Concentrator', 10)
) as c (category_name, margin_pct)
where f.code = 'NEU-BNR'
on conflict do nothing;
