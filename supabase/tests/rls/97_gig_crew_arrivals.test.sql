-- Crew arrival times (#458): one row per person per gig. Written before the migration.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
--
-- Fixture: org A owns the gig (it starts now and ends in 4 hours); org B is a participant.
--   a_staff   Confirmed on two org-A slots (one person, two slots)
--   a_manager Invited on an org-A slot (a Manager of the gig's owner who is also crew)
--   a_viewer  Requested (may not check in)      b_viewer  Declined (may not check in)
--   b_staff   Confirmed on an org-B slot        c_staff   no assignment
INSERT INTO gig_staff_slots (id, gig_id, staff_role_id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000058a1', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a')),
  ('00000000-0000-0000-0000-0000000058a2', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a')),
  ('00000000-0000-0000-0000-0000000058a3', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a')),
  ('00000000-0000-0000-0000-0000000058b1', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_b'));
INSERT INTO gig_staff_assignments (slot_id, user_id, status) VALUES
  ('00000000-0000-0000-0000-0000000058a1', rls_test.u('a_staff'),   'Confirmed'),
  ('00000000-0000-0000-0000-0000000058a2', rls_test.u('a_staff'),   'Confirmed'),
  ('00000000-0000-0000-0000-0000000058a3', rls_test.u('a_manager'), 'Invited'),
  ('00000000-0000-0000-0000-0000000058a3', rls_test.u('a_viewer'),  'Requested'),
  ('00000000-0000-0000-0000-0000000058b1', rls_test.u('b_viewer'),  'Declined'),
  ('00000000-0000-0000-0000-0000000058b1', rls_test.u('b_staff'),   'Confirmed');

-- The statements below name people with rls_test.u(...), so the signed-in role may read the id table
-- (this file is rolled back afterwards).
GRANT USAGE ON SCHEMA rls_test TO authenticated;
GRANT SELECT ON rls_test.ids TO authenticated;
GRANT EXECUTE ON FUNCTION rls_test.u(text) TO authenticated;

-- Writes as `actor` and keeps the change (try() rolls it back), for checks that need a row to exist.
CREATE FUNCTION rls_test.run(p_actor text, p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_actor)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
  RESET ROLE;
  RETURN n;
END $$;

CREATE FUNCTION rls_test.arrive(p_actor text, p_target text, p_at text DEFAULT 'now()') RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_actor), format(
    $q$INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at) VALUES (%L, %L, %s)$q$,
    rls_test.u('gig'), rls_test.u(p_target), p_at))
$$;
-- The same, kept.
CREATE FUNCTION rls_test.arrive_keep(p_actor text, p_target text, p_at text DEFAULT 'now()') RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.run(p_actor, format(
    $q$INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at) VALUES (%L, %L, %s)$q$,
    rls_test.u('gig'), rls_test.u(p_target), p_at))
$$;
CREATE FUNCTION rls_test.rows_of(p_target text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM gig_crew_arrivals WHERE gig_id = rls_test.u('gig') AND user_id = rls_test.u(p_target)
$$;

-- ── A person checks themselves in ──────────────────────────────────────────────────────────
SELECT rls_test.expect('Confirmed crew checks in', rls_test.arrive('a_staff', 'a_staff'), 1);
SELECT rls_test.expect('Invited crew checks in (a Manager who is also crew)', rls_test.arrive('a_manager', 'a_manager'), 1);
SELECT rls_test.expect('Requested may not', rls_test.arrive('a_viewer', 'a_viewer'), -1);
SELECT rls_test.expect('Declined may not', rls_test.arrive('b_viewer', 'b_viewer'), -1);
SELECT rls_test.expect('no assignment may not', rls_test.arrive('c_staff', 'c_staff'), -1);
SELECT rls_test.expect('12 hours before the start is allowed', rls_test.arrive('a_staff', 'a_staff', $$now() - interval '11 hours 59 minutes'$$), 1);
SELECT rls_test.expect('earlier than that is not', rls_test.arrive('a_staff', 'a_staff', $$now() - interval '12 hours 1 minute'$$), -1);
SELECT rls_test.expect('12 hours after the end is allowed', rls_test.arrive('a_staff', 'a_staff', $$now() + interval '15 hours 59 minutes'$$), 1);
SELECT rls_test.expect('later than that is not', rls_test.arrive('a_staff', 'a_staff', $$now() + interval '16 hours 1 minute'$$), -1);
SELECT rls_test.expect('a person may not check in someone else', rls_test.arrive('a_staff', 'b_staff'), -1);
SELECT rls_test.expect('a Staff colleague may not check in someone', rls_test.arrive('a_staff', 'a_manager'), -1);

-- One row per person per gig: a second tap (two slots, one person) can't make a second row.
SELECT rls_test.expect('first tap kept', rls_test.arrive_keep('a_staff', 'a_staff'), 1);
SELECT rls_test.expect('a second row for the same person and gig is refused', rls_test.arrive('a_staff', 'a_staff'), -1);
SELECT rls_test.expect('two slots, one row', rls_test.rows_of('a_staff'), 1);

-- ── Who sees what ──────────────────────────────────────────────────────────────────────────
SELECT rls_test.expect('b_staff checks in (kept)', rls_test.arrive_keep('b_staff', 'b_staff'), 1);
SELECT rls_test.expect('crew see their own only', rls_test.visible(rls_test.u('a_staff'), 'gig_crew_arrivals'), 1);
SELECT rls_test.expect('another crew member sees only their own', rls_test.visible(rls_test.u('b_staff'), 'gig_crew_arrivals'), 1);
SELECT rls_test.expect('the staffing org''s Manager sees its crew''s', rls_test.visible(rls_test.u('b_manager'), 'gig_crew_arrivals'), 1);
SELECT rls_test.expect('the gig owner''s Admin sees all crew, including the other org''s', rls_test.visible(rls_test.u('a_admin'), 'gig_crew_arrivals'), 2);
SELECT rls_test.expect('the gig owner''s Manager does too', rls_test.visible(rls_test.u('a_manager'), 'gig_crew_arrivals'), 2);
SELECT rls_test.expect('Staff and Viewer members of the owner see only their own', rls_test.visible(rls_test.u('a_viewer'), 'gig_crew_arrivals'), 0);
SELECT rls_test.expect('an unrelated org sees nothing', rls_test.visible(rls_test.u('c_admin'), 'gig_crew_arrivals'), 0);
SELECT rls_test.expect('signed out: refused', rls_test.try_anon('SELECT * FROM gig_crew_arrivals'), -1);

-- ── A person undoes or changes their own ───────────────────────────────────────────────────
SELECT rls_test.expect('own time changed', rls_test.try(rls_test.u('a_staff'), $$UPDATE gig_crew_arrivals SET arrived_at = now() - interval '1 hour' WHERE user_id = rls_test.u('a_staff')$$), 1);
SELECT rls_test.expect('own time undone', rls_test.try(rls_test.u('a_staff'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('a_staff')$$), 1);
SELECT rls_test.expect('the person and gig on a row cannot be changed', rls_test.try(rls_test.u('a_staff'), format($q$UPDATE gig_crew_arrivals SET user_id = %L WHERE user_id = %L$q$, rls_test.u('b_staff'), rls_test.u('a_staff'))), -1);
SELECT rls_test.expect('a person cannot change another''s', rls_test.try(rls_test.u('a_staff'), $$UPDATE gig_crew_arrivals SET arrived_at = now() WHERE user_id = rls_test.u('b_staff')$$), 0);
SELECT rls_test.expect('a person cannot undo another''s', rls_test.try(rls_test.u('a_staff'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff')$$), 0);

-- ── The staffing organization's Admins and Managers ────────────────────────────────────────
SELECT rls_test.expect('staffing Manager corrects (kept)', rls_test.try(rls_test.u('b_manager'), $$UPDATE gig_crew_arrivals SET arrived_at = now() - interval '2 hours' WHERE user_id = rls_test.u('b_staff')$$), 1);
SELECT rls_test.expect('staffing Admin clears', rls_test.try(rls_test.u('b_admin'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff')$$), 1);
-- (the checks above were rolled back; start these from no row for b_staff)
DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff');
SELECT rls_test.expect('staffing Manager checks in their crew', rls_test.arrive('b_manager', 'b_staff'), 1);
SELECT rls_test.expect('staffing Admin checks in their crew', rls_test.arrive('b_admin', 'b_staff'), 1);
SELECT rls_test.expect('a Viewer of the staffing org may not', rls_test.arrive('b_viewer', 'b_staff'), -1);
SELECT rls_test.expect('a Staff member of the staffing org may not', rls_test.arrive('a_staff', 'a_manager'), -1);
SELECT rls_test.expect('not for someone who is not on their slots', rls_test.arrive('b_manager', 'a_staff'), -1);
SELECT rls_test.expect('not for a Declined assignment', rls_test.arrive('b_manager', 'b_viewer'), -1);
SELECT rls_test.expect('outside the window, a Manager cannot check in either', rls_test.arrive('b_manager', 'b_staff', $$now() + interval '17 hours'$$), -1);

-- ── The gig owner's Admins and Managers, for crew from another organization ────────────────
SELECT rls_test.expect('owner Admin checks in another org''s crew', rls_test.arrive('a_admin', 'b_staff'), 1);
SELECT rls_test.expect('owner Manager checks in another org''s crew', rls_test.arrive('a_manager', 'b_staff'), 1);
SELECT rls_test.expect('owner Staff may not', rls_test.arrive('a_staff', 'b_staff'), -1);
SELECT rls_test.expect('owner Viewer may not', rls_test.arrive('a_viewer', 'b_staff'), -1);
SELECT rls_test.expect('an unrelated Admin may not', rls_test.arrive('c_admin', 'b_staff'), -1);

-- ── A correction by a Manager or Admin locks the person out ────────────────────────────────
SELECT rls_test.expect('Manager sets b_staff (kept)', rls_test.run('b_manager', format($q$INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at) VALUES (%L, %L, now()) ON CONFLICT (gig_id, user_id) DO UPDATE SET arrived_at = now()$q$, rls_test.u('gig'), rls_test.u('b_staff'))), 1);
SELECT rls_test.expect('the person cannot change a time a Manager set', rls_test.try(rls_test.u('b_staff'), $$UPDATE gig_crew_arrivals SET arrived_at = now() - interval '3 hours' WHERE user_id = rls_test.u('b_staff')$$), 0);
SELECT rls_test.expect('the person cannot undo it', rls_test.try(rls_test.u('b_staff'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff')$$), 0);
SELECT rls_test.expect('the recorded setter is the Manager, not whoever was named', (SELECT count(*)::int FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff') AND set_by = rls_test.u('b_manager')), 1);
-- A Manager who is also crew is treated as crew on their own row.
SELECT rls_test.expect('owner Admin sets the Manager-who-is-crew (kept)', rls_test.arrive_keep('a_admin', 'a_manager'), 1);
SELECT rls_test.expect('that Manager cannot undo their own row after a correction', rls_test.try(rls_test.u('a_manager'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('a_manager')$$), 0);
SELECT rls_test.expect('another Manager still can', rls_test.try(rls_test.u('a_admin'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('a_manager')$$), 1);
SELECT rls_test.expect('set_by cannot be forged on insert', rls_test.run('a_admin', format($q$INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at, set_by) VALUES (%L, %L, now(), %L) ON CONFLICT (gig_id, user_id) DO UPDATE SET arrived_at = now(), set_by = %L$q$, rls_test.u('gig'), rls_test.u('b_staff'), rls_test.u('b_staff'), rls_test.u('b_staff'))), 1);
SELECT rls_test.expect('set_by is the caller', (SELECT count(*)::int FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff') AND set_by = rls_test.u('a_admin')), 1);

-- ── The helpers answer only for the signed-in person ───────────────────────────────────────
CREATE FUNCTION rls_test.asks(p_actor text, p_call text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_actor), format('SELECT 1 WHERE %s', p_call))
$$;
CREATE FUNCTION rls_test.h_manages(p_actor text, p_target text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.asks(p_actor, format('public.manages_gig_arrivals(%L, %L)', rls_test.u('gig'), rls_test.u(p_target)))
$$;
CREATE FUNCTION rls_test.h_holds(p_actor text, p_target text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.asks(p_actor, format('public.holds_checkin_assignment(%L, %L)', rls_test.u('gig'), rls_test.u(p_target)))
$$;
SELECT rls_test.expect('an unrelated person asking about others gets no', rls_test.h_manages('c_staff', 'b_staff'), 0);
SELECT rls_test.expect('an unrelated person asking about an assignment gets no', rls_test.h_holds('c_staff', 'a_staff'), 0);
SELECT rls_test.expect('an unrelated person asking about a gig time gets no', rls_test.asks('c_staff', format('public.gig_arrival_time_ok(%L, now())', rls_test.u('gig'))), 0);
SELECT rls_test.expect('an unrelated Admin gets no either', rls_test.h_manages('c_admin', 'b_staff'), 0);
SELECT rls_test.expect('a helper cannot be asked on behalf of another person', rls_test.try(rls_test.u('c_staff'), format('SELECT 1 WHERE public.manages_gig_arrivals(%L, %L, %L)', rls_test.u('gig'), rls_test.u('b_staff'), rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('signed out: refused', rls_test.try_anon(format('SELECT public.holds_checkin_assignment(%L, %L)', rls_test.u('gig'), rls_test.u('a_staff'))), -1);
SELECT rls_test.expect('a person asking about themselves gets yes', rls_test.h_holds('a_staff', 'a_staff'), 1);
SELECT rls_test.expect('a person asking about someone else''s assignment gets no', rls_test.h_holds('a_staff', 'b_staff'), 0);
SELECT rls_test.expect('the gig owner Admin gets yes for crew from another organization', rls_test.h_manages('a_admin', 'b_staff'), 1);
SELECT rls_test.expect('and for their assignment', rls_test.h_holds('a_admin', 'b_staff'), 1);
SELECT rls_test.expect('the staffing Manager gets yes for their crew', rls_test.h_manages('b_manager', 'b_staff'), 1);
SELECT rls_test.expect('and no for someone not on their slots', rls_test.h_manages('b_manager', 'a_staff'), 0);
SELECT rls_test.expect('a participant can ask about the gig time', rls_test.asks('a_staff', format('public.gig_arrival_time_ok(%L, now())', rls_test.u('gig'))), 1);
SELECT rls_test.expect('the time answer follows the window', rls_test.asks('a_staff', format($q$public.gig_arrival_time_ok(%L, now() + interval '17 hours')$q$, rls_test.u('gig'))), 0);

-- ── Clearing works after the person's assignment changed; deleting the gig removes the rows ─
UPDATE gig_staff_assignments SET status = 'Declined' WHERE user_id = rls_test.u('b_staff');
SELECT rls_test.expect('a Manager can still clear after the assignment was declined', rls_test.try(rls_test.u('b_manager'), $$DELETE FROM gig_crew_arrivals WHERE user_id = rls_test.u('b_staff')$$), 1);
DELETE FROM gigs WHERE id = rls_test.u('gig');
SELECT rls_test.expect('deleting the gig removes its arrival rows', (SELECT count(*)::int FROM gig_crew_arrivals), 0);
