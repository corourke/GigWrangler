-- #325: tracking a saved line as equipment goes through add_purchase_line_units (#183 D), so
-- track_purchase_line_as_equipment (20261007000000, rewritten in 20261011000000) has no caller
-- in the app. Nothing else in the database calls it. No CASCADE: if something did depend on it,
-- this should fail rather than take it along.
DROP FUNCTION IF EXISTS public.track_purchase_line_as_equipment(uuid);
