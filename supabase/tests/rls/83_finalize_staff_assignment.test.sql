-- B5: finalizing a staff member's pay is one call (finalize_staff_assignment). A fee is the
-- amount even at $0; a rate is rate x the units entered (0 and decimals as entered). The labor
-- row is dated by the gig's start date in the gig's time zone, so a gig in a filed year is
-- refused. The row and the assignment's back-link are written together. Runs as the caller.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('fs_slot', '00000000-0000-0000-0000-0000000017a1'),
  ('fs_fee0', '00000000-0000-0000-0000-0000000018a1'),
  ('fs_rate', '00000000-0000-0000-0000-0000000018a2'),
  ('fs_done', '00000000-0000-0000-0000-0000000018a3');

-- 7 PM Feb 28 in Los Angeles is already March 1 in UTC.
UPDATE gigs SET start = '2026-03-01T03:00:00Z', "end" = '2026-03-01T07:00:00Z', timezone = 'America/Los_Angeles'
 WHERE id = rls_test.u('gig');
INSERT INTO gig_staff_slots (id, gig_id, staff_role_id, organization_id) VALUES
  (rls_test.u('fs_slot'), rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a'));
INSERT INTO gig_staff_assignments (id, slot_id, user_id, status, fee, rate, rate_unit, completed_at) VALUES
  (rls_test.u('fs_fee0'), rls_test.u('fs_slot'), rls_test.u('a_staff'), 'Confirmed', 0,    NULL, NULL,  NULL),
  (rls_test.u('fs_rate'), rls_test.u('fs_slot'), rls_test.u('a_staff'), 'Confirmed', NULL, 50,   'hour', NULL),
  (rls_test.u('fs_done'), rls_test.u('fs_slot'), rls_test.u('a_staff'), 'Confirmed', 100,  NULL, NULL,  now());

-- As p_user, finalize, then return a number from p_sql over the result ($1 = assignment id). Rolled back; -1 if refused.
CREATE FUNCTION rls_test.finalize(p_user text, p_asg text, p_units numeric, p_sql text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_id uuid := rls_test.u(p_asg); v_user uuid := rls_test.u(p_user); v numeric;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.finalize_staff_assignment(v_id, p_units);
    RESET ROLE;
    EXECUTE p_sql INTO v USING v_id;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = coalesce(v, -999)::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::numeric;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;

SELECT rls_test.expect('A $0 fee is the amount (not the rate)',
  rls_test.finalize('a_admin', 'fs_fee0', NULL, 'SELECT f.amount FROM gig_financials f JOIN gig_staff_assignments a ON a.gig_financial_id = f.id WHERE a.id = $1')::int, 0);
SELECT rls_test.expect('A rate is rate x the units entered (2.5 hours x $50)',
  (rls_test.finalize('a_admin', 'fs_rate', 2.5, 'SELECT f.amount FROM gig_financials f JOIN gig_staff_assignments a ON a.gig_financial_id = f.id WHERE a.id = $1') * 100)::int, 12500);
SELECT rls_test.expect('  ...and the units are kept as entered',
  (rls_test.finalize('a_admin', 'fs_rate', 2.5, 'SELECT units_completed FROM gig_staff_assignments WHERE id = $1') * 10)::int, 25);
SELECT rls_test.expect('Zero units is $0, kept as 0',
  rls_test.finalize('a_admin', 'fs_rate', 0, 'SELECT f.amount + a.units_completed FROM gig_financials f JOIN gig_staff_assignments a ON a.gig_financial_id = f.id WHERE a.id = $1')::int, 0);
SELECT rls_test.expect('A rate without units is refused',
  rls_test.finalize('a_admin', 'fs_rate', NULL, 'SELECT 1'), -1);
SELECT rls_test.expect('The labor row is dated by the gig''s start date in its time zone (Feb 28, not today or Mar 1)',
  rls_test.finalize('a_admin', 'fs_fee0', NULL, $q$SELECT count(*) FROM gig_financials f JOIN gig_staff_assignments a ON a.gig_financial_id = f.id WHERE a.id = $1 AND f.date = '2026-02-28'$q$)::int, 1);
SELECT rls_test.expect('  ...owed, Contract labor, linked to the assignment, which is marked done',
  rls_test.finalize('a_admin', 'fs_fee0', NULL, $q$SELECT count(*) FROM gig_financials f JOIN gig_staff_assignments a ON a.gig_financial_id = f.id
     WHERE a.id = $1 AND f.stage = 'invoiced' AND f.direction = 'out' AND f.category = 'Contract labor' AND f.staff_assignment_id = a.id AND a.completed_at IS NOT NULL$q$)::int, 1);
SELECT rls_test.expect('An assignment already finalized is refused',
  rls_test.finalize('a_admin', 'fs_done', NULL, 'SELECT 1'), -1);
SELECT rls_test.expect('Staff cannot finalize pay', rls_test.finalize('a_staff', 'fs_fee0', NULL, 'SELECT 1'), -1);
SELECT rls_test.expect('Another organization cannot', rls_test.finalize('b_admin', 'fs_fee0', NULL, 'SELECT 1'), -1);

-- A gig in a filed year: refused, and nothing changes.
UPDATE gigs SET start = '2025-12-31T20:00:00Z', "end" = '2025-12-31T23:00:00Z', timezone = 'UTC' WHERE id = rls_test.u('gig');
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');
SELECT rls_test.expect('A gig in a filed year: finalizing is refused',
  rls_test.finalize('a_admin', 'fs_fee0', NULL, 'SELECT 1'), -1);
SELECT rls_test.expect('  ...the assignment is still open, with no labor row',
  (SELECT count(*)::int FROM gig_staff_assignments WHERE id = rls_test.u('fs_fee0') AND completed_at IS NULL AND gig_financial_id IS NULL), 1);
