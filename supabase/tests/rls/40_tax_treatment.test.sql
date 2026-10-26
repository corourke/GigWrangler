-- #133: a purchase line's tax treatment (expense / depreciate) is separate from
-- whether it is tracked as equipment, and filed tax years are locked.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('asset_a',  '00000000-0000-0000-0000-00000000c001'),
  ('asset_a2', '00000000-0000-0000-0000-00000000c002'),
  ('h25',  '00000000-0000-0000-0000-00000000d001'),
  ('i25',  '00000000-0000-0000-0000-00000000d002'),
  ('s25',  '00000000-0000-0000-0000-00000000d003'),
  ('h26',  '00000000-0000-0000-0000-00000000d004'),
  ('i26',  '00000000-0000-0000-0000-00000000d005'),
  ('s26',  '00000000-0000-0000-0000-00000000d006'),
  ('hb25', '00000000-0000-0000-0000-00000000d007'),
  ('ib25', '00000000-0000-0000-0000-00000000d008'),
  ('r26',  '00000000-0000-0000-0000-00000000d009');

INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, created_by, updated_by) VALUES
  (rls_test.u('asset_a'),  rls_test.u('org_a'), '2025-03-01', 'Audio', 'Mixer',   rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.u('asset_a2'), rls_test.u('org_a'), '2026-03-01', 'Audio', 'Speaker', rls_test.u('a_admin'), rls_test.u('a_admin'));

-- Rows written the way today's app writes them: no tax_treatment given.
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount, quantity, item_cost, line_cost, asset_id, description) VALUES
  (rls_test.u('h25'),  rls_test.u('org_a'), NULL,               'header', '2025-03-01', 'V', 300, NULL, NULL, NULL, NULL, 'inv 25'),
  (rls_test.u('i25'),  rls_test.u('org_a'), rls_test.u('h25'),  'item',   '2025-03-01', 'V', NULL, 1, 100, 100, NULL, 'cable'),
  (rls_test.u('s25'),  rls_test.u('org_a'), rls_test.u('h25'),  'asset',  '2025-03-01', 'V', NULL, 1, 200, 200, rls_test.u('asset_a'), 'mixer'),
  (rls_test.u('h26'),  rls_test.u('org_a'), NULL,               'header', '2026-03-01', 'V', 400, NULL, NULL, NULL, NULL, 'inv 26'),
  (rls_test.u('i26'),  rls_test.u('org_a'), rls_test.u('h26'),  'item',   '2026-03-01', 'V', NULL, 1, 100, 100, NULL, 'tape'),
  (rls_test.u('s26'),  rls_test.u('org_a'), rls_test.u('h26'),  'asset',  '2026-03-01', 'V', NULL, 1, 300, 300, rls_test.u('asset_a2'), 'speaker'),
  (rls_test.u('r26'),  rls_test.u('org_a'), rls_test.u('h26'),  'item',   '2026-03-01', 'V', NULL, 1, 0, 0, NULL, 'reclassified'),
  (rls_test.u('hb25'), rls_test.u('org_b'), NULL,               'header', '2025-03-01', 'V', 50, NULL, NULL, NULL, NULL, 'b inv'),
  (rls_test.u('ib25'), rls_test.u('org_b'), rls_test.u('hb25'), 'item',   '2025-03-01', 'V', NULL, 1, 50, 50, NULL, 'b cable');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
-- Runs as the test superuser, then fires the deferred (end-of-transaction)
-- checks as a commit would; always rolled back.
CREATE FUNCTION rls_test.attempt(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN SET CONSTRAINTS ALL DEFERRED; RETURN SQLERRM::int;
    WHEN OTHERS THEN SET CONSTRAINTS ALL DEFERRED; RETURN -1;
  END;
END $$;
CREATE FUNCTION rls_test.tt(p text) RETURNS text LANGUAGE sql AS
  $$ SELECT coalesce(tax_treatment, '(null)') FROM purchases WHERE id = rls_test.u(p) $$;

-- Tax treatment: filled in for today's app, never on headers
SELECT rls_test.expect('An expense line written without a treatment becomes expense', (rls_test.tt('i25') = 'expense')::int, 1);
SELECT rls_test.expect('An asset line written without a treatment becomes depreciate', (rls_test.tt('s25') = 'depreciate')::int, 1);
SELECT rls_test.expect('A header has no treatment', (rls_test.tt('h25') = '(null)')::int, 1);
SELECT rls_test.expect('A header cannot be given a treatment',
  rls_test.attempt(format('UPDATE purchases SET tax_treatment = %L WHERE id = %s', 'expense', rls_test.id('h26'))), -1);
SELECT rls_test.expect('Treatment must be expense or depreciate',
  rls_test.attempt(format('UPDATE purchases SET tax_treatment = %L WHERE id = %s', 'capitalize', rls_test.id('i26'))), -1);
SELECT rls_test.expect('A line cannot have its treatment cleared',
  rls_test.attempt(format('UPDATE purchases SET tax_treatment = NULL WHERE id = %s', rls_test.id('i26'))), -1);
-- 10-07: lines are one type ('line'); an old app's 'item' / 'asset' is stored as 'line' (test 46).
SELECT rls_test.expect('Lines written as item / asset are stored as line',
  (SELECT count(*)::int FROM purchases WHERE id IN (rls_test.u('i25'), rls_test.u('s25'), rls_test.u('r26')) AND row_type = 'line'), 3);

-- Depreciate needs an equipment record; expense doesn't care
SELECT rls_test.expect('A depreciated line must keep its equipment record',
  rls_test.attempt(format('UPDATE purchases SET asset_id = NULL WHERE id = %s', rls_test.id('s26'))), -1);
SELECT rls_test.expect('Deleting the equipment record of a depreciated line is refused',
  rls_test.attempt(format('DELETE FROM assets WHERE id = %s', rls_test.id('asset_a2'))), -1);
SELECT rls_test.expect('An expense line cannot become depreciate without equipment',
  rls_test.attempt(format('UPDATE purchases SET tax_treatment = %L WHERE id = %s', 'depreciate', rls_test.id('i26'))), -1);
SELECT rls_test.expect('An expense line can be tracked as equipment',
  rls_test.attempt(format('UPDATE purchases SET asset_id = %s WHERE id = %s', rls_test.id('asset_a2'), rls_test.id('i26'))), 1);
-- The recovery period moved to the equipment record in #125 (test 47).

-- A depreciated line is never a gig expense
SELECT rls_test.expect('A gig expense can point at an expense line',
  rls_test.attempt(format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, created_by) VALUES (%s, %s, %L, %L, 100, 100, now(), %L, %s, %s)',
    rls_test.id('gig'), rls_test.id('org_a'), 'out', 'paid', '2026-03-01', rls_test.id('i26'), rls_test.id('a_admin'))), 1);
SELECT rls_test.expect('A gig expense cannot point at a depreciated line',
  rls_test.attempt(format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, created_by) VALUES (%s, %s, %L, %L, 300, 300, now(), %L, %s, %s)',
    rls_test.id('gig'), rls_test.id('org_a'), 'out', 'paid', '2026-03-01', rls_test.id('s26'), rls_test.id('a_admin'))), -1);
INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, created_by)
  VALUES (rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 100, 100, now(), '2026-03-01', rls_test.u('i26'), rls_test.u('a_admin'));
SELECT rls_test.expect('A line that is a gig expense cannot become depreciate',
  rls_test.attempt(format('UPDATE purchases SET tax_treatment = %L, asset_id = %s WHERE id = %s', 'depreciate', rls_test.id('asset_a2'), rls_test.id('i26'))), -1);

-- tax_years: Admins and Managers of the org read it; only Admins change it
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');
SELECT rls_test.expect('A admin sees A tax years',   rls_test.visible(rls_test.u('a_admin'), 'tax_years', 'true'), 1);
SELECT rls_test.expect('A manager sees A tax years', rls_test.visible(rls_test.u('a_manager'), 'tax_years', 'true'), 1);
SELECT rls_test.expect('A staff does not',           rls_test.visible(rls_test.u('a_staff'), 'tax_years', 'true'), 0);
SELECT rls_test.expect('B admin does not',           rls_test.visible(rls_test.u('b_admin'), 'tax_years', 'true'), 0);
SELECT rls_test.expect('A admin can lock another year',
  rls_test.run('a_admin', format('INSERT INTO tax_years (organization_id, year) VALUES (%s, 2024)', rls_test.id('org_a'))), 1);
SELECT rls_test.expect('A manager cannot lock a year',
  rls_test.run('a_manager', format('INSERT INTO tax_years (organization_id, year) VALUES (%s, 2024)', rls_test.id('org_a'))), -1);
SELECT rls_test.expect('B admin cannot lock A''s year',
  rls_test.run('b_admin', format('INSERT INTO tax_years (organization_id, year) VALUES (%s, 2024)', rls_test.id('org_a'))), -1);
SELECT rls_test.expect('A manager cannot unlock',
  rls_test.run('a_manager', 'UPDATE tax_years SET locked = false'), 0);

-- Locked year: tax fields frozen, equipment and notes still editable
SELECT rls_test.expect('Locked: a line''s cost cannot change',
  rls_test.run('a_manager', format('UPDATE purchases SET line_cost = 90, item_cost = 90 WHERE id = %s', rls_test.id('i25'))), -1);
SELECT rls_test.expect('Locked: a line''s treatment cannot change',
  rls_test.run('a_manager', format('UPDATE purchases SET tax_treatment = %L, asset_id = %s WHERE id = %s', 'depreciate', rls_test.id('asset_a'), rls_test.id('i25'))), -1);
SELECT rls_test.expect('Locked: a line''s category cannot change',
  rls_test.run('a_manager', format('UPDATE purchases SET category = %L WHERE id = %s', 'Power', rls_test.id('i25'))), -1);
SELECT rls_test.expect('Locked: the invoice total cannot change',
  rls_test.run('a_manager', format('UPDATE purchases SET total_inv_amount = 1 WHERE id = %s', rls_test.id('h25'))), -1);
SELECT rls_test.expect('Locked: a line cannot move out of the year',
  rls_test.run('a_manager', format('UPDATE purchases SET purchase_date = %L WHERE id = %s', '2026-01-02', rls_test.id('i25'))), -1);
SELECT rls_test.expect('Locked: a 2026 line cannot move into it',
  rls_test.run('a_manager', format('UPDATE purchases SET purchase_date = %L WHERE id = %s', '2025-06-01', rls_test.id('i26'))), -1);
SELECT rls_test.expect('Locked: no new lines',
  rls_test.run('a_manager', format('INSERT INTO purchases (organization_id, parent_id, row_type, purchase_date, line_cost) VALUES (%s, %s, %L, %L, 5)',
    rls_test.id('org_a'), rls_test.id('h25'), 'item', '2025-03-01')), -1);
SELECT rls_test.expect('Locked: a line cannot be deleted',
  rls_test.run('a_manager', format('DELETE FROM purchases WHERE id = %s', rls_test.id('i25'))), -1);
SELECT rls_test.expect('Locked: the invoice cannot be deleted',
  rls_test.run('a_manager', format('DELETE FROM purchases WHERE id = %s', rls_test.id('h25'))), -1);
SELECT rls_test.expect('Locked: an expensed line can still be tracked as equipment',
  rls_test.run('a_manager', format('UPDATE purchases SET asset_id = %s WHERE id = %s', rls_test.id('asset_a2'), rls_test.id('i25'))), 1);
SELECT rls_test.expect('Locked: descriptions can still change',
  rls_test.run('a_manager', format('UPDATE purchases SET description = %L WHERE id = %s', 'XLR cable', rls_test.id('i25'))), 1);
SELECT rls_test.expect('Unlocked year: costs can change',
  rls_test.run('a_manager', format('UPDATE purchases SET line_cost = 90, item_cost = 90 WHERE id = %s', rls_test.id('s26'))), 1);
SELECT rls_test.expect('The lock is per organization (org B''s 2025 is open)',
  rls_test.run('b_admin', format('UPDATE purchases SET line_cost = 40, item_cost = 40 WHERE id = %s', rls_test.id('ib25'))), 1);
UPDATE tax_years SET locked = false WHERE organization_id = rls_test.u('org_a') AND year = 2025;
SELECT rls_test.expect('Once unlocked, the year can change again',
  rls_test.run('a_manager', format('UPDATE purchases SET line_cost = 90, item_cost = 90 WHERE id = %s', rls_test.id('i25'))), 1);

-- Saving keeps working: create_purchase_transaction_v2 inserts a tracked line before
-- linking its unit; the equipment check waits for the end of the transaction.
CREATE FUNCTION rls_test.attempt_as(p_user text, p_sql text) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
  RETURN rls_test.attempt(p_sql);
END $$;
SELECT rls_test.expect('Saving a purchase with a tracked line still works',
  rls_test.attempt_as('a_manager', format($q$SELECT public.create_purchase_transaction_v2(
    jsonb_build_object('organization_id', %1$s, 'purchase_date', '2026-04-01', 'vendor', 'V', 'total_inv_amount', 120),
    ARRAY[jsonb_build_object('organization_id', %1$s, 'purchase_date', '2026-04-01', 'quantity', 1, 'item_cost', 100, 'line_cost', 100, 'description', 'amp'),
          jsonb_build_object('organization_id', %1$s, 'purchase_date', '2026-04-01', 'quantity', 1, 'item_cost', 20,  'line_cost', 20,  'description', 'cable')],
    ARRAY[jsonb_build_object('organization_id', %1$s, 'line_index', 0, 'acquisition_date', '2026-04-01', 'category', 'Audio', 'manufacturer_model', 'Amp', 'quantity', 1, 'item_cost', 100, 'status', 'Active', 'insurance_policy_added', false)])$q$,
    rls_test.id('org_a'))), 1);
