-- #337 PR 1: a year's depreciation figures from Form 4562 (filed years) or planned amounts (the
-- open year), and its line 19 rows. Admins and Managers of the org read them; only Admins write,
-- through save_tax_year_depreciation, which replaces the year's rows in one go. Admins can still
-- change a locked year's figures (Cameron, Q1): they're a transcription of the filed return.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.as_user(p_user text) RETURNS void LANGUAGE sql AS
  $$ SELECT set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true) $$;
-- The save call as SQL text for a user to run: org, year, figures, rows. rls_test.run rolls back what it
-- ran (it only reports whether it was allowed), so a save meant to stay is run again as that user with
-- rls_test.keep, which leaves it in place for the checks after it.
CREATE FUNCTION rls_test.save(p_org text, p_year int, p_figures jsonb, p_rows jsonb DEFAULT '[]') RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_tax_year_depreciation(%L, %s::smallint, %L::jsonb, %L::jsonb)', rls_test.u(p_org), p_year, p_figures, p_rows) $$;

-- Year 1 (invented): Section 179 $4,000, and 7-year mid-quarter equipment of $6,000 → $214; line 22 $4,214.
CREATE FUNCTION rls_test.keep(p_user text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql;
  RESET ROLE;
END $$;

INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2024, '2025-04-08');
SELECT rls_test.expect('An Admin saves a filed year''s figures and its line 19 rows',
  rls_test.run('a_admin', rls_test.save('org_a', 2024, '{"line_12": 4000, "line_22": 4214}',
    '[{"recovery_years": 7, "basis": 6000, "convention": "MQ", "method": "200DB", "deduction": 214}]')), 1);
SELECT rls_test.keep('a_admin', rls_test.save('org_a', 2024, '{"line_12": 4000, "line_22": 4214}',
  '[{"recovery_years": 7, "basis": 6000, "convention": "MQ", "method": "200DB", "deduction": 214}]'));
SELECT rls_test.expect('The figures are stored',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2024
     AND line_12 = 4000 AND line_22 = 4214 AND line_14 IS NULL AND line_17 IS NULL AND estimate_convention = 'HY'), 1);
SELECT rls_test.expect('The row is stored',
  (SELECT count(*)::int FROM tax_year_depreciation_rows WHERE organization_id = rls_test.u('org_a') AND year = 2024
     AND recovery_years = 7 AND basis = 6000 AND convention = 'MQ' AND method = '200DB' AND deduction = 214), 1);
SELECT rls_test.expect('Who saved it is recorded',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2024
     AND updated_by = rls_test.u('a_admin')), 1);

SELECT rls_test.expect('A locked year''s figures can still be changed by an Admin (Q1)',
  rls_test.run('a_admin', rls_test.save('org_a', 2024, '{"line_12": 4000, "line_22": 4215}',
    '[{"recovery_years": 7, "basis": 6000, "convention": "MQ", "method": "200DB", "deduction": 215}]')), 1);
SELECT rls_test.keep('a_admin', rls_test.save('org_a', 2024, '{"line_12": 4000, "line_22": 4215}',
  '[{"recovery_years": 7, "basis": 6000, "convention": "MQ", "method": "200DB", "deduction": 215}]'));
SELECT rls_test.expect('Saving again replaces the rows, not adds to them',
  (SELECT count(*)::int FROM tax_year_depreciation_rows WHERE organization_id = rls_test.u('org_a') AND year = 2024), 1);
SELECT rls_test.expect('and the figures',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2024 AND line_22 = 4215), 1);

-- The open year: planned amounts, no tax_years row needed (it would show as a year to lock).
SELECT rls_test.expect('An Admin saves the open year''s planned amounts without a tax year',
  rls_test.run('a_admin', rls_test.save('org_a', 2026,
    '{"planned_179": 1000, "planned_bonus": 0, "other_expected": 250, "estimate_convention": "MQ"}')), 1);
SELECT rls_test.keep('a_admin', rls_test.save('org_a', 2026,
  '{"planned_179": 1000, "planned_bonus": 0, "other_expected": 250, "estimate_convention": "MQ"}'));
SELECT rls_test.expect('Saving the open year adds no tax year',
  (SELECT count(*)::int FROM tax_years WHERE organization_id = rls_test.u('org_a') AND year = 2026), 0);
SELECT rls_test.expect('The open year''s amounts and convention are stored',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2026
     AND planned_179 = 1000 AND other_expected = 250 AND estimate_convention = 'MQ'), 1);

-- Who can write.
SELECT rls_test.expect('A Manager can''t save',  rls_test.run('a_manager', rls_test.save('org_a', 2025, '{"line_22": 1}')), -1);
SELECT rls_test.expect('Staff can''t save',      rls_test.run('a_staff', rls_test.save('org_a', 2025, '{"line_22": 1}')), -1);
SELECT rls_test.expect('A Viewer can''t save',   rls_test.run('a_viewer', rls_test.save('org_a', 2025, '{"line_22": 1}')), -1);
SELECT rls_test.expect('Another org''s Admin can''t save here', rls_test.run('b_admin', rls_test.save('org_a', 2025, '{"line_22": 1}')), -1);
SELECT rls_test.expect('Nor write the tables directly',
  rls_test.run('b_admin', format('INSERT INTO tax_year_depreciation (organization_id, year, line_22) VALUES (%L, 2023, 1)', rls_test.u('org_a'))), -1);
SELECT rls_test.expect('A Manager can''t change a row directly',
  rls_test.run('a_manager', format('UPDATE tax_year_depreciation_rows SET basis = 1 WHERE organization_id = %L', rls_test.u('org_a'))), 0);
SELECT rls_test.expect('A Manager can''t delete the figures',
  rls_test.run('a_manager', format('DELETE FROM tax_year_depreciation WHERE organization_id = %L', rls_test.u('org_a'))), 0);

-- Who can read.
SELECT rls_test.expect('An Admin sees the figures',   rls_test.visible(rls_test.u('a_admin'), 'tax_year_depreciation', 'true'), 2);
SELECT rls_test.expect('A Manager sees the figures',  rls_test.visible(rls_test.u('a_manager'), 'tax_year_depreciation', 'true'), 2);
SELECT rls_test.expect('and the rows',                rls_test.visible(rls_test.u('a_manager'), 'tax_year_depreciation_rows', 'true'), 1);
SELECT rls_test.expect('Staff see none',              rls_test.visible(rls_test.u('a_staff'), 'tax_year_depreciation', 'true'), 0);
SELECT rls_test.expect('nor the rows',                rls_test.visible(rls_test.u('a_staff'), 'tax_year_depreciation_rows', 'true'), 0);
SELECT rls_test.expect('A Viewer sees none',          rls_test.visible(rls_test.u('a_viewer'), 'tax_year_depreciation', 'true'), 0);
SELECT rls_test.expect('Another org''s Admin sees none', rls_test.visible(rls_test.u('b_admin'), 'tax_year_depreciation', 'true'), 0);
SELECT rls_test.expect('nor its rows',                rls_test.visible(rls_test.u('b_admin'), 'tax_year_depreciation_rows', 'true'), 0);

-- The values each column allows.
SELECT rls_test.expect('A recovery period not on the form is refused',
  rls_test.run('a_admin', rls_test.save('org_a', 2025, '{}', '[{"recovery_years": 6, "basis": 1, "convention": "HY", "method": "200DB"}]')), -1);
SELECT rls_test.expect('An unknown convention is refused',
  rls_test.run('a_admin', rls_test.save('org_a', 2025, '{}', '[{"recovery_years": 7, "basis": 1, "convention": "MM", "method": "200DB"}]')), -1);
SELECT rls_test.expect('An unknown method is refused',
  rls_test.run('a_admin', rls_test.save('org_a', 2025, '{}', '[{"recovery_years": 7, "basis": 1, "convention": "HY", "method": "175DB"}]')), -1);
SELECT rls_test.expect('A negative amount is refused',
  rls_test.run('a_admin', rls_test.save('org_a', 2025, '{"line_12": -5}')), -1);
SELECT rls_test.expect('A row needs a basis',
  rls_test.run('a_admin', rls_test.save('org_a', 2025, '{}', '[{"recovery_years": 7, "convention": "HY", "method": "200DB"}]')), -1);
SELECT rls_test.expect('A refused save changes nothing (the 2025 figures were never written)',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2025), 0);

-- A filed year with figures can't be deleted out from under them; the organization still can be.
SELECT rls_test.expect('A tax year with figures isn''t removed with them',
  rls_test.run('a_admin', format('DELETE FROM tax_years WHERE organization_id = %L AND year = 2024', rls_test.u('org_a'))), 1);
SELECT rls_test.expect('the figures stay',
  (SELECT count(*)::int FROM tax_year_depreciation WHERE organization_id = rls_test.u('org_a') AND year = 2024), 1);
