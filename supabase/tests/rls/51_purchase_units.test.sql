-- #183: one purchase line of N makes N units (or one lot), each linked to its line;
-- every unit on a depreciated line is depreciated.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;
CREATE FUNCTION rls_test.line(p_desc text) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM purchases WHERE description = p_desc AND row_type = 'line' LIMIT 1 $$;
-- The units and lots of the line with this description.
CREATE FUNCTION rls_test.units_of(p_desc text) RETURNS SETOF assets LANGUAGE sql AS
  $$ SELECT * FROM assets WHERE purchase_line_id = rls_test.line(p_desc) $$;
CREATE FUNCTION rls_test.line_json(p_desc text, p_qty int, p_treatment text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-06-01', 'quantity', p_qty,
    'item_price', 900, 'item_cost', 949, 'line_cost', 949 * p_qty, 'description', p_desc, 'tax_treatment', p_treatment) $$;
CREATE FUNCTION rls_test.unit_json(p_line int, p_model text, p_qty int DEFAULT 1, p_serial text DEFAULT NULL, p_tag text DEFAULT NULL,
                                   p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', p_line, 'acquisition_date', '2026-06-01',
    'category', 'Audio', 'manufacturer_model', p_model, 'quantity', p_qty, 'serial_number', p_serial, 'tag_number', p_tag,
    'item_price', 900, 'item_cost', 949, 'replacement_value', 1049, 'status', 'Active', 'insurance_policy_added', false) || p_extra $$;

-- The v2 call as SQL text, built here: the user running it can't see the rls_test schema.
CREATE FUNCTION rls_test.v2(p_org text, p_items jsonb[], p_units jsonb[]) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.create_purchase_transaction_v2(%L::jsonb, %L::jsonb[], %L::jsonb[])',
    jsonb_build_object('organization_id', rls_test.u(p_org), 'purchase_date', '2026-06-01', 'vendor', 'V'), p_items, p_units) $$;
CREATE FUNCTION rls_test.add_units(p_line uuid, p_org text) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.add_purchase_line_units(%L, %L::jsonb[])', p_line,
    ARRAY[jsonb_build_object('organization_id', rls_test.u(p_org), 'manufacturer_model', 'QSC K12.2', 'category', 'Audio')]) $$;

-- 1. A line of 3 tagged speakers, a lot of 10 cables, and an expensed tagged unit ------------
SELECT rls_test.as_user('a_manager');
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-06-01', 'vendor', 'Sweetwater', 'total_inv_amount', 5000),
  ARRAY[rls_test.line_json('three K12s', 3, 'depreciate'), rls_test.line_json('ten cables', 10, 'expense'),
        rls_test.line_json('one DI', 1, 'expense')],
  ARRAY[rls_test.unit_json(0, 'QSC K12.2', 1, 'GAA1', 'DSL-0101'), rls_test.unit_json(0, 'QSC K12.2', 1, NULL, 'DSL-0102'),
        rls_test.unit_json(0, 'QSC K12.2', 1, 'GAA3', NULL),
        rls_test.unit_json(1, 'XLR Cable, 25 ft', 10),
        rls_test.unit_json(2, 'Radial J48', 1, 'R1', NULL, '{"recovery_period": 7}')]);

SELECT rls_test.expect('A line of 3 units makes 3 records', (SELECT count(*)::int FROM rls_test.units_of('three K12s')), 3);
SELECT rls_test.expect('Each unit keeps its own serial or tag, quantity 1',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE quantity = 1
     AND ((serial_number = 'GAA1' AND tag_number = 'DSL-0101') OR (serial_number IS NULL AND tag_number = 'DSL-0102')
          OR (serial_number = 'GAA3' AND tag_number IS NULL))), 3);
SELECT rls_test.expect('Each unit gets the line''s unit cost',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE item_cost = 949 AND item_price = 900), 3);
SELECT rls_test.expect('All 3 units are one item',
  (SELECT count(DISTINCT equipment_item_id)::int FROM rls_test.units_of('three K12s')), 1);
SELECT rls_test.expect('Every unit on a depreciated line gets its category''s recovery period (Audio: 7)',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE recovery_period = 7), 3);
SELECT rls_test.expect('Every unit on a depreciated line counts as depreciated',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE public.asset_depreciated_line_date(id) = '2026-06-01'), 3);
SELECT rls_test.expect('The line points at one of its units, marking it tracked',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id AND a.purchase_line_id = p.id
    WHERE p.id = rls_test.line('three K12s')), 1);
SELECT rls_test.expect('A lot line makes one record of 10',
  (SELECT count(*)::int FROM rls_test.units_of('ten cables') WHERE quantity = 10 AND serial_number IS NULL), 1);
SELECT rls_test.expect('A lot line points at its lot',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id WHERE p.id = rls_test.line('ten cables') AND a.quantity = 10), 1);
SELECT rls_test.expect('Expensed equipment gets no recovery period, even if one is sent',
  (SELECT count(*)::int FROM rls_test.units_of('one DI') WHERE recovery_period IS NULL), 1);

-- 2. Refused --------------------------------------------------------------------------------
SELECT rls_test.expect('A correct call goes through (so the refusals below are real)',
  rls_test.run('a_manager', rls_test.v2('org_a', ARRAY[rls_test.line_json('ok', 1, 'expense')], ARRAY[rls_test.unit_json(0, 'QSC K12.2')])), 1);
SELECT rls_test.expect('A unit with a serial can''t have quantity 2',
  rls_test.run('a_manager', rls_test.v2('org_a', ARRAY[rls_test.line_json('bad', 2, 'expense')], ARRAY[rls_test.unit_json(0, 'QSC K12.2', 2, 'GAA9')])), -1);
SELECT rls_test.expect('A unit must name a line of this purchase',
  rls_test.run('a_manager', rls_test.v2('org_a', ARRAY[rls_test.line_json('bad', 1, 'expense')], ARRAY[rls_test.unit_json(1, 'QSC K12.2')])), -1);
SELECT rls_test.expect('Staff can''t record purchases',
  rls_test.run('a_staff', rls_test.v2('org_a', ARRAY[rls_test.line_json('staff', 1, 'expense')], ARRAY[rls_test.unit_json(0, 'QSC K12.2')])), -1);
SELECT rls_test.expect('Another organization''s admin can''t record a purchase here',
  rls_test.run('b_admin', rls_test.v2('org_a', ARRAY[rls_test.line_json('other org', 1, 'expense')], ARRAY[rls_test.unit_json(0, 'QSC K12.2')])), -1);

-- 3. An item picked directly ------------------------------------------------------------------
SELECT rls_test.as_user('a_manager');
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-06-01', 'vendor', 'V'),
  ARRAY[rls_test.line_json('picked', 1, 'expense')],
  ARRAY[rls_test.unit_json(0, 'K12.2 (as typed on the invoice)', 1, NULL, NULL,
        jsonb_build_object('equipment_item_id', (SELECT equipment_item_id FROM rls_test.units_of('three K12s') LIMIT 1)))]);
SELECT rls_test.expect('A picked item is used, whatever the model text',
  (SELECT count(*)::int FROM rls_test.units_of('picked')
    WHERE equipment_item_id = (SELECT equipment_item_id FROM rls_test.units_of('three K12s') LIMIT 1)), 1);
INSERT INTO equipment_items (organization_id, category, manufacturer_model, created_by, updated_by)
VALUES (rls_test.u('org_b'), 'Audio', 'B''s speaker', rls_test.u('b_admin'), rls_test.u('b_admin'));
SELECT rls_test.expect('Another organization''s item is refused',
  rls_test.run('a_manager', rls_test.v2('org_a', ARRAY[rls_test.line_json('foreign item', 1, 'expense')],
    ARRAY[rls_test.unit_json(0, 'X', 1, NULL, NULL,
      jsonb_build_object('equipment_item_id', (SELECT id FROM equipment_items WHERE organization_id = rls_test.u('org_b') LIMIT 1)))])), -1);

-- 4. Adding units to a saved line ---------------------------------------------------------------
SELECT rls_test.as_user('a_manager');
SELECT public.add_purchase_line_units(rls_test.line('three K12s'),
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'manufacturer_model', 'QSC K12.2', 'category', 'Audio', 'tag_number', 'DSL-0104')]);
SELECT rls_test.expect('Units added to a line are linked to it', (SELECT count(*)::int FROM rls_test.units_of('three K12s')), 4);
SELECT rls_test.expect('An added unit takes the line''s cost, date and vendor',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE tag_number = 'DSL-0104'
     AND item_cost = 949 AND acquisition_date = '2026-06-01' AND vendor = 'Sweetwater'), 1);
SELECT rls_test.expect('An added unit on a depreciated line is depreciated, with the default period',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE tag_number = 'DSL-0104' AND recovery_period = 7), 1);
SELECT rls_test.expect('The line still points at its first unit',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id WHERE p.id = rls_test.line('three K12s') AND a.serial_number = 'GAA1'), 1);
-- An untracked line becomes tracked.
UPDATE purchases SET asset_id = NULL WHERE id = rls_test.line('one DI');
DELETE FROM assets WHERE purchase_line_id = rls_test.line('one DI');
SELECT public.add_purchase_line_units(rls_test.line('one DI'),
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'manufacturer_model', 'Radial J48', 'category', 'Audio', 'serial_number', 'R2')]);
SELECT rls_test.expect('Adding units to an untracked line marks it tracked',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id WHERE p.id = rls_test.line('one DI') AND a.serial_number = 'R2'), 1);
SELECT rls_test.expect('A manager can add units to a line (so the refusals below are real)',
  rls_test.run('a_manager', rls_test.add_units(rls_test.line('three K12s'), 'org_a')), 1);
SELECT rls_test.expect('Staff can''t add units to a line',
  rls_test.run('a_staff', rls_test.add_units(rls_test.line('three K12s'), 'org_a')), -1);
SELECT rls_test.expect('Another organization''s admin can''t add units to a line',
  rls_test.run('b_admin', rls_test.add_units(rls_test.line('three K12s'), 'org_b')), -1);
SELECT rls_test.expect('Nor with its own organization on the units',
  rls_test.run('b_admin', rls_test.add_units(rls_test.line('three K12s'), 'org_a')), -1);
SELECT rls_test.expect('A purchase header can''t have units added',
  rls_test.run('a_manager', rls_test.add_units((SELECT parent_id FROM purchases WHERE id = rls_test.line('three K12s')), 'org_a')), -1);
-- An expensed line in a locked (filed) year can still be tracked, and stays an expense.
WITH h AS (
  INSERT INTO purchases (organization_id, row_type, purchase_date, vendor, total_inv_amount, description)
  VALUES (rls_test.u('org_a'), 'header', '2025-02-14', 'Sweetwater', 314.30, 'cables') RETURNING id)
INSERT INTO purchases (organization_id, parent_id, row_type, tax_treatment, purchase_date, vendor, quantity, item_price, item_cost, line_cost, description, category)
SELECT rls_test.u('org_a'), h.id, 'line', 'expense', '2025-02-14', 'Sweetwater', 10, 29.99, 31.43, 314.30, '2025 cables', 'Audio' FROM h;
INSERT INTO tax_years (organization_id, year) VALUES (rls_test.u('org_a'), 2025);
SELECT rls_test.expect('A line in a locked year can have units added',
  rls_test.run('a_manager', rls_test.add_units(rls_test.line('2025 cables'), 'org_a')), 1);
SELECT rls_test.as_user('a_manager');
SELECT public.add_purchase_line_units(rls_test.line('2025 cables'),
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'manufacturer_model', 'XLR cable 20ft', 'category', 'Audio', 'quantity', 10)]);
SELECT rls_test.expect('It is then tracked, still an expense, and its lot copies the line',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id
   WHERE p.id = rls_test.line('2025 cables') AND p.tax_treatment = 'expense' AND a.quantity = 10 AND a.item_cost = 31.43
     AND a.acquisition_date = '2025-02-14' AND a.vendor = 'Sweetwater'), 1);

-- 5. Changing the line's treatment reaches every unit --------------------------------------------
UPDATE purchases SET tax_treatment = 'expense' WHERE id = rls_test.line('three K12s');
SELECT rls_test.expect('Expensing the line clears every unit''s period',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE recovery_period IS NOT NULL), 0);
UPDATE purchases SET tax_treatment = 'depreciate' WHERE id = rls_test.line('three K12s');
SELECT rls_test.expect('Depreciating it again fills every unit''s period',
  (SELECT count(*)::int FROM rls_test.units_of('three K12s') WHERE recovery_period = 7), 4);
SELECT rls_test.expect('Any unit on the depreciated line can have its period set',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 5 WHERE purchase_line_id = %L AND tag_number = %L',
    rls_test.line('three K12s'), 'DSL-0102')), 1);
SELECT rls_test.expect('Equipment on an expensed line still can''t have one',
  rls_test.run('a_manager', format('UPDATE assets SET recovery_period = 5 WHERE purchase_line_id = %L',
    rls_test.line('ten cables'))), -1);
