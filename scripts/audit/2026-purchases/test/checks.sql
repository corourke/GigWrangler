-- Checks for the #135 worksheet queries against fixture.sql. run.sh defines q01..q09 as views
-- over the query files first. rls_test.expect(label, actual, expected).
CREATE FUNCTION rls_test.has(p_view text, p_col text, p_key text, p_where text DEFAULT 'true') RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM %I WHERE %I = %L AND %s', p_view, p_col, rls_test.k(p_key), p_where) INTO n;
  RETURN n;
END $$;

-- 01 tax treatment
SELECT rls_test.expect('01 $199.99 depreciated → set expense', rls_test.has('q01', 'line_id', 'L1', $$suggested_action = 'set tax_treatment = expense'$$), 1);
SELECT rls_test.expect('01 $199.99 expensed: not listed', rls_test.has('q01', 'line_id', 'L2'), 0);
SELECT rls_test.expect('01 $200.00 is grey', rls_test.has('q01', 'line_id', 'L3', $$suggested_action LIKE 'Cameron decides (grey zone%'$$), 1);
SELECT rls_test.expect('01 $2,500.00 is grey', rls_test.has('q01', 'line_id', 'L4', $$suggested_action LIKE 'Cameron decides (grey zone%'$$), 1);
SELECT rls_test.expect('01 $2,500.01 expensed → set depreciate', rls_test.has('q01', 'line_id', 'L5', $$suggested_action = 'set tax_treatment = depreciate'$$), 1);
SELECT rls_test.expect('01 $3,000 depreciated: not listed', rls_test.has('q01', 'line_id', 'L6'), 0);
SELECT rls_test.expect('01 2025 lines: not listed', rls_test.has('q01', 'line_id', 'L7'), 0);
SELECT rls_test.expect('01 no item cost: 600 / 4 = 150 → set expense', rls_test.has('q01', 'line_id', 'L8', $$item_cost = 150 AND suggested_action = 'set tax_treatment = expense'$$), 1);

-- 02 track as equipment
SELECT rls_test.expect('02 a tracked line', rls_test.has('q02', 'line_id', 'L6', 'tracked AND records = 1'), 1);
SELECT rls_test.expect('02 a line named by asset_id counts as tracked', rls_test.has('q02', 'line_id', 'L13', 'tracked'), 1);
SELECT rls_test.expect('02 an untracked line', rls_test.has('q02', 'line_id', 'L3', 'NOT tracked'), 1);
SELECT rls_test.expect('02 every 2026 line of org A is listed (20; L7 is 2025)',
  (SELECT count(*)::int FROM q02 WHERE organization_id = rls_test.u('org_a')), 20);

-- 03 gig expense links
SELECT rls_test.expect('03 double count lists both rows', (SELECT count(*)::int FROM q03 WHERE finding = 'double count' AND line_id = rls_test.k('L9')), 2);
SELECT rls_test.expect('03 whole invoice', rls_test.has('q03', 'ledger_id', 'G3', $$finding = 'whole invoice'$$), 1);
SELECT rls_test.expect('03 not expensed', rls_test.has('q03', 'ledger_id', 'G4', $$finding = 'not expensed'$$), 1);
SELECT rls_test.expect('03 ...and not also other gig', rls_test.has('q03', 'ledger_id', 'G4', $$finding = 'other gig'$$), 0);
SELECT rls_test.expect('03 other gig', rls_test.has('q03', 'ledger_id', 'G5', $$finding = 'other gig'$$), 1);
SELECT rls_test.expect('03 no ledger row', rls_test.has('q03', 'line_id', 'L10', $$finding = 'no ledger row'$$), 1);
SELECT rls_test.expect('03 no purchase link', rls_test.has('q03', 'ledger_id', 'G6', $$finding = 'no purchase link'$$), 1);
SELECT rls_test.expect('03 mileage is not a purchase', rls_test.has('q03', 'ledger_id', 'G7'), 0);
SELECT rls_test.expect('03 2025 rows: not listed', rls_test.has('q03', 'ledger_id', 'G8'), 0);
SELECT rls_test.expect('03 a line with one ledger row on its gig: not listed', rls_test.has('q03', 'line_id', 'L9', $$finding <> 'double count'$$), 0);

-- 04 invoice totals
SELECT rls_test.expect('04 an invoice that adds up: not listed', rls_test.has('q04', 'invoice_id', 'H1'), 0);
SELECT rls_test.expect('04 off by $0.01: not listed', rls_test.has('q04', 'invoice_id', 'H2'), 0);
SELECT rls_test.expect('04 off by $0.02: listed', rls_test.has('q04', 'invoice_id', 'H3', 'difference = 0.02'), 1);
SELECT rls_test.expect('04 no total → set it', rls_test.has('q04', 'invoice_id', 'H4', $$suggested_action = 'set total_inv_amount = lines_total'$$), 1);
SELECT rls_test.expect('04 no lines', rls_test.has('q04', 'invoice_id', 'H5', 'lines = 0'), 1);
SELECT rls_test.expect('04 2025 invoices: not listed', rls_test.has('q04', 'invoice_id', 'H0'), 0);

-- 05 categories and recovery periods
SELECT rls_test.expect('05 a category not in the table', rls_test.has('q05', 'line_id', 'L12', $$finding = 'line category'$$), 1);
SELECT rls_test.expect('05 case and spaces don''t matter', rls_test.has('q05', 'line_id', 'L13', $$finding = 'line category'$$), 0);
SELECT rls_test.expect('05 no category', rls_test.has('q05', 'line_id', 'L14', $$finding = 'line category'$$), 1);
SELECT rls_test.expect('05 equipment category not the org''s', rls_test.has('q05', 'asset_id', 'A4', $$finding = 'equipment category'$$), 1);
SELECT rls_test.expect('05 period missing, default 7 → set it', rls_test.has('q05', 'asset_id', 'A3', $$suggested_action = 'set recovery_period = 7'$$), 1);
SELECT rls_test.expect('05 period missing, no default', rls_test.has('q05', 'asset_id', 'A2', $$suggested_action = 'Cameron decides (the category has no default)'$$), 1);
SELECT rls_test.expect('05 period = default: not listed', rls_test.has('q05', 'asset_id', 'A1'), 0);
SELECT rls_test.expect('05 a period that differs from the (missing) default is listed', rls_test.has('q05', 'asset_id', 'A4', $$finding = 'recovery period'$$), 1);

-- 06 returns, refunds, status
SELECT rls_test.expect('06 returned with no date or refund', rls_test.has('q06', 'asset_id', 'A5', $$suggested_action = 'Cameron decides (enter the date and the refund)'$$), 1);
SELECT rls_test.expect('06 disposed and complete: not listed', rls_test.has('q06', 'asset_id', 'A6'), 0);
SELECT rls_test.expect('06 active with a retired date', rls_test.has('q06', 'asset_id', 'A7', $$finding = 'active, retired'$$), 1);
SELECT rls_test.expect('06 inactive', rls_test.has('q06', 'asset_id', 'A8', $$finding = 'inactive'$$), 1);
SELECT rls_test.expect('06 active and current: not listed', rls_test.has('q06', 'asset_id', 'A1'), 0);
SELECT rls_test.expect('06 a negative depreciated line → set expense', rls_test.has('q06', 'line_id', 'L16', $$finding = 'return line'$$), 1);
SELECT rls_test.expect('06 a negative expense line: not listed', rls_test.has('q06', 'line_id', 'L17'), 0);
SELECT rls_test.expect('06 a return invoice', rls_test.has('q06', 'invoice_id', 'H6', $$finding = 'return invoice'$$), 1);

-- 07 mileage
SELECT rls_test.expect('07 1 mi at $0.725 rounds to $0.73: not listed', rls_test.has('q07', 'ledger_id', 'G7'), 0);
SELECT rls_test.expect('07 06-30 at $0.725: not listed', rls_test.has('q07', 'ledger_id', 'G9'), 0);
SELECT rls_test.expect('07 07-01 at the old rate: amount', rls_test.has('q07', 'ledger_id', 'G10', $$finding = 'amount' AND expected = 76.00$$), 1);
SELECT rls_test.expect('07 right amount, wrong line: category', rls_test.has('q07', 'ledger_id', 'G11', $$finding = 'category'$$), 1);

-- 08 missing cost or purchase
SELECT rls_test.expect('08 no cost', rls_test.has('q08', 'asset_id', 'A10', $$finding = 'no cost'$$), 1);
SELECT rls_test.expect('08 no purchase', rls_test.has('q08', 'asset_id', 'A10', $$finding = 'no purchase'$$), 1);
SELECT rls_test.expect('08 zero cost on a line: no cost only', (SELECT count(*)::int FROM q08 WHERE asset_id = rls_test.k('A11')), 1);
SELECT rls_test.expect('08 named by a line''s asset_id: has a purchase', rls_test.has('q08', 'asset_id', 'A12', $$finding = 'no purchase'$$), 0);
SELECT rls_test.expect('08 costed and linked: not listed', rls_test.has('q08', 'asset_id', 'A1'), 0);

-- 09 depreciable basis by year
SELECT rls_test.expect('09 3 records of a $100 line: 33.33, 33.33, 33.34',
  (SELECT count(*)::int FROM q09 WHERE line_id = rls_test.k('L18')
     AND record_cost IN (33.33, 33.34) GROUP BY line_id HAVING sum(record_cost) = 100 AND count(*) = 3), 3);
SELECT rls_test.expect('09 a line''s records add up to the line (L15, 2 records)',
  (SELECT (sum(record_cost) = 6000)::int FROM q09 WHERE line_id = rls_test.k('L15')), 1);
SELECT rls_test.expect('09 a depreciated line with no record is one row', rls_test.has('q09', 'line_id', 'L1', 'asset_id IS NULL AND record_cost = 199.99'), 1);
SELECT rls_test.expect('09 expensed lines aren''t basis', rls_test.has('q09', 'line_id', 'L2'), 0);
SELECT rls_test.expect('09 2025 total is the 2025 line', (SELECT (max(year_total) = 50)::int FROM q09 WHERE tax_year = 2025 AND organization_id = rls_test.u('org_a')), 1);
SELECT rls_test.expect('09 totals are per org', (SELECT (max(year_total) = 900)::int FROM q09 WHERE tax_year = 2026 AND organization_id = rls_test.u('org_b')), 1);
SELECT rls_test.expect('09 org A 2026 total = sum of its records',
  (SELECT (max(year_total) = sum(record_cost))::int FROM q09 WHERE tax_year = 2026 AND organization_id = rls_test.u('org_a')), 1);
