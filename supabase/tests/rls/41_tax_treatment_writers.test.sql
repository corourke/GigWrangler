-- #133 step 2: create_purchase_transaction_v2 stores each line's tax_treatment, and a
-- depreciated line's unit keeps its recovery_period (v1, which also took it on the line for
-- older app builds, was dropped in 20261025000000). track_purchase_line_as_equipment, which
-- tracked a saved line, was dropped in 20261029000000 (#325); add_purchase_line_units does
-- that now and is tested in 51.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

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

