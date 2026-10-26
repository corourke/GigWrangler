-- #133 step 2: the writers that set tax treatment and equipment separately.
--   * create_purchase_transaction_v2 stores each line's tax_treatment, and a depreciated
--     line's unit keeps its recovery_period (v1, which also took it on the line for older
--     app builds, was dropped in 20261025000000)
--   * track_purchase_line_as_equipment(line) creates an equipment record for a line
--     without touching its tax treatment, even in a locked (filed) year
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('h25', '00000000-0000-0000-0000-00000000e001'),
  ('i25', '00000000-0000-0000-0000-00000000e002'),
  ('h26', '00000000-0000-0000-0000-00000000e003'),
  ('i26', '00000000-0000-0000-0000-00000000e004'),
  ('t26', '00000000-0000-0000-0000-00000000e005'),
  ('ast', '00000000-0000-0000-0000-00000000e006');

INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, created_by, updated_by) VALUES
  (rls_test.u('ast'), rls_test.u('org_a'), '2026-03-01', 'Audio', 'Already tracked', rls_test.u('a_admin'), rls_test.u('a_admin'));
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount, quantity, item_price, item_cost, line_cost, asset_id, description, category) VALUES
  (rls_test.u('h25'), rls_test.u('org_a'), NULL,              'header', '2025-02-14', 'Sweetwater', 314.30, NULL, NULL, NULL, NULL, NULL, 'cables', NULL),
  (rls_test.u('i25'), rls_test.u('org_a'), rls_test.u('h25'), 'item',   '2025-02-14', 'Sweetwater', NULL, 10, 29.99, 31.43, 314.30, NULL, 'XLR cable 20ft', 'Audio'),
  (rls_test.u('h26'), rls_test.u('org_a'), NULL,              'header', '2026-03-01', 'V', 400, NULL, NULL, NULL, NULL, NULL, 'inv', NULL),
  (rls_test.u('i26'), rls_test.u('org_a'), rls_test.u('h26'), 'item',   '2026-03-01', 'V', NULL, 1, 100, 100, 100, NULL, 'Stand', 'Audio'),
  (rls_test.u('t26'), rls_test.u('org_a'), rls_test.u('h26'), 'item',   '2026-03-01', 'V', NULL, 1, 300, 300, 300, rls_test.u('ast'), 'Tracked', 'Audio');
INSERT INTO tax_years (organization_id, year) VALUES (rls_test.u('org_a'), 2025);

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
-- Runs as p_user without RLS's role switch rolled back, so the effect can be inspected afterwards.
CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;

-- create_purchase_transaction_v2 keeps the treatment it is given
SELECT rls_test.as_user('a_manager');
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'vendor', 'NewCo', 'total_inv_amount', 900),
  ARRAY[
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'expense',    'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 150, 'line_cost', 150, 'description', 'expensed gear'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'depreciate', 'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 700, 'line_cost', 700, 'description', 'console'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 50, 'line_cost', 50, 'description', 'tape')],
  ARRAY[
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 0, 'acquisition_date', '2026-05-01', 'category', 'Audio', 'manufacturer_model', 'Gear', 'quantity', 1, 'item_cost', 150, 'status', 'Active', 'insurance_policy_added', false),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 1, 'recovery_period', 7, 'acquisition_date', '2026-05-01', 'category', 'Audio', 'manufacturer_model', 'Console', 'quantity', 1, 'item_cost', 700, 'status', 'Active', 'insurance_policy_added', false)]);
SELECT rls_test.expect('An equipment line saved as an expense stays an expense',
  (SELECT count(*)::int FROM purchases WHERE description = 'expensed gear' AND tax_treatment = 'expense' AND asset_id IS NOT NULL), 1);
SELECT rls_test.expect('A depreciated line''s unit keeps its recovery period',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id WHERE p.description = 'console' AND p.tax_treatment = 'depreciate' AND a.recovery_period = 7), 1);
SELECT rls_test.expect('A line saved without a treatment still gets one',
  (SELECT count(*)::int FROM purchases WHERE description = 'tape' AND tax_treatment = 'expense'), 1);

-- track_purchase_line_as_equipment
SELECT rls_test.expect('A manager can track an expensed line as equipment',
  rls_test.run('a_manager', format('SELECT public.track_purchase_line_as_equipment(%s)', rls_test.id('i26'))), 1);
SELECT rls_test.expect('Staff cannot',
  rls_test.run('a_staff', format('SELECT public.track_purchase_line_as_equipment(%s)', rls_test.id('i26'))), -1);
SELECT rls_test.expect('Another org''s admin cannot',
  rls_test.run('b_admin', format('SELECT public.track_purchase_line_as_equipment(%s)', rls_test.id('i26'))), -1);
SELECT rls_test.expect('A line already tracked is refused',
  rls_test.run('a_manager', format('SELECT public.track_purchase_line_as_equipment(%s)', rls_test.id('t26'))), -1);
SELECT rls_test.expect('A header is refused',
  rls_test.run('a_manager', format('SELECT public.track_purchase_line_as_equipment(%s)', rls_test.id('h26'))), -1);

SELECT rls_test.as_user('a_manager');
SELECT public.track_purchase_line_as_equipment(rls_test.u('i25'));
SELECT rls_test.expect('Works in a locked year, and the line stays an expense',
  (SELECT count(*)::int FROM purchases WHERE id = rls_test.u('i25') AND asset_id IS NOT NULL AND tax_treatment = 'expense' AND row_type = 'line'), 1);
SELECT rls_test.expect('The equipment record copies the line',
  (SELECT count(*)::int FROM assets a JOIN purchases p ON p.asset_id = a.id
   WHERE p.id = rls_test.u('i25') AND a.manufacturer_model = 'XLR cable 20ft' AND a.quantity = 10 AND a.item_cost = 31.43
     AND a.acquisition_date = '2025-02-14' AND a.purchase_id = rls_test.u('h25') AND a.vendor = 'Sweetwater' AND a.status = 'Active'), 1);
