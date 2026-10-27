-- Schedule C line 4, cost of goods sold (Part III), as a line an expense category can use (#321).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

SELECT rls_test.expect('Line 4 is one of the Schedule C lines',
  rls_test.visible(rls_test.u('a_staff'), 'schedule_c_lines', $$code = '4' AND label = 'Cost of goods sold (Part III)'$$), 1);
SELECT rls_test.expect('...listed first',
  (SELECT (min(sort_order) = (SELECT sort_order FROM schedule_c_lines WHERE code = '4'))::int FROM schedule_c_lines), 1);

SELECT set_config('request.jwt.claim.sub', rls_test.u('a_admin')::text, true);
SELECT public.ensure_org_categories(rls_test.u('org_a'));
SELECT rls_test.expect('An Admin adds an expense category on line 4',
  rls_test.try(rls_test.u('a_admin'), format($$INSERT INTO expense_categories (organization_id, name, schedule_c_line, sort_order)
    VALUES (%L, 'Cost of goods sold (resale)', '4', 1)$$, rls_test.u('org_a'))), 1);
SELECT rls_test.expect('An Admin moves a category to line 4',
  rls_test.try(rls_test.u('a_admin'), format($$UPDATE expense_categories SET schedule_c_line = '4'
    WHERE organization_id = %L AND name = 'Freight and shipping'$$, rls_test.u('org_a'))), 1);
SELECT rls_test.expect('A line that doesn''t exist is still refused',
  rls_test.try(rls_test.u('a_admin'), format($$INSERT INTO expense_categories (organization_id, name, schedule_c_line, sort_order)
    VALUES (%L, 'Line three', '3', 1)$$, rls_test.u('org_a'))), -1);
SELECT rls_test.expect('A Manager still can''t add one',
  rls_test.try(rls_test.u('a_manager'), format($$INSERT INTO expense_categories (organization_id, name, schedule_c_line, sort_order)
    VALUES (%L, 'Resale', '4', 1)$$, rls_test.u('org_a'))), -1);
SELECT rls_test.expect('Nobody changes the lines',
  rls_test.try(rls_test.u('a_admin'), $$DELETE FROM schedule_c_lines WHERE code = '4'$$), 0);
