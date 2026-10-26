-- Equipment details from the purchase screen (10-06): new equipment keeps its Type and
-- can go into the org's kits; sub-category is gone from equipment and purchases.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;

-- Purchases save through create_purchase_transaction_v2 (#183); v1, which could also put the new
-- equipment into kits, was dropped in 20261025000000. A kit line is now its own write.
SELECT rls_test.as_user('a_manager');
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-02', 'vendor', 'V', 'total_inv_amount', 100),
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'expense', 'purchase_date', '2026-05-02',
                           'quantity', 4, 'item_cost', 25, 'line_cost', 100, 'description', 'Kept cable')],
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 0, 'acquisition_date', '2026-05-02', 'category', 'Audio',
                           'type', 'Cable, XLR', 'manufacturer_model', 'Kept cable', 'quantity', 4, 'item_cost', 25, 'status', 'Active',
                           'insurance_policy_added', false)]);
SELECT rls_test.expect('The new equipment keeps its Type',
  (SELECT count(*)::int FROM assets WHERE manufacturer_model = 'Kept cable' AND type = 'Cable, XLR'), 1);

-- The new equipment goes into the org's own kit, not another org's.
CREATE FUNCTION rls_test.into_kit(p_kit text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u('a_manager'), format(
    'INSERT INTO kit_components (kit_id, asset_id, quantity) SELECT %L, id, 4 FROM assets WHERE manufacturer_model = %L',
    rls_test.u(p_kit), 'Kept cable'))
$$;
SELECT rls_test.expect('Another org''s kit is refused', rls_test.into_kit('kit_b'), -1);
SELECT rls_test.expect('The org''s own kit takes it, all 4 of them', rls_test.into_kit('kit_a'), 1);

SELECT rls_test.expect('Equipment has no sub-category column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'sub_category'), 0);
SELECT rls_test.expect('Purchases have no sub-category column',
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchases' AND column_name = 'sub_category'), 0);
SELECT rls_test.expect('The old one-way reclassify function is gone',
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'reclassify_expense_as_asset'), 0);
