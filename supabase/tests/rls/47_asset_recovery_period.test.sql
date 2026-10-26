-- #125 (10-07): the recovery period lives on the equipment record, only on
-- depreciated equipment, filled from its category where the category implies one.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('rh26', '00000000-0000-0000-0000-00000000f001'),
  ('rh25', '00000000-0000-0000-0000-00000000f002'),
  ('rl25', '00000000-0000-0000-0000-00000000f003'),
  ('ra25', '00000000-0000-0000-0000-00000000f004'),
  ('rman', '00000000-0000-0000-0000-00000000f005');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;
-- The recovery period of the equipment behind the line with this description ('-' = none).
CREATE FUNCTION rls_test.rp(p_desc text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(a.recovery_period::text, '-') FROM purchases p JOIN assets a ON a.id = p.asset_id
   WHERE p.description = p_desc LIMIT 1 $$;
CREATE FUNCTION rls_test.asset_of(p_desc text) RETURNS text LANGUAGE sql AS $$
  SELECT quote_literal(asset_id) FROM purchases WHERE description = p_desc LIMIT 1 $$;

-- 1. Columns ----------------------------------------------------------------------
SELECT rls_test.expect('Equipment has a recovery period',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'recovery_period'), 1);
SELECT rls_test.expect('Purchase lines no longer have one',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'recovery_period'), 0);
SELECT rls_test.expect('service_life and dep_method are gone',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'assets' AND column_name IN ('service_life', 'dep_method')), 0);
SELECT rls_test.expect('Starter categories: Computer, Networking, Software, Misc 5; Audio, Vehicles 7',
  (SELECT count(*)::int FROM equipment_categories WHERE organization_id IS NULL AND (
     (name IN ('Computer', 'Networking', 'Software', 'Misc') AND default_recovery_period = 5)
     OR (name IN ('Audio', 'Vehicles and Trailers') AND default_recovery_period = 7))), 6);
SELECT rls_test.expect('Every starter category has a default',
  (SELECT count(*)::int FROM equipment_categories WHERE organization_id IS NULL AND default_recovery_period IS NULL), 0);

-- org_a gets its own lists, and sets Networking to "ask each time".
SELECT rls_test.as_user('a_admin');
SELECT public.ensure_org_categories(rls_test.u('org_a'));
UPDATE equipment_categories SET default_recovery_period = NULL
 WHERE organization_id = rls_test.u('org_a') AND name = 'Networking';
SELECT rls_test.expect('An organization''s copy carries the defaults',
  (SELECT count(*)::int FROM equipment_categories WHERE organization_id = rls_test.u('org_a') AND name = 'Computer' AND default_recovery_period = 5), 1);

-- 2. The purchase RPC --------------------------------------------------------------
SELECT rls_test.as_user('a_manager');
-- create_purchase_transaction_v2 takes the period on the unit (v1, which also took an older
-- app's period on the line, was dropped in 20261025000000).
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-06-01', 'vendor', 'V', 'total_inv_amount', 4000),
  ARRAY[
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'depreciate', 'purchase_date', '2026-06-01', 'quantity', 1, 'item_cost', 1000, 'line_cost', 1000, 'description', 'chosen 5'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'depreciate', 'purchase_date', '2026-06-01', 'quantity', 1, 'item_cost', 1000, 'line_cost', 1000, 'description', 'audio default'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'depreciate', 'purchase_date', '2026-06-01', 'quantity', 1, 'item_cost', 1000, 'line_cost', 1000, 'description', 'networking asks'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'expense', 'purchase_date', '2026-06-01', 'quantity', 1, 'item_cost', 1000, 'line_cost', 1000, 'description', 'expensed gear')],
  ARRAY[
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 0, 'acquisition_date', '2026-06-01', 'category', 'Audio', 'recovery_period', 5, 'manufacturer_model', 'A', 'quantity', 1, 'status', 'Active', 'insurance_policy_added', false),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 1, 'acquisition_date', '2026-06-01', 'category', 'Audio', 'manufacturer_model', 'B', 'quantity', 1, 'status', 'Active', 'insurance_policy_added', false),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 2, 'acquisition_date', '2026-06-01', 'category', 'Networking', 'manufacturer_model', 'C', 'quantity', 1, 'status', 'Active', 'insurance_policy_added', false),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 3, 'acquisition_date', '2026-06-01', 'category', 'Audio', 'recovery_period', 7, 'manufacturer_model', 'D', 'quantity', 1, 'status', 'Active', 'insurance_policy_added', false)]);
SELECT rls_test.expect('A period sent with the equipment is kept', (rls_test.rp('chosen 5') = '5')::int, 1);
SELECT rls_test.expect('No period sent: the category''s default', (rls_test.rp('audio default') = '7')::int, 1);
SELECT rls_test.expect('A category with no default leaves it to be asked', (rls_test.rp('networking asks') = '-')::int, 1);
SELECT rls_test.expect('Expensed equipment gets no period, even if one is sent', (rls_test.rp('expensed gear') = '-')::int, 1);

-- 3. Direct edits --------------------------------------------------------------------
SELECT rls_test.expect('The period of depreciated equipment can be set',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 5 WHERE id = %s', rls_test.asset_of('networking asks'))), 1);
SELECT rls_test.expect('It must be 5, 7 or 15',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 10 WHERE id = %s', rls_test.asset_of('networking asks'))), -1);
SELECT rls_test.expect('Expensed equipment can''t have one',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 7 WHERE id = %s', rls_test.asset_of('expensed gear'))), -1);
INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, created_by, updated_by)
  VALUES (rls_test.u('rman'), rls_test.u('org_a'), '2026-01-01', 'Audio', 'No purchase', rls_test.u('a_admin'), rls_test.u('a_admin'));
SELECT rls_test.expect('Equipment with no purchase line can''t have one',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 7 WHERE id = %s', rls_test.id('rman'))), -1);
SELECT rls_test.expect('A new equipment record can''t start with one',
  rls_test.run('a_manager', format('INSERT INTO assets (organization_id, acquisition_date, category, manufacturer_model, recovery_period) VALUES (%s, %L, %L, %L, 7)',
    rls_test.id('org_a'), '2026-01-01', 'Audio', 'New')), -1);
SELECT rls_test.expect('Staff editing other fields of depreciated equipment is not blocked by the period',
  rls_test.run('a_manager', format('UPDATE assets SET description = %L WHERE id = %s', 'notes', rls_test.asset_of('chosen 5'))), 1);

-- 4. Category changes fill a missing period --------------------------------------------
UPDATE assets SET recovery_period = NULL WHERE id = (SELECT asset_id FROM purchases WHERE description = 'networking asks');
UPDATE assets SET category = 'Computer' WHERE id = (SELECT asset_id FROM purchases WHERE description = 'networking asks');
SELECT rls_test.expect('Moving depreciated equipment with no period into Computer gives it 5', (rls_test.rp('networking asks') = '5')::int, 1);
UPDATE assets SET category = 'Audio' WHERE id = (SELECT asset_id FROM purchases WHERE description = 'networking asks');
SELECT rls_test.expect('A period already set is kept when the category changes', (rls_test.rp('networking asks') = '5')::int, 1);

-- 5. Treatment changes ---------------------------------------------------------------
UPDATE purchases SET tax_treatment = 'expense' WHERE description = 'audio default';
SELECT rls_test.expect('Expensing the line clears the period', (rls_test.rp('audio default') = '-')::int, 1);
UPDATE purchases SET tax_treatment = 'depreciate' WHERE description = 'expensed gear';
SELECT rls_test.expect('Depreciating a line fills the category''s default', (rls_test.rp('expensed gear') = '7')::int, 1);

-- 6. Filed years: fill in, not change ----------------------------------------------------
INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, created_by, updated_by)
  VALUES (rls_test.u('ra25'), rls_test.u('org_a'), '2025-02-01', 'Networking', 'Switch', rls_test.u('a_admin'), rls_test.u('a_admin'));
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount)
  VALUES (rls_test.u('rh25'), rls_test.u('org_a'), NULL, 'header', '2025-02-01', 'V', 900);
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment, asset_id)
  VALUES (rls_test.u('rl25'), rls_test.u('org_a'), rls_test.u('rh25'), 'line', NULL, 1, 900, 900, 'switch 2025', 'depreciate', rls_test.u('ra25'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');
SELECT rls_test.expect('A filed year''s missing period can be filled in',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 5 WHERE id = %s', rls_test.id('ra25'))), 1);
UPDATE assets SET recovery_period = 5 WHERE id = rls_test.u('ra25');
SELECT rls_test.expect('A filed year''s period can''t be changed (year from the invoice)',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 7 WHERE id = %s', rls_test.id('ra25'))), -1);
SELECT rls_test.expect('A filed year''s equipment can still be renamed',
  rls_test.run('a_manager', format('UPDATE assets SET description = %L WHERE id = %s', 'rack switch', rls_test.id('ra25'))), 1);
UPDATE tax_years SET locked = false WHERE organization_id = rls_test.u('org_a') AND year = 2025;
SELECT rls_test.expect('Unlocked again, it can change',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 7 WHERE id = %s', rls_test.id('ra25'))), 1);
