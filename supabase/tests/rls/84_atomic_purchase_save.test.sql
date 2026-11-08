-- B6: saving a purchase edit is one call (update_purchase_v1): equipment decisions, the header,
-- lines updated, added and removed, units, recovery periods, equipment fields and the gig money
-- the lines feed, all or nothing. Creating a purchase on a gig links its expensed lines and adds
-- their gig expenses in the same call (create_purchase_transaction_v3).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('ph', '00000000-0000-0000-0000-00000000c101'),
  ('pl_keep', '00000000-0000-0000-0000-00000000c102'),
  ('pl_drop', '00000000-0000-0000-0000-00000000c103'),
  ('pl_lot', '00000000-0000-0000-0000-00000000c104'),
  ('a_lot', '00000000-0000-0000-0000-00000000c201'),
  ('a_u1', '00000000-0000-0000-0000-00000000c202'),
  ('a_u2', '00000000-0000-0000-0000-00000000c203'),
  ('pl_units', '00000000-0000-0000-0000-00000000c105'),
  ('f_keep', '00000000-0000-0000-0000-00000000c301'),
  ('oh', '00000000-0000-0000-0000-00000000c106'),
  ('ol', '00000000-0000-0000-0000-00000000c107');

INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount, description) VALUES
  (rls_test.u('ph'), rls_test.u('org_a'), NULL, 'header', '2026-04-01', 'Sweetwater', 300, 'Parts'),
  (rls_test.u('oh'), rls_test.u('org_a'), NULL, 'header', '2025-04-01', 'Sweetwater', 50, 'Old');
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment, gig_id) VALUES
  (rls_test.u('pl_keep'),  rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 1, 100, 100, 'Tape', 'expense', rls_test.u('gig')),
  (rls_test.u('pl_drop'),  rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 1, 50,  50,  'Gels', 'expense', NULL),
  (rls_test.u('pl_lot'),   rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 10, 5,  50,  'XLR', 'expense', NULL),
  (rls_test.u('pl_units'), rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 2, 50,  100, 'Mic', 'expense', NULL),
  (rls_test.u('ol'),       rls_test.u('org_a'), rls_test.u('oh'), 'line', '2025-04-01', 1, 50,  50,  'Old part', 'expense', NULL);
INSERT INTO assets (id, organization_id, purchase_id, purchase_line_id, manufacturer_model, category, quantity, status, acquisition_date) VALUES
  (rls_test.u('a_lot'), rls_test.u('org_a'), rls_test.u('ph'), rls_test.u('pl_lot'), 'XLR', 'Audio', 10, 'Active', '2026-04-01'),
  (rls_test.u('a_u1'),  rls_test.u('org_a'), rls_test.u('ph'), rls_test.u('pl_units'), 'Mic', 'Audio', 1, 'Active', '2026-04-01'),
  (rls_test.u('a_u2'),  rls_test.u('org_a'), rls_test.u('ph'), rls_test.u('pl_units'), 'Mic', 'Audio', 1, 'Active', '2026-04-01');
UPDATE purchases SET asset_id = rls_test.u('a_lot') WHERE id = rls_test.u('pl_lot');
UPDATE purchases SET asset_id = rls_test.u('a_u1') WHERE id = rls_test.u('pl_units');
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, description, created_by) VALUES
  (rls_test.u('f_keep'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 100, 100, '2026-04-01', '2026-04-01', rls_test.u('pl_keep'), 'Tape', rls_test.u('a_admin'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

-- As p_user, call p_call, then return a number from p_check. Rolled back; -1 if refused.
CREATE FUNCTION rls_test.save(p_user text, p_call text, p_check text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_user uuid := rls_test.u(p_user); v numeric;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_call;
    RESET ROLE;
    EXECUTE p_check INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = coalesce(v, -999)::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::numeric;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;
CREATE FUNCTION rls_test.q(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;

-- The edit, as the dialog sends it.
CREATE FUNCTION rls_test.edit_plan() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'equipment', jsonb_build_array(
      jsonb_build_object('op', 'lot_quantity', 'asset_id', rls_test.u('a_lot'), 'quantity', 8),
      jsonb_build_object('op', 'remove_unit', 'asset_id', rls_test.u('a_u2'), 'how', 'inactive')),
    'header', jsonb_build_object('vendor', 'Sweetwater Sound', 'total_inv_amount', 320, 'id', gen_random_uuid()),
    'track_lines', '[]'::jsonb,
    'updated_items', jsonb_build_array(
      jsonb_build_object('id', rls_test.u('pl_keep'), 'data', jsonb_build_object('line_cost', 120, 'item_cost', 120, 'description', 'Gaff tape')),
      jsonb_build_object('id', rls_test.u('pl_lot'),  'data', jsonb_build_object('quantity', 8, 'line_cost', 40))),
    'new_items', jsonb_build_array(
      jsonb_build_object('data', jsonb_build_object('description', 'Batteries', 'quantity', 4, 'item_cost', 5, 'line_cost', 20,
                                                    'tax_treatment', 'expense', 'purchase_date', '2026-04-01', 'vendor', 'Sweetwater'),
                         'track', false, 'units', '[]'::jsonb, 'period', NULL)),
    'add_units', '[]'::jsonb,
    'removed_item_ids', jsonb_build_array(rls_test.u('pl_drop')),
    'asset_changes', jsonb_build_array(
      jsonb_build_object('asset_id', rls_test.u('a_u1'), 'data', jsonb_build_object('serial_number', 'SN-1', 'replacement_value', 99))),
    'gig_changes', jsonb_build_array(jsonb_build_object('fin_id', rls_test.u('f_keep'), 'amount', 120, 'settle', true)))
$$;
CREATE FUNCTION rls_test.edit_call(p_purchase text, p_plan jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('SELECT public.update_purchase_v1(%s, %L::jsonb)', rls_test.q(p_purchase), p_plan)
$$;

-- 1. The whole edit lands ---------------------------------------------------------------------
SELECT rls_test.expect('Edit: the header changes',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT count(*) FROM purchases WHERE id = %s AND vendor = %L AND total_inv_amount = 320', rls_test.q('ph'), 'Sweetwater Sound'))::int, 1);
SELECT rls_test.expect('  ...a line is updated',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT line_cost FROM purchases WHERE id = %s AND description = %L', rls_test.q('pl_keep'), 'Gaff tape'))::int, 120);
SELECT rls_test.expect('  ...a line is added to this purchase, in its organization',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT count(*) FROM purchases WHERE parent_id = %s AND description = %L AND row_type = %L AND organization_id = %s', rls_test.q('ph'), 'Batteries', 'line', rls_test.q('org_a')))::int, 1);
SELECT rls_test.expect('  ...a removed line is gone',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT count(*) FROM purchases WHERE id = %s', rls_test.q('pl_drop')))::int, 0);
SELECT rls_test.expect('  ...the lot takes its new size',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT quantity FROM assets WHERE id = %s', rls_test.q('a_lot')))::int, 8);
SELECT rls_test.expect('  ...a unit taken off is kept Inactive, off the line',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT count(*) FROM assets WHERE id = %s AND status = %L AND purchase_line_id IS NULL', rls_test.q('a_u2'), 'Inactive'))::int, 1);
SELECT rls_test.expect('  ...an equipment field changes',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT replacement_value FROM assets WHERE id = %s AND serial_number = %L', rls_test.q('a_u1'), 'SN-1'))::int, 99);
SELECT rls_test.expect('  ...and the gig expense follows, settled too',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT amount + amount_settled FROM gig_financials WHERE id = %s', rls_test.q('f_keep')))::int, 240);
SELECT rls_test.expect('  ...a field the save may not write (the header id) is ignored',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()),
    format('SELECT count(*) FROM purchases WHERE id = %s', rls_test.q('ph')))::int, 1);

-- 2. All or nothing ---------------------------------------------------------------------------
SELECT rls_test.expect('A step that fails (a line of another purchase) refuses the whole edit',
  rls_test.save('a_admin', rls_test.edit_call('ph', rls_test.edit_plan()
      || jsonb_build_object('updated_items', jsonb_build_array(jsonb_build_object('id', rls_test.u('ol'), 'data', jsonb_build_object('description', 'x'))))),
    'SELECT 1')::int, -1);
SELECT rls_test.expect('A filed year refuses a cost change, and nothing else is saved',
  rls_test.save('a_admin', rls_test.edit_call('oh', jsonb_build_object(
      'header', jsonb_build_object('description', 'Old parts'),
      'updated_items', jsonb_build_array(jsonb_build_object('id', rls_test.u('ol'), 'data', jsonb_build_object('line_cost', 60))))),
    'SELECT 1')::int, -1);
SELECT rls_test.expect('  ...the header is as it was', (SELECT count(*)::int FROM purchases WHERE id = rls_test.u('oh') AND description = 'Old'), 1);
SELECT rls_test.expect('Staff cannot save a purchase edit',
  rls_test.save('a_staff', rls_test.edit_call('ph', rls_test.edit_plan()), 'SELECT 1')::int, -1);
SELECT rls_test.expect('Another organization cannot',
  rls_test.save('b_admin', rls_test.edit_call('ph', rls_test.edit_plan()), 'SELECT 1')::int, -1);

-- 3. Tracking a line, with a recovery period ----------------------------------------------------
SELECT rls_test.expect('Tracking a depreciated line adds its units with the chosen period',
  rls_test.save('a_admin', rls_test.edit_call('ph', jsonb_build_object(
      'track_lines', jsonb_build_array(jsonb_build_object('line_id', rls_test.u('pl_drop'), 'period', 7,
        'units', jsonb_build_array(jsonb_build_object('organization_id', rls_test.u('org_a'), 'tag_number', 'G-1')))),
      'updated_items', jsonb_build_array(jsonb_build_object('id', rls_test.u('pl_drop'), 'data', jsonb_build_object('tax_treatment', 'depreciate'))))),
    format('SELECT count(*) FROM assets WHERE purchase_line_id = %s AND tag_number = %L AND recovery_period = 7', rls_test.q('pl_drop'), 'G-1'))::int, 1);

-- 4. Creating a purchase on a gig: lines linked and gig expenses added in the same call --------
CREATE FUNCTION rls_test.create_call(p_gig text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($f$SELECT public.create_purchase_transaction_v3(
      %L::jsonb,
      ARRAY[%L::jsonb, %L::jsonb],
      ARRAY[]::jsonb[],
      %s,
      %s)$f$,
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'vendor', 'B&H', 'total_inv_amount', 1030, 'description', 'Gig buy'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 30, 'line_cost', 30, 'description', 'Cable ties', 'tax_treatment', 'expense'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 1000, 'line_cost', 1000, 'description', 'Console', 'tax_treatment', 'depreciate'),
    CASE WHEN p_gig IS NULL THEN 'NULL' ELSE rls_test.q(p_gig) END,
    CASE WHEN p_gig IS NULL THEN 'ARRAY[]::jsonb[]' ELSE format('ARRAY[%L::jsonb]',
      jsonb_build_object('line_index', 0, 'amount', 30, 'category', 'Supplies', 'description', 'Cable ties', 'date', '2026-05-01', 'paid_at', '2026-05-02')) END)
$$;
SELECT rls_test.expect('Create on a gig: the expensed line is linked to the gig',
  rls_test.save('a_admin', rls_test.create_call('gig'),
    format('SELECT count(*) FROM purchases WHERE description = %L AND gig_id = %s', 'Cable ties', rls_test.q('gig')))::int, 1);
SELECT rls_test.expect('  ...and its gig expense is there, paid, pointing at the line',
  rls_test.save('a_admin', rls_test.create_call('gig'),
    format($q$SELECT f.amount_settled FROM gig_financials f JOIN purchases p ON p.id = f.purchase_id
             WHERE p.description = 'Cable ties' AND f.gig_id = %s AND f.stage = 'paid' AND f.direction = 'out' AND f.category = 'Supplies'$q$, rls_test.q('gig')))::int, 30);
SELECT rls_test.expect('  ...the depreciated line is not on the gig',
  rls_test.save('a_admin', rls_test.create_call('gig'),
    format('SELECT count(*) FROM purchases WHERE description = %L AND gig_id IS NOT NULL', 'Console'))::int, 0);
SELECT rls_test.expect('Create on a gig the organization is not on: refused, nothing created',
  rls_test.save('c_admin', replace(rls_test.create_call('gig'), rls_test.u('org_a')::text, rls_test.u('org_c')::text),
    'SELECT 1')::int, -1);
SELECT rls_test.expect('Create with no gig still works',
  rls_test.save('a_admin', rls_test.create_call(NULL),
    $q$SELECT count(*) FROM purchases WHERE description = 'Gig buy' AND row_type = 'header'$q$)::int, 1);
