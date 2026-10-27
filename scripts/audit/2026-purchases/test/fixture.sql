-- Fixture for the #135 worksheet queries: one row per case each query must catch, and near
-- misses it must not. Loaded after supabase/tests/rls/_harness.sql and _fixture.sql (orgs A and B,
-- their users, a shared gig), in a transaction run.sh rolls back.
CREATE FUNCTION rls_test.k(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('audit:' || p)::uuid $$;

-- Copy the category templates as each org's admin (the function checks membership).
SELECT set_config('request.jwt.claim.sub', rls_test.u('a_admin')::text, true), public.ensure_org_categories(rls_test.u('org_a'));
SELECT set_config('request.jwt.claim.sub', rls_test.u('b_admin')::text, true), public.ensure_org_categories(rls_test.u('org_b'));
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE equipment_categories SET default_recovery_period = NULL
 WHERE organization_id = rls_test.u('org_a') AND name = 'Networking';

-- Invoices (row_type header).
INSERT INTO purchases (id, organization_id, row_type, purchase_date, vendor, total_inv_amount) VALUES
  (rls_test.k('H0'), rls_test.u('org_a'), 'header', '2025-06-01', 'Old Co', 50),
  (rls_test.k('H1'), rls_test.u('org_a'), 'header', '2026-03-01', 'Shop', 0),        -- total set below
  (rls_test.k('H2'), rls_test.u('org_a'), 'header', '2026-03-02', 'Shop', 100.00),   -- lines 99.99: off by 0.01, not listed
  (rls_test.k('H3'), rls_test.u('org_a'), 'header', '2026-03-03', 'Shop', 100.00),   -- lines 99.98: listed
  (rls_test.k('H4'), rls_test.u('org_a'), 'header', '2026-03-04', 'Shop', NULL),     -- no total: listed
  (rls_test.k('H5'), rls_test.u('org_a'), 'header', '2026-03-05', 'Shop', 10),       -- no lines: listed
  (rls_test.k('H6'), rls_test.u('org_a'), 'header', '2026-03-06', 'Returns', -70),   -- return invoice
  (rls_test.k('HB'), rls_test.u('org_b'), 'header', '2026-04-01', 'B Shop', 900);

-- Lines. Category 'Expendables and supplies' is a valid expense category.
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, tax_treatment, category, gig_id, description) VALUES
  (rls_test.k('L1'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 199.99, 199.99, 'depreciate', 'Expendables and supplies', NULL, 'cheap, depreciated'),
  (rls_test.k('L2'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 199.99, 199.99, 'expense',    'Expendables and supplies', NULL, 'cheap, expensed'),
  (rls_test.k('L3'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 200.00, 200.00, 'expense',    'Expendables and supplies', NULL, 'grey low'),
  (rls_test.k('L4'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 2500.00, 2500.00, 'depreciate', 'Expendables and supplies', NULL, 'grey high'),
  (rls_test.k('L5'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 2500.01, 2500.01, 'expense',    'Expendables and supplies', NULL, 'dear, expensed'),
  (rls_test.k('L6'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 3000, 3000, 'depreciate',      'Expendables and supplies', NULL, 'dear, depreciated'),
  (rls_test.k('L7'),  rls_test.u('org_a'), rls_test.k('H0'), 'line', NULL, 1, 50, 50, 'depreciate',          'Expendables and supplies', NULL, 'last year'),
  (rls_test.k('L8'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 4, NULL, 600, 'depreciate',       'Expendables and supplies', NULL, 'no item cost, 4 at 150'),
  (rls_test.k('L9'),  rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 20, 20, 'expense',             'Expendables and supplies', rls_test.u('gig'), 'counted twice'),
  (rls_test.k('L10'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 30, 30, 'expense',             'Expendables and supplies', rls_test.u('gig'), 'no ledger row'),
  (rls_test.k('L11'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 40, 40, 'expense',             'Expendables and supplies', NULL, 'ledger on a gig, line on none'),
  (rls_test.k('L12'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 10, 10, 'expense',             'Bogus category', NULL, 'bad category'),
  (rls_test.k('L13'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 10, 10, 'expense',             'expendables AND supplies ', NULL, 'category in other case'),
  (rls_test.k('L14'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 1, 10, 10, 'expense',             NULL, NULL, 'no category'),
  (rls_test.k('L15'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 2, 3000, 6000, 'depreciate',      'Expendables and supplies', NULL, 'two consoles'),
  (rls_test.k('L16'), rls_test.u('org_a'), rls_test.k('H6'), 'line', NULL, 1, -50, -50, 'depreciate',        'Expendables and supplies', NULL, 'return, depreciated'),
  (rls_test.k('L17'), rls_test.u('org_a'), rls_test.k('H6'), 'line', NULL, 1, -20, -20, 'expense',           'Expendables and supplies', NULL, 'return, expensed'),
  (rls_test.k('L18'), rls_test.u('org_a'), rls_test.k('H1'), 'line', NULL, 3, NULL, 100, 'depreciate',       'Expendables and supplies', NULL, '3 for 100'),
  (rls_test.k('L21'), rls_test.u('org_a'), rls_test.k('H2'), 'line', NULL, 1, 99.99, 99.99, 'expense',       'Expendables and supplies', NULL, 'H2 line'),
  (rls_test.k('L22'), rls_test.u('org_a'), rls_test.k('H3'), 'line', NULL, 1, 99.98, 99.98, 'expense',       'Expendables and supplies', NULL, 'H3 line'),
  (rls_test.k('L23'), rls_test.u('org_a'), rls_test.k('H4'), 'line', NULL, 1, 12, 12, 'expense',             'Expendables and supplies', NULL, 'H4 line'),
  (rls_test.k('LB'),  rls_test.u('org_b'), rls_test.k('HB'), 'line', NULL, 1, 900, 900, 'depreciate',        'Expendables and supplies', NULL, 'org B gear');
UPDATE purchases SET total_inv_amount = (SELECT sum(line_cost) FROM purchases WHERE parent_id = rls_test.k('H1'))
 WHERE id = rls_test.k('H1');

-- Equipment. Triggers fill items and periods on insert; exact period states are set after with
-- triggers off (session_replication_role = replica, superuser only).
INSERT INTO assets (id, organization_id, acquisition_date, category, manufacturer_model, quantity, item_cost, status, retired_on, liquidation_amt, purchase_line_id, created_by, updated_by) VALUES
  (rls_test.k('A1'),  rls_test.u('org_a'), '2026-03-01', 'Audio',      'Console A',  1, 3000, 'Active',   NULL, NULL, rls_test.k('L6'),  rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A2'),  rls_test.u('org_a'), '2026-03-01', 'Networking', 'Switch',     1, 2500, 'Active',   NULL, NULL, rls_test.k('L4'),  rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A3'),  rls_test.u('org_a'), '2026-03-01', 'Audio',      'Console B1', 1, 3000, 'Active',   NULL, NULL, rls_test.k('L15'), rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A4'),  rls_test.u('org_a'), '2026-03-01', 'Bogus Gear', 'Console B2', 1, 3000, 'Active',   NULL, NULL, rls_test.k('L15'), rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A5'),  rls_test.u('org_a'), '2024-01-01', 'Audio',      'Returned, no date', 1, 100, 'Returned', NULL, NULL, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A6'),  rls_test.u('org_a'), '2024-01-01', 'Audio',      'Disposed, complete', 1, 100, 'Disposed', '2025-01-01', 40, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A7'),  rls_test.u('org_a'), '2024-01-01', 'Audio',      'Active, retired', 1, 100, 'Active', '2026-02-01', NULL, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A8'),  rls_test.u('org_a'), '2024-01-01', 'Audio',      'Inactive', 1, 100, 'Inactive', NULL, NULL, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A10'), rls_test.u('org_a'), '2023-01-01', 'Audio',      'No cost, no purchase', 1, NULL, 'Active', NULL, NULL, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A11'), rls_test.u('org_a'), '2026-03-01', 'Audio',      'Zero cost, linked', 1, 0, 'Active', NULL, NULL, rls_test.k('L2'), rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A12'), rls_test.u('org_a'), '2026-03-01', 'Audio',      'Named by a line', 1, 5, 'Active', NULL, NULL, NULL, rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A13'), rls_test.u('org_a'), '2026-03-01', 'Audio',      'Third 1', 1, NULL, 'Active', NULL, NULL, rls_test.k('L18'), rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A14'), rls_test.u('org_a'), '2026-03-01', 'Audio',      'Third 2', 1, NULL, 'Active', NULL, NULL, rls_test.k('L18'), rls_test.u('a_admin'), rls_test.u('a_admin')),
  (rls_test.k('A15'), rls_test.u('org_a'), '2026-03-01', 'Audio',      'Third 3', 1, NULL, 'Active', NULL, NULL, rls_test.k('L18'), rls_test.u('a_admin'), rls_test.u('a_admin'));
UPDATE purchases SET asset_id = rls_test.k('A12') WHERE id = rls_test.k('L13');
SET session_replication_role = replica;
UPDATE assets SET recovery_period = 7    WHERE id = rls_test.k('A1');   -- the category default: not listed
UPDATE assets SET recovery_period = NULL WHERE id = rls_test.k('A2');   -- Networking has no default here
UPDATE assets SET recovery_period = NULL WHERE id = rls_test.k('A3');   -- Audio's default is 7
UPDATE assets SET recovery_period = 5    WHERE id = rls_test.k('A4');   -- (its category isn't the org's)
UPDATE assets SET item_cost = NULL       WHERE id = rls_test.k('A13');
SET session_replication_role = origin;

-- Gig ledger rows (category is the IRS list, fin_category).
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, mileage, category, description, created_by) VALUES
  (rls_test.k('G1'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 20, 20, '2026-03-01', '2026-03-01', rls_test.k('L9'),  NULL, 'Supplies', 'L9 once', rls_test.u('a_admin')),
  (rls_test.k('G2'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 20, 20, '2026-03-01', '2026-03-01', rls_test.k('L9'),  NULL, 'Supplies', 'L9 twice', rls_test.u('a_admin')),
  (rls_test.k('G3'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 50, 50, '2026-03-01', '2026-03-01', rls_test.k('H1'),  NULL, 'Supplies', 'whole invoice', rls_test.u('a_admin')),
  (rls_test.k('G5'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 40, 40, '2026-03-01', '2026-03-01', rls_test.k('L11'), NULL, 'Supplies', 'other gig', rls_test.u('a_admin')),
  (rls_test.k('G6'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 75, 75, '2026-03-01', '2026-03-01', NULL, NULL, 'Supplies', 'no purchase', rls_test.u('a_admin')),
  (rls_test.k('G7'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 0.73, 0.73, '2026-03-01', '2026-03-01', NULL, 1, 'Car and truck expenses', '1 mile', rls_test.u('a_admin')),
  (rls_test.k('G8'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 60, 60, '2025-03-01', '2025-03-01', NULL, NULL, 'Supplies', 'last year', rls_test.u('a_admin')),
  (rls_test.k('G9'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 72.50, 72.50, '2026-06-30', '2026-06-30', NULL, 100, 'Car and truck expenses', '06-30 at 0.725', rls_test.u('a_admin')),
  (rls_test.k('G10'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 72.50, 72.50, '2026-07-01', '2026-07-01', NULL, 100, 'Car and truck expenses', '07-01 at the old rate', rls_test.u('a_admin')),
  (rls_test.k('G11'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 7.60, 7.60, '2026-07-01', '2026-07-01', NULL, 10, 'Travel', 'right amount, wrong line', rls_test.u('a_admin'));

-- A ledger row on a depreciated line: the app refuses these now, so this stands in for one
-- saved before that rule.
SET LOCAL session_replication_role = replica;
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, mileage, category, description, created_by) VALUES
  (rls_test.k('G4'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 2500, 2500, '2026-03-01', '2026-03-01', rls_test.k('L4'), NULL, 'Supplies', 'depreciated line', rls_test.u('a_admin'));
SET LOCAL session_replication_role = origin;
