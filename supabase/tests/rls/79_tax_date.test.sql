-- B1/B24/B17: a payment date is a calendar day. gig_financials.tax_date is the paid
-- day (paid_at's UTC date), or the row's date when it isn't paid. The reports and the
-- filed-year lock both go by it.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

-- The viewer's zone must not matter (the reports used to read paid_at in it).
SET TimeZone = 'America/Los_Angeles';

INSERT INTO rls_test.ids VALUES
  ('t_jan2',   '00000000-0000-0000-0000-00000000f101'),
  ('t_dec31',  '00000000-0000-0000-0000-00000000f102'),
  ('t_unpaid', '00000000-0000-0000-0000-00000000f103'),
  ('t_open',   '00000000-0000-0000-0000-00000000f104');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
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
CREATE FUNCTION rls_test.tax_date(p text) RETURNS date LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  EXECUTE 'SELECT tax_date FROM public.gig_financials WHERE id = $1' INTO d USING rls_test.u(p);
  RETURN d;
EXCEPTION WHEN undefined_column THEN RETURN NULL;
END $$;

-- Paid days typed in the app arrive as YYYY-MM-DD and are stored as midnight UTC.
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, description, created_by) VALUES
  (rls_test.u('t_jan2'),   rls_test.u('gig'), rls_test.u('org_a'), 'in',  'paid',     500, 500,  '2026-01-02T00:00:00+00:00', '2025-12-30', 'balance', rls_test.u('a_admin')),
  (rls_test.u('t_dec31'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid',     80,  80,   '2025-12-31T00:00:00+00:00', '2026-01-03', 'parking', rls_test.u('a_admin')),
  (rls_test.u('t_unpaid'), rls_test.u('gig'), rls_test.u('org_a'), 'in',  'invoiced', 300, NULL, NULL,                        '2025-07-01', 'deposit', rls_test.u('a_admin')),
  (rls_test.u('t_open'),   rls_test.u('gig'), rls_test.u('org_a'), 'in',  'invoiced', 200, NULL, NULL,                        '2026-02-01', 'balance', rls_test.u('a_admin'));

-- 1. The tax date ------------------------------------------------------------------
SELECT rls_test.expect('Paid on Jan 2 (midnight UTC): the tax date is Jan 2 in any zone',
  (SELECT count(*)::int WHERE rls_test.tax_date('t_jan2') = '2026-01-02'), 1);
SELECT rls_test.expect('Paid on Dec 31: the tax date is Dec 31, not the row''s Jan 3 date',
  (SELECT count(*)::int WHERE rls_test.tax_date('t_dec31') = '2025-12-31'), 1);
SELECT rls_test.expect('Not paid: the tax date is the row''s date',
  (SELECT count(*)::int WHERE rls_test.tax_date('t_unpaid') = '2025-07-01'), 1);
SELECT rls_test.expect('The tax date cannot be written',
  rls_test.su(format('UPDATE gig_financials SET tax_date = %L WHERE id = %s', '2024-01-01', rls_test.id('t_open'))), -1);

-- 2. The lock goes by it -------------------------------------------------------------
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

SELECT rls_test.expect('2025 filed: income for a Dec 30 gig paid Jan 2 is 2026 money, and can change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 450, amount_settled = 450 WHERE id = %s', rls_test.id('t_jan2'))), 1);
SELECT rls_test.expect('2025 filed: an expense paid Dec 31 is 2025 money, and cannot change',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 70, amount_settled = 70 WHERE id = %s', rls_test.id('t_dec31'))), -1);
SELECT rls_test.expect('2025 filed: an unpaid row dated in 2025 stays locked by its date',
  rls_test.run('a_admin', format('UPDATE gig_financials SET amount = 250 WHERE id = %s', rls_test.id('t_unpaid'))), -1);
SELECT rls_test.expect('2025 filed: a 2026 row cannot be marked paid on a 2025 day',
  rls_test.run('a_admin', format('UPDATE gig_financials SET stage = %L, amount_settled = 200, paid_at = %L WHERE id = %s', 'paid', '2025-12-20', rls_test.id('t_open'))), -1);
SELECT rls_test.expect('2025 filed: it can be marked paid on a 2026 day',
  rls_test.run('a_admin', format('UPDATE gig_financials SET stage = %L, amount_settled = 200, paid_at = %L WHERE id = %s', 'paid', '2026-02-03', rls_test.id('t_open'))), 1);
SELECT rls_test.expect('2025 filed: 2026 money cannot move its paid day into 2025',
  rls_test.run('a_admin', format('UPDATE gig_financials SET paid_at = %L WHERE id = %s', '2025-12-31', rls_test.id('t_jan2'))), -1);
SELECT rls_test.expect('2025 filed: no new money paid on a 2025 day, whatever the row''s date',
  rls_test.run('a_admin', format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, created_by) VALUES (%s, %s, %L, %L, 10, 10, %L, %L, %s)',
    rls_test.id('gig'), rls_test.id('org_a'), 'in', 'paid', '2025-12-31', '2026-01-05', rls_test.id('a_admin'))), -1);
SELECT rls_test.expect('2025 filed: new money paid on a 2026 day for a 2025 gig date is fine',
  rls_test.run('a_admin', format('INSERT INTO gig_financials (gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, created_by) VALUES (%s, %s, %L, %L, 10, 10, %L, %L, %s)',
    rls_test.id('gig'), rls_test.id('org_a'), 'in', 'paid', '2026-01-04', '2025-12-29', rls_test.id('a_admin'))), 1);
