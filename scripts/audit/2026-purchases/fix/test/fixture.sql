-- Fixture for the #135 fix scripts: every case each step must change, and near misses it must
-- not. Loaded after supabase/tests/rls/_harness.sql and _fixture.sql (orgs A and B, their users)
-- into a throwaway database in one committed transaction, so apply.sql runs its own as on prod.
-- Every depreciated line has its equipment record, as the app requires.
CREATE FUNCTION rls_test.k(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('fix:' || p)::uuid $$;

SELECT set_config('request.jwt.claim.sub', rls_test.u('a_admin')::text, false), public.ensure_org_categories(rls_test.u('org_a'));
SELECT set_config('request.jwt.claim.sub', rls_test.u('b_admin')::text, false), public.ensure_org_categories(rls_test.u('org_b'));
SELECT set_config('request.jwt.claim.sub', '', false);

-- Invoices. Totals of F1, FB and F0 are set to their lines below; F2, F3, F4 are a few cents under.
INSERT INTO purchases (id, organization_id, row_type, purchase_date, vendor, total_inv_amount) VALUES
  (rls_test.k('F0'), rls_test.u('org_a'), 'header', '2025-12-20', 'Old Co', 0),
  (rls_test.k('F1'), rls_test.u('org_a'), 'header', '2026-02-01', 'Shop', 0),
  (rls_test.k('F2'), rls_test.u('org_a'), 'header', '2026-05-12', 'Resale Co', 0),
  (rls_test.k('F3'), rls_test.u('org_a'), 'header', '2026-08-14', 'Music Co', 0),
  (rls_test.k('F4'), rls_test.u('org_a'), 'header', '2026-08-20', 'Tie Co', 0),
  (rls_test.k('F5'), rls_test.u('org_a'), 'header', '2026-09-01', 'Even Co', 0),
  (rls_test.k('FB'), rls_test.u('org_b'), 'header', '2026-04-01', 'B Shop', 0);

INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, tax_treatment, category, gig_id, description) VALUES
  -- step 1: under $200 per item, depreciated
  (rls_test.k('D1'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 199.99, 199.99, 'depreciate', 'Expendables and supplies', NULL, '199.99 depreciated'),
  (rls_test.k('D7'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 4, NULL, 600, 'depreciate', 'Expendables and supplies', NULL, 'no item cost, 4 at 150'),
  (rls_test.k('D13'), rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, -50, -50, 'depreciate', 'Expendables and supplies', NULL, 'return, depreciated'),
  (rls_test.k('D14'), rls_test.u('org_a'), rls_test.k('F0'), 'line', '2026-01-05', 1, 120, 120, 'depreciate', 'Expendables and supplies', NULL, '2026 line on a 2025 invoice'),
  (rls_test.k('DB'),  rls_test.u('org_b'), rls_test.k('FB'), 'line', NULL, 1, 150, 150, 'depreciate', 'Expendables and supplies', NULL, 'org B, 150'),
  -- step 2: $200 to $2,500 per item, depreciated
  (rls_test.k('D2'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 200.00, 200.00, 'depreciate', 'Expendables and supplies', NULL, '200.00 depreciated'),
  (rls_test.k('D3'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 2500.00, 2500.00, 'depreciate', 'Expendables and supplies', NULL, '2500.00 depreciated'),
  (rls_test.k('D8'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 800, 800, 'depreciate', 'Expendables and supplies', NULL, 'grey, equipment also on D9'),
  -- near misses: not changed
  (rls_test.k('D4'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 2500.01, 2500.01, 'depreciate', 'Expendables and supplies', NULL, '2500.01 depreciated'),
  (rls_test.k('D9'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 3000, 3000, 'depreciate', 'Expendables and supplies', NULL, 'upgrade on D8''s equipment'),
  (rls_test.k('D5'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 199.99, 199.99, 'expense', 'Expendables and supplies', NULL, '199.99 expensed, tracked'),
  (rls_test.k('D6'),  rls_test.u('org_a'), rls_test.k('F1'), 'line', NULL, 1, 1000, 1000, 'expense', 'Expendables and supplies', rls_test.u('gig'), 'grey, expensed, on a gig'),
  (rls_test.k('D10'), rls_test.u('org_a'), rls_test.k('F0'), 'line', NULL, 1, 150, 150, 'depreciate', 'Expendables and supplies', NULL, '2025, 150'),
  (rls_test.k('D15'), rls_test.u('org_a'), rls_test.k('F1'), 'line', '2025-12-30', 1, 150, 150, 'depreciate', 'Expendables and supplies', NULL, '2025 line on a 2026 invoice'),
  -- step 3: the resale invoice
  (rls_test.k('R1'),  rls_test.u('org_a'), rls_test.k('F2'), 'line', NULL, 2, 3000, 6000, 'depreciate', 'Expendables and supplies', NULL, '2 heads, tracked'),
  (rls_test.k('R2'),  rls_test.u('org_a'), rls_test.k('F2'), 'line', NULL, 10, 250.00, 2500.00, 'expense', 'Expendables and supplies', NULL, '10 heads, resale stock'),
  (rls_test.k('R3'),  rls_test.u('org_a'), rls_test.k('F2'), 'line', NULL, 1, 500, 500, 'depreciate', 'Expendables and supplies', NULL, 'grey, so step 2'),
  -- step 4: the largest line has no line_cost (2 × 1500) and is also expensed by step 2
  (rls_test.k('S1'),  rls_test.u('org_a'), rls_test.k('F3'), 'line', NULL, 2, 1500, NULL, 'depreciate', 'Expendables and supplies', NULL, '2 at 1500'),
  (rls_test.k('S2'),  rls_test.u('org_a'), rls_test.k('F3'), 'line', NULL, 1, 100, 100, 'expense', 'Expendables and supplies', NULL, 'small'),
  -- step 4: a tie for the largest line (the lower id changes)
  (rls_test.k('T1'),  rls_test.u('org_a'), rls_test.k('F4'), 'line', NULL, 1, 50, 50, 'expense', 'Expendables and supplies', NULL, 'tie'),
  (rls_test.k('T2'),  rls_test.u('org_a'), rls_test.k('F4'), 'line', NULL, 1, 50, 50, 'expense', 'Expendables and supplies', NULL, 'tie'),
  -- an invoice that already adds up
  (rls_test.k('E1'),  rls_test.u('org_a'), rls_test.k('F5'), 'line', NULL, 1, 75, 75, 'expense', 'Expendables and supplies', NULL, 'even');

UPDATE purchases h SET total_inv_amount = (SELECT sum(COALESCE(l.line_cost, l.item_cost * l.quantity)) FROM purchases l WHERE l.parent_id = h.id)
                                         - CASE h.id WHEN rls_test.k('F2') THEN 0.07 WHEN rls_test.k('F3') THEN 0.03 WHEN rls_test.k('F4') THEN 0.01 ELSE 0 END
 WHERE h.row_type = 'header' AND h.id IN (SELECT rls_test.k(x) FROM unnest(ARRAY['F0','F1','F2','F3','F4','F5','FB']) x);

-- Equipment, one record per depreciated line except D9 (it names D8's), plus D5's (tracked,
-- expensed). The triggers fill each recovery period from its category (Audio: 7).
INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, quantity, item_cost, status, purchase_line_id, created_by, updated_by)
SELECT rls_test.k('A' || x), CASE x WHEN 'DB' THEN rls_test.u('org_b') ELSE rls_test.u('org_a') END,
       '2026-02-01', 'Audio', 'Gear ' || x, CASE x WHEN 'D7' THEN 4 ELSE 1 END, 100, 'Active', rls_test.k(x),
       rls_test.u('a_admin'), rls_test.u('a_admin')
  FROM unnest(ARRAY['D1','D7','D13','D14','DB','D2','D3','D8','D4','D5','D10','D15','R1','R3','S1']) x;
UPDATE purchases SET asset_id = rls_test.k('A' || x)
  FROM unnest(ARRAY['D1','D7','D13','D14','DB','D2','D3','D8','D4','D5','D10','D15','R1','R3','S1']) x
 WHERE id = rls_test.k(x);
-- D9 is an upgrade line on D8's equipment: its asset_id names AD8, which stays on D8.
UPDATE purchases SET asset_id = rls_test.k('AD8') WHERE id = rls_test.k('D9');
UPDATE assets SET purchase_line_id = rls_test.k('D8') WHERE id = rls_test.k('AD8');
