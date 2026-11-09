-- B21: changing a purchase line's gig is one call (set_purchase_line_gig): the line and its gig
-- expenses move together, or are unlinked and removed together once confirmed, or nothing changes.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('gig2', '00000000-0000-0000-0000-00000000d201'),
  ('gig_c', '00000000-0000-0000-0000-00000000d202'),
  ('h', '00000000-0000-0000-0000-00000000d101'),
  ('l1', '00000000-0000-0000-0000-00000000d102'),
  ('l_none', '00000000-0000-0000-0000-00000000d103'),
  ('h_old', '00000000-0000-0000-0000-00000000d104'),
  ('l_old', '00000000-0000-0000-0000-00000000d105'),
  ('f1', '00000000-0000-0000-0000-00000000d301'),
  ('f_old', '00000000-0000-0000-0000-00000000d302'),
  ('f_in', '00000000-0000-0000-0000-00000000d303');

INSERT INTO gigs (id, title, status, start, "end", timezone, created_by, updated_by, owner_organization_id) VALUES
  (rls_test.u('gig2'), 'Second gig', (enum_range(NULL::gig_status))[1], now(), now() + interval '4 hours', 'UTC', rls_test.u('a_admin'), rls_test.u('a_admin'), rls_test.u('org_a')),
  (rls_test.u('gig_c'), 'Org C gig', (enum_range(NULL::gig_status))[1], now(), now() + interval '4 hours', 'UTC', rls_test.u('c_admin'), rls_test.u('c_admin'), rls_test.u('org_c'));
INSERT INTO gig_participants (gig_id, organization_id, role) VALUES
  (rls_test.u('gig2'), rls_test.u('org_a'), 'Production'),
  (rls_test.u('gig_c'), rls_test.u('org_c'), 'Production');
-- A person in both org A and org C.
INSERT INTO organization_members (organization_id, user_id, role) VALUES (rls_test.u('org_c'), rls_test.u('a_admin'), 'Admin');

INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount, description) VALUES
  (rls_test.u('h'), rls_test.u('org_a'), NULL, 'header', '2026-05-01', 'Store', 80, 'Parts'),
  (rls_test.u('h_old'), rls_test.u('org_a'), NULL, 'header', '2025-05-01', 'Store', 20, 'Old');
INSERT INTO purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment, gig_id) VALUES
  (rls_test.u('l1'), rls_test.u('org_a'), rls_test.u('h'), 'line', '2026-05-01', 1, 60, 60, 'Tape', 'expense', rls_test.u('gig')),
  (rls_test.u('l_none'), rls_test.u('org_a'), rls_test.u('h'), 'line', '2026-05-01', 1, 20, 20, 'Gels', 'expense', rls_test.u('gig')),
  (rls_test.u('l_old'), rls_test.u('org_a'), rls_test.u('h_old'), 'line', '2025-05-01', 1, 20, 20, 'Old', 'expense', rls_test.u('gig'));
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, description, created_by) VALUES
  (rls_test.u('f1'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 60, 60, '2026-05-01', '2026-05-01', rls_test.u('l1'), 'Tape', rls_test.u('a_admin')),
  (rls_test.u('f_old'), rls_test.u('gig'), rls_test.u('org_a'), 'out', 'paid', 20, 20, '2025-05-01', '2025-05-01', rls_test.u('l_old'), 'Old', rls_test.u('a_admin'));
-- A filed-year row the lock does protect (income is tax data), to show a refused step undoes the
-- whole change.
INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, description, created_by) VALUES
  (rls_test.u('f_in'), rls_test.u('gig'), rls_test.u('org_a'), 'in', 'paid', 5, 5, '2025-05-01', '2025-05-01', rls_test.u('l_old'), 'Refund', rls_test.u('a_admin'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

-- As p_user, call p_call, then return a number from p_check. Rolled back; -1 if refused.
CREATE FUNCTION rls_test.call_then(p_user text, p_call text, p_check text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_user uuid := rls_test.u(p_user); v int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_call;
    RESET ROLE;
    EXECUTE p_check INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = coalesce(v, -999)::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::int;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;
CREATE FUNCTION rls_test.set_gig(p_line text, p_gig text, p_remove boolean DEFAULT false) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('SELECT public.set_purchase_line_gig(%L, %s, %s)', rls_test.u(p_line),
    CASE WHEN p_gig IS NULL THEN 'NULL' ELSE quote_literal(rls_test.u(p_gig)) END, CASE WHEN p_remove THEN 'true' ELSE 'false' END)
$$;

-- Moving a line to another gig takes its gig expense along.
SELECT rls_test.expect('Moving a line moves the line', rls_test.call_then('a_admin', rls_test.set_gig('l1', 'gig2'),
  format('SELECT count(*)::int FROM public.purchases WHERE id = %L AND gig_id = %L', rls_test.u('l1'), rls_test.u('gig2'))), 1);
SELECT rls_test.expect('... and its gig expense', rls_test.call_then('a_admin', rls_test.set_gig('l1', 'gig2'),
  format('SELECT count(*)::int FROM public.gig_financials WHERE id = %L AND gig_id = %L', rls_test.u('f1'), rls_test.u('gig2'))), 1);
SELECT rls_test.expect('The same gig again writes nothing', rls_test.call_then('a_admin', rls_test.set_gig('l1', 'gig'),
  format('SELECT count(*)::int FROM public.purchases WHERE id = %L AND updated_by IS NULL', rls_test.u('l1'))), 1);

-- Clearing a line's gig removes its gig expense only once confirmed.
SELECT rls_test.expect('Clearing a line with gig expenses needs confirming', rls_test.call_then('a_admin', rls_test.set_gig('l1', NULL),
  'SELECT 1'), -1);
SELECT rls_test.expect('Confirmed, the line is unlinked', rls_test.call_then('a_admin', rls_test.set_gig('l1', NULL, true),
  format('SELECT count(*)::int FROM public.purchases WHERE id = %L AND gig_id IS NULL', rls_test.u('l1'))), 1);
SELECT rls_test.expect('... and its gig expense removed', rls_test.call_then('a_admin', rls_test.set_gig('l1', NULL, true),
  format('SELECT count(*)::int FROM public.gig_financials WHERE id = %L', rls_test.u('f1'))), 0);
SELECT rls_test.expect('A line with no gig expenses just unlinks', rls_test.call_then('a_admin', rls_test.set_gig('l_none', NULL),
  format('SELECT count(*)::int FROM public.purchases WHERE id = %L AND gig_id IS NULL', rls_test.u('l_none'))), 1);

-- A line's gig link isn't tax data (the purchase is), so a filed year doesn't stop a move.
SELECT rls_test.expect('A filed year still lets a line move gigs', rls_test.call_then('a_admin', rls_test.set_gig('l_old', 'gig2'),
  format('SELECT count(*)::int FROM public.gig_financials WHERE purchase_id = %L AND gig_id = %L', rls_test.u('l_old'), rls_test.u('gig2'))), 2);

-- All or nothing: one refused step (deleting filed-year income) undoes the whole change.
SELECT rls_test.expect('A refused removal refuses the change', rls_test.call_then('a_admin', rls_test.set_gig('l_old', NULL, true), 'SELECT 1'), -1);
DO $$
DECLARE v_user uuid := rls_test.u('a_admin'); v_line uuid := rls_test.u('l_old');
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.set_purchase_line_gig(v_line, NULL, true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
END $$;
SELECT rls_test.expect('... the line keeps its gig', (SELECT count(*)::int FROM public.purchases WHERE id = rls_test.u('l_old') AND gig_id = rls_test.u('gig')), 1);
SELECT rls_test.expect('... and its gig expense stays', (SELECT count(*)::int FROM public.gig_financials WHERE id = rls_test.u('f_old')), 1);

-- Who may.
SELECT rls_test.expect('A gig outside the purchase''s organization is refused', rls_test.call_then('a_admin', rls_test.set_gig('l1', 'gig_c'), 'SELECT 1'), -1);
SELECT rls_test.expect('A Viewer is refused', rls_test.call_then('a_viewer', rls_test.set_gig('l1', 'gig2'), 'SELECT 1'), -1);
SELECT rls_test.expect('Another organization is refused', rls_test.call_then('b_admin', rls_test.set_gig('l1', 'gig2'), 'SELECT 1'), -1);
SELECT rls_test.expect('Signed out cannot call it',
  coalesce((SELECT CASE WHEN has_function_privilege('anon', f, 'EXECUTE') THEN 1 ELSE 0 END
            FROM to_regprocedure('public.set_purchase_line_gig(uuid, uuid, boolean)') f WHERE f IS NOT NULL), -1), 0);
