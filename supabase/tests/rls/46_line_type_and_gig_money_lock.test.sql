-- #133 leftovers (10-07): purchase lines are one type, `line` (tax treatment and
-- "tracked as equipment" are separate settings), and filed tax years also lock
-- gig money that is tax data: income, and expenses not linked to a purchase line.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('lh26', '00000000-0000-0000-0000-00000000e001'),
  ('lh25', '00000000-0000-0000-0000-00000000e002'),
  ('ll25', '00000000-0000-0000-0000-00000000e003'),
  ('gin25', '00000000-0000-0000-0000-00000000e101'),
  ('gout25', '00000000-0000-0000-0000-00000000e102'),
  ('glink25', '00000000-0000-0000-0000-00000000e103'),
  ('gout26', '00000000-0000-0000-0000-00000000e104');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;
-- Runs as the test superuser (no RLS), always rolled back: rows affected, or -1 if refused.
CREATE FUNCTION rls_test.su(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM::int;
    WHEN OTHERS THEN RETURN -1;
  END;
END $$;

-- 1. One line type ---------------------------------------------------------------
SELECT rls_test.expect('Line type is header or line',
  (SELECT count(*)::int FROM pg_constraint WHERE conname = 'purchases_row_type_check'
     AND pg_get_constraintdef(oid) LIKE '%line%' AND pg_get_constraintdef(oid) NOT LIKE '%asset%'), 1);

INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount)
  VALUES (rls_test.u('lh26'), rls_test.u('org_a'), NULL, 'header', '2026-04-01', 'V', 30);
INSERT INTO purchases (organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment)
  VALUES (rls_test.u('org_a'), rls_test.u('lh26'), 'line', '2026-04-01', 1, 10, 10, 'new line', 'expense');
SELECT rls_test.expect('A line is written as row_type line',
  (SELECT count(*)::int FROM purchases WHERE description = 'new line' AND row_type = 'line'), 1);

-- An app still on the old build writes item / asset: stored as line, treatment from the old type.
INSERT INTO purchases (organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description)
  VALUES (rls_test.u('org_a'), rls_test.u('lh26'), 'item', '2026-04-01', 1, 10, 10, 'old item');
SELECT rls_test.expect('An old-style item line is stored as an expense line',
  (SELECT count(*)::int FROM purchases WHERE description = 'old item' AND row_type = 'line' AND tax_treatment = 'expense'), 1);

SELECT rls_test.as_user('a_manager');
-- create_purchase_transaction_v2: a line's units make it tracked (v1's old-style asset lines
-- went with v1 in 20261025000000).
SELECT public.create_purchase_transaction_v2(
  jsonb_build_object('organization_id', rls_test.u('org_a'), 'purchase_date', '2026-04-02', 'vendor', 'V', 'total_inv_amount', 120),
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'depreciate', 'purchase_date', '2026-04-02',
                           'quantity', 1, 'item_cost', 100, 'line_cost', 100, 'description', 'tracked amp'),
        jsonb_build_object('organization_id', rls_test.u('org_a'), 'tax_treatment', 'expense', 'purchase_date', '2026-04-02',
                           'quantity', 1, 'item_cost', 20, 'line_cost', 20, 'description', 'plain tape')],
  ARRAY[jsonb_build_object('organization_id', rls_test.u('org_a'), 'line_index', 0, 'acquisition_date', '2026-04-02', 'category', 'Audio',
                           'manufacturer_model', 'Amp', 'quantity', 1, 'item_cost', 100, 'status', 'Active', 'insurance_policy_added', false)]);
SELECT rls_test.expect('The purchase RPC writes every line as row_type line',
  (SELECT count(*)::int FROM purchases WHERE description IN ('tracked amp', 'plain tape') AND row_type = 'line'), 2);
SELECT rls_test.expect('A line with a unit gets its equipment record',
  (SELECT count(*)::int FROM purchases p JOIN assets a ON a.id = p.asset_id WHERE p.description = 'tracked amp' AND a.manufacturer_model = 'Amp'), 1);
SELECT rls_test.expect('A line without units gets none',
  (SELECT count(*)::int FROM purchases WHERE description = 'plain tape' AND asset_id IS NULL), 1);

-- 2. Filed years lock gig money that is tax data -----------------------------------
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount)
  VALUES (rls_test.u('lh25'), rls_test.u('org_a'), NULL, 'header', '2025-05-01', 'V', 40);
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment)
  VALUES (rls_test.u('ll25'), rls_test.u('org_a'), rls_test.u('lh25'), 'line', '2025-05-01', 1, 40, 40, 'gaff tape', 'expense');
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, description, created_by) VALUES
  (rls_test.u('gin25'),   rls_test.u('gig'), rls_test.u('org_a'), 'in',  'paid', 1000, 1000, '2025-05-02', '2025-05-02', NULL,              'show fee',  rls_test.u('a_admin')),
  (rls_test.u('gout25'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 50,   50,   '2025-05-02', '2025-05-02', NULL,              'parking',   rls_test.u('a_admin')),
  (rls_test.u('glink25'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 40,   40,   '2025-05-02', '2025-05-02', rls_test.u('ll25'), 'gaff tape', rls_test.u('a_admin')),
  (rls_test.u('gout26'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 60,   60,   '2026-05-02', '2026-05-02', NULL,              'parking',   rls_test.u('a_admin'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

SELECT rls_test.expect('Locked: gig income amount cannot change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 900, amount_settled = 900 WHERE id = %s', rls_test.id('gin25'))), -1);
SELECT rls_test.expect('Locked: a gig expense amount cannot change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 45 WHERE id = %s', rls_test.id('gout25'))), -1);
SELECT rls_test.expect('Locked: a gig expense cannot move out of the year',
  rls_test.run('a_admin', format('UPDATE gig_financials SET date = %L WHERE id = %s', '2026-01-05', rls_test.id('gout25'))), -1);
SELECT rls_test.expect('Locked: a 2026 gig expense cannot move into it',
  rls_test.run('a_admin', format('UPDATE gig_financials SET date = %L WHERE id = %s', '2025-12-30', rls_test.id('gout26'))), -1);
SELECT rls_test.expect('Locked: gig income status cannot change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET stage = %L WHERE id = %s', 'invoiced', rls_test.id('gin25'))), -1);
SELECT rls_test.expect('Locked: no new gig income',
  rls_test.run('a_admin', format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, date, created_by) VALUES (%s, %s, %L, %L, 10, %L, %s)',
    rls_test.id('gig'), rls_test.id('org_a'), 'in', 'invoiced', '2025-07-01', rls_test.id('a_admin'))), -1);
SELECT rls_test.expect('Locked: a gig expense cannot be deleted',
  rls_test.run('a_admin', format('DELETE FROM gig_financials WHERE id = %s', rls_test.id('gout25'))), -1);
SELECT rls_test.expect('Locked: notes and descriptions can still change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET notes = %L, description = %L WHERE id = %s', 'receipt in folder', 'parking, garage', rls_test.id('gout25'))), 1);
SELECT rls_test.expect('Locked: a gig expense linked to a purchase line stays editable (the line is the tax record)',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 38 WHERE id = %s', rls_test.id('glink25'))), 1);
SELECT rls_test.expect('Locked: unlinking it from the purchase line is refused (it would become tax data)',
  rls_test.run('a_admin', format('UPDATE gig_financials SET purchase_id = NULL WHERE id = %s', rls_test.id('glink25'))), -1);
SELECT rls_test.expect('Unlocked year: gig expenses can change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 65 WHERE id = %s', rls_test.id('gout26'))), 1);
SELECT rls_test.expect('The lock is per organization (org B''s 2025 is open)',
  rls_test.su(format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, date, created_by) VALUES (%s, %s, %L, %L, 10, %L, %s)',
    rls_test.id('gig'), rls_test.id('org_b'), 'in', 'invoiced', '2025-07-01', rls_test.id('b_admin'))), 1);
UPDATE tax_years SET locked = false WHERE organization_id = rls_test.u('org_a') AND year = 2025;
SELECT rls_test.expect('Once unlocked, gig money in the year can change again',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 900, amount_settled = 900 WHERE id = %s', rls_test.id('gin25'))), 1);
