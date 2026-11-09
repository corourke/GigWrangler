-- The import screen's writes, as each role of the organization. Admin and Manager may import;
-- Staff and Viewer are refused by the database whatever the screen shows.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.gig_call() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($q$SELECT create_gig_complex(jsonb_build_object('title','Imported gig','start','2026-05-01T18:00:00Z','end','2026-05-01T22:00:00Z','primary_organization_id',%L),
       jsonb_build_array(jsonb_build_object('organization_id',%L,'role','Production')), '[]'::jsonb)$q$,
    rls_test.u('org_a'), rls_test.u('org_a'))
$$;

CREATE FUNCTION rls_test.purchase_call() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($f$SELECT public.create_purchase_transaction_v3(%L::jsonb, ARRAY[%L::jsonb], ARRAY[]::jsonb[], NULL, ARRAY[]::jsonb[])$f$,
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'vendor', 'Imported', 'total_inv_amount', 30, 'description', 'Imported purchase'),
    jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-05-01', 'quantity', 1, 'item_cost', 30, 'line_cost', 30, 'description', 'Cable ties', 'tax_treatment', 'expense'))
$$;

CREATE FUNCTION rls_test.kit_call() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format($q$INSERT INTO kits (organization_id, name, category, created_by, updated_by) VALUES (%L, 'Imported kit', 'Imported', auth.uid(), auth.uid())$q$, rls_test.u('org_a'))
$$;

SELECT rls_test.expect('import gig: ' || r, rls_test.try(rls_test.u('a_' || r), rls_test.gig_call()), CASE WHEN r IN ('admin','manager') THEN 1 ELSE -1 END)
FROM unnest(ARRAY['admin','manager','staff','viewer']) r;

SELECT rls_test.expect('import purchase: ' || r, rls_test.try(rls_test.u('a_' || r), rls_test.purchase_call()), CASE WHEN r IN ('admin','manager') THEN 1 ELSE -1 END)
FROM unnest(ARRAY['admin','manager','staff','viewer']) r;

SELECT rls_test.expect('import kit: ' || r, rls_test.try(rls_test.u('a_' || r), rls_test.kit_call()), CASE WHEN r IN ('admin','manager') THEN 1 ELSE -1 END)
FROM unnest(ARRAY['admin','manager','staff','viewer']) r;
