-- The gig's crew roster (#466): Admins and Managers of any organization on the gig see everyone on it.
-- Written before the migration. Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
--
-- Fixture: org A owns the gig; org B takes part (Sound); org C is unrelated until a check adds it.
--   a_staff   Confirmed (org A slot)      a_viewer  Requested (org A slot)    a_manager  Declined (org A slot)
--   b_staff   Confirmed (org B slot)
-- Pay is set on the assignments so a check can see it is never returned.
UPDATE public.users SET phone = '555-0101' WHERE id = rls_test.u('a_staff');
UPDATE public.users SET phone = '555-0102' WHERE id = rls_test.u('b_staff');
INSERT INTO gig_staff_slots (id, gig_id, staff_role_id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000066a1', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a')),
  ('00000000-0000-0000-0000-0000000066b1', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_b'));
INSERT INTO gig_staff_assignments (slot_id, user_id, status, fee, rate, notes) VALUES
  ('00000000-0000-0000-0000-0000000066a1', rls_test.u('a_staff'),   'Confirmed', 111, 22, 'private note a'),
  ('00000000-0000-0000-0000-0000000066a1', rls_test.u('a_viewer'),  'Requested', 333, 44, 'private note v'),
  ('00000000-0000-0000-0000-0000000066a1', rls_test.u('a_manager'), 'Declined',  555, 66, 'private note m'),
  ('00000000-0000-0000-0000-0000000066b1', rls_test.u('b_staff'),   'Confirmed', 777, 88, 'private note b');
SELECT set_config('request.jwt.claim.sub', '', true); -- the arrival rows below are written as the table owner
INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at, set_by) VALUES
  (rls_test.u('gig'), rls_test.u('a_staff'), now(), rls_test.u('a_staff')),
  (rls_test.u('gig'), rls_test.u('b_staff'), now(), rls_test.u('b_staff'));
-- The statements below name people with rls_test.u(...).
GRANT USAGE ON SCHEMA rls_test TO authenticated;
GRANT SELECT ON rls_test.ids TO authenticated;
GRANT EXECUTE ON FUNCTION rls_test.u(text) TO authenticated;

CREATE FUNCTION rls_test.roster(p_actor text, p_where text DEFAULT 'true') RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.visible(rls_test.u(p_actor), format('public.gig_crew_roster(%L)', rls_test.u('gig')), p_where)
$$;

-- ── Who gets the roster ────────────────────────────────────────────────────────────────────
SELECT rls_test.expect('the owner Admin sees every non-declined crew member, from both organizations', rls_test.roster('a_admin'), 3);
SELECT rls_test.expect('the owner Manager does too', rls_test.roster('a_manager'), 3);
SELECT rls_test.expect('an Admin of another organization on the gig sees them all, including the owner''s crew', rls_test.roster('b_admin'), 3);
SELECT rls_test.expect('and its Manager', rls_test.roster('b_manager'), 3);
SELECT rls_test.expect('Staff members get nothing', rls_test.roster('a_staff'), 0);
SELECT rls_test.expect('Viewer members get nothing', rls_test.roster('a_viewer'), 0);
SELECT rls_test.expect('crew on the other organization get nothing', rls_test.roster('b_staff'), 0);
SELECT rls_test.expect('an Admin of an organization not on the gig gets nothing', rls_test.roster('c_admin'), 0);
SELECT rls_test.expect('signed out: refused', rls_test.try_anon(format('SELECT * FROM public.gig_crew_roster(%L)', rls_test.u('gig'))), -1);
SELECT rls_test.expect('another gig: nothing', rls_test.visible(rls_test.u('a_admin'), format('public.gig_crew_roster(%L)', '00000000-0000-0000-0000-00000000dead')), 0);

-- ── What they get ──────────────────────────────────────────────────────────────────────────
SELECT rls_test.expect('Declined is not listed', rls_test.roster('a_admin', format('user_id = %L', rls_test.u('a_manager'))), 0);
SELECT rls_test.expect('Requested is listed, with its status', rls_test.roster('a_admin', format($q$user_id = %L AND status = 'Requested'$q$, rls_test.u('a_viewer'))), 1);
SELECT rls_test.expect('the other organization''s crew carry name, role, status and organization', rls_test.roster('a_admin', format($q$user_id = %L AND first_name IS NOT NULL AND role_name IS NOT NULL AND status = 'Confirmed' AND organization_id = %L AND organization_name = 'Org B'$q$, rls_test.u('b_staff'), rls_test.u('org_b'))), 1);
SELECT rls_test.expect('with phone and email', rls_test.roster('a_admin', format($q$user_id = %L AND phone = '555-0102' AND email IS NOT NULL$q$, rls_test.u('b_staff'))), 1);
SELECT rls_test.expect('and the other way round', rls_test.roster('b_admin', format($q$user_id = %L AND phone = '555-0101' AND email IS NOT NULL$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('and their arrived time', rls_test.roster('b_admin', format('user_id = %L AND arrived_at IS NOT NULL', rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('no rate, fee, notes or units are in what it returns', (pg_get_function_result('public.gig_crew_roster(uuid)'::regprocedure) !~* '(fee|rate|notes|units|financial)')::int, 1);

-- ── Arrival times: who reads them, and that writing is unchanged ───────────────────────────
SELECT rls_test.expect('an unrelated Admin reads no arrival', rls_test.visible(rls_test.u('c_admin'), 'gig_crew_arrivals'), 0);
INSERT INTO gig_participants (gig_id, organization_id, role) VALUES (rls_test.u('gig'), rls_test.u('org_c'), 'Lighting');
SELECT rls_test.expect('an Admin of a third organization on the gig sees everyone', rls_test.roster('c_admin'), 3);
SELECT rls_test.expect('and reads their arrival times', rls_test.visible(rls_test.u('c_admin'), 'gig_crew_arrivals'), 2);
SELECT rls_test.expect('its Manager too', rls_test.visible(rls_test.u('c_manager'), 'gig_crew_arrivals'), 2);
SELECT rls_test.expect('its Staff and Viewer do not', rls_test.visible(rls_test.u('c_staff'), 'gig_crew_arrivals') + rls_test.visible(rls_test.u('c_viewer'), 'gig_crew_arrivals'), 0);
SELECT rls_test.expect('but cannot change another organization''s crew arrival', rls_test.try(rls_test.u('c_admin'), format($q$UPDATE gig_crew_arrivals SET arrived_at = now() - interval '1 hour' WHERE user_id = %L$q$, rls_test.u('b_staff'))), 0);
SELECT rls_test.expect('or clear it', rls_test.try(rls_test.u('c_admin'), format('DELETE FROM gig_crew_arrivals WHERE user_id = %L', rls_test.u('b_staff'))), 0);
SELECT rls_test.expect('or record one', rls_test.try(rls_test.u('c_admin'), format($q$INSERT INTO gig_crew_arrivals (gig_id, user_id, arrived_at) VALUES (%L, %L, now())$q$, rls_test.u('gig'), rls_test.u('a_viewer'))), -1);
SELECT rls_test.expect('the staffing organization''s Manager still can', rls_test.try(rls_test.u('b_manager'), format('DELETE FROM gig_crew_arrivals WHERE user_id = %L', rls_test.u('b_staff'))), 1);
SELECT rls_test.expect('and the owner''s Admin', rls_test.try(rls_test.u('a_admin'), format('DELETE FROM gig_crew_arrivals WHERE user_id = %L', rls_test.u('b_staff'))), 1);

-- ── An organization marked Inactive on the gig ─────────────────────────────────────────────
-- (The app releases an organization's staff before it can be marked Inactive; the triggers are
-- skipped here to check the roster against the state anyway.)
SET LOCAL session_replication_role = replica;
UPDATE gig_participants SET inactive = true WHERE gig_id = rls_test.u('gig') AND organization_id = rls_test.u('org_b');
SET LOCAL session_replication_role = origin;
SELECT rls_test.expect('an Inactive organization''s Admin gets nothing', rls_test.roster('b_admin'), 0);
SELECT rls_test.expect('its crew are not listed to the others (2 left)', rls_test.roster('a_admin'), 2);
SELECT rls_test.expect('nor are their arrival times read through the roster rule', rls_test.visible(rls_test.u('c_admin'), 'gig_crew_arrivals', format('user_id = %L', rls_test.u('b_staff'))), 0);
SET LOCAL session_replication_role = replica;
UPDATE gig_participants SET inactive = true WHERE gig_id = rls_test.u('gig') AND organization_id = rls_test.u('org_c');
SET LOCAL session_replication_role = origin;
SELECT rls_test.expect('an Inactive third organization sees nothing', rls_test.roster('c_admin'), 0);
