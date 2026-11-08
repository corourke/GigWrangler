-- B2: deleting a purchase line, or a whole purchase, removes the gig expenses linked to
-- its lines, instead of leaving them behind unlinked (where they would count as gig money).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('ph', '00000000-0000-0000-0000-00000000d001'),
  ('pl1', '00000000-0000-0000-0000-00000000d002'),
  ('pl2', '00000000-0000-0000-0000-00000000d003'),
  ('qh', '00000000-0000-0000-0000-00000000d004'),
  ('ql', '00000000-0000-0000-0000-00000000d005'),
  ('oh', '00000000-0000-0000-0000-00000000d006'),
  ('ol', '00000000-0000-0000-0000-00000000d007'),
  ('f_pl1', '00000000-0000-0000-0000-00000000d101'),
  ('f_pl2', '00000000-0000-0000-0000-00000000d102'),
  ('f_ql', '00000000-0000-0000-0000-00000000d103'),
  ('f_ol', '00000000-0000-0000-0000-00000000d104'),
  ('f_own', '00000000-0000-0000-0000-00000000d105');

CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
CREATE FUNCTION rls_test.fin(p text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.gig_financials WHERE id = rls_test.u(p) $$;
-- As p_user, delete a purchase, then count which of these gig money rows are left. Rolled back;
-- -1 if the delete is refused or deletes nothing.
CREATE FUNCTION rls_test.left_after_delete(p_user text, p_purchase text, p_fins text[]) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int; v_left int; v_purchase uuid := rls_test.u(p_purchase);
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.purchases WHERE id = v_purchase;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    SELECT count(*)::int INTO v_left FROM public.gig_financials WHERE id IN (SELECT rls_test.u(f) FROM unnest(p_fins) f);
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = CASE WHEN n = 0 THEN -1 ELSE v_left END::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::int;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;

-- Purchase P (two lines) and Q (one line) in 2026; O in 2025, which gets filed.
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount) VALUES
  (rls_test.u('ph'), rls_test.u('org_a'), NULL, 'header', '2026-04-01', 'V', 30),
  (rls_test.u('qh'), rls_test.u('org_a'), NULL, 'header', '2026-04-02', 'V', 15),
  (rls_test.u('oh'), rls_test.u('org_a'), NULL, 'header', '2025-04-02', 'V', 12);
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment) VALUES
  (rls_test.u('pl1'), rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 1, 10, 10, 'tape', 'expense'),
  (rls_test.u('pl2'), rls_test.u('org_a'), rls_test.u('ph'), 'line', '2026-04-01', 1, 20, 20, 'batteries', 'expense'),
  (rls_test.u('ql'),  rls_test.u('org_a'), rls_test.u('qh'), 'line', '2026-04-02', 1, 15, 15, 'gels', 'expense'),
  (rls_test.u('ol'),  rls_test.u('org_a'), rls_test.u('oh'), 'line', '2025-04-02', 1, 12, 12, 'strings', 'expense');
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, description, created_by) VALUES
  (rls_test.u('f_pl1'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 10, 10, '2026-04-01', '2026-04-01', rls_test.u('pl1'), 'tape',      rls_test.u('a_admin')),
  (rls_test.u('f_pl2'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 20, 20, '2026-04-01', '2026-04-01', rls_test.u('pl2'), 'batteries', rls_test.u('a_admin')),
  (rls_test.u('f_ql'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 15, 15, '2026-04-02', '2026-04-02', rls_test.u('ql'),  'gels',      rls_test.u('a_admin')),
  (rls_test.u('f_ol'),  rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 12, 12, '2025-04-02', '2025-04-02', rls_test.u('ol'),  'strings',   rls_test.u('a_admin')),
  (rls_test.u('f_own'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 40, 40, '2026-04-03', '2026-04-03', NULL,              'parking',   rls_test.u('a_admin'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

SELECT rls_test.expect('Deleting a line (as an Admin) removes its gig expense',
  rls_test.left_after_delete('a_admin', 'ql', ARRAY['f_ql']), 0);
SELECT rls_test.expect('Deleting a whole purchase removes the gig expenses of all its lines, and no other gig money',
  rls_test.left_after_delete('a_admin', 'ph', ARRAY['f_pl1', 'f_pl2', 'f_own']), 1);
SELECT rls_test.expect('A purchase in a filed year still cannot be deleted',
  rls_test.left_after_delete('a_admin', 'oh', ARRAY['f_ol']), -1);
SELECT rls_test.expect('  ...and its gig expense stays', rls_test.fin('f_ol'), 1);

SELECT rls_test.expect('The link deletes with the purchase (ON DELETE CASCADE)',
  (SELECT count(*)::int FROM pg_constraint
    WHERE conrelid = 'public.gig_financials'::regclass AND conname = 'gig_financials_purchase_id_fkey' AND confdeltype = 'c'), 1);
