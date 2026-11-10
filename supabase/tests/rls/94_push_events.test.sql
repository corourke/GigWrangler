-- Push notifications (plan approved 11-10), part 4: the events that notify people.
-- * Asked to work a gig: the person asked. Their reply: the slot organization's Admins and Managers.
-- * A gig's date, time or venue changes, or it is cancelled: its assigned staff, once per gig after
--   two quiet minutes (at most 15), never the person who made the change.
-- * Payments due today or overdue: each organization's Admins, once a day, never twice per line.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
CREATE FUNCTION rls_test.exec(p_user text, p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN n;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RAISE NOTICE '% failed: %', p_user, SQLERRM;
    RETURN -1;
  END;
END $$;
CREATE FUNCTION rls_test.notes(p_user text, p_type text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.notifications WHERE recipient_id = rls_test.u(p_user) AND type = p_type
$$;
CREATE FUNCTION rls_test.note(p_user text, p_type text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT payload FROM public.notifications WHERE recipient_id = rls_test.u(p_user) AND type = p_type
  ORDER BY created_at DESC LIMIT 1
$$;
CREATE FUNCTION rls_test.all_notes(p_type text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.notifications WHERE type = p_type
$$;

-- The gig is next week; org A has a slot on it.
UPDATE gigs SET start = date_trunc('day', now()) + interval '7 days 18 hours',
                "end" = date_trunc('day', now()) + interval '7 days 23 hours',
                status = 'Booked'
WHERE id = rls_test.u('gig');
INSERT INTO rls_test.ids VALUES ('slot', '00000000-0000-0000-0000-0000000005a1'), ('venue', '00000000-0000-0000-0000-0000000005b1');
INSERT INTO gig_staff_slots (id, gig_id, staff_role_id, organization_id)
VALUES (rls_test.u('slot'), rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a'));
INSERT INTO organizations (id, name, roles) VALUES (rls_test.u('venue'), 'The Venue', '{Venue}');

-- 1. Asked to work a gig ------------------------------------------------------------------------
SELECT rls_test.expect('a Manager asks someone to work the gig', rls_test.exec('a_manager', format(
  $q$INSERT INTO gig_staff_assignments (slot_id, user_id, status) VALUES (%L, %L, 'Requested')$q$, rls_test.u('slot'), rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('... the person asked is notified', rls_test.notes('a_staff', 'assignment.requested'), 1);
SELECT rls_test.expect('... with the gig and role', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('a_staff') AND type = 'assignment.requested'
    AND payload->>'gig_id' = rls_test.u('gig')::text AND payload->>'gig_title' = 'Shared gig'
    AND payload->>'role_name' = 'RLS test role' AND payload->>'organization_id' = rls_test.u('org_a')::text
    AND payload->>'gig_date' <> '' AND payload ? 'assignment_id'), 1);
SELECT rls_test.expect('... nobody else is', rls_test.all_notes('assignment.requested'), 1);
SELECT rls_test.expect('assigning yourself', rls_test.exec('a_manager', format(
  $q$INSERT INTO gig_staff_assignments (slot_id, user_id, status) VALUES (%L, %L, 'Requested')$q$, rls_test.u('slot'), rls_test.u('a_manager'))), 1);
SELECT rls_test.expect('... notifies nobody', rls_test.all_notes('assignment.requested'), 1);
UPDATE users SET user_status = 'pending' WHERE id = rls_test.u('a_viewer');
SELECT rls_test.expect('asking someone without a sign-in', rls_test.exec('a_manager', format(
  $q$INSERT INTO gig_staff_assignments (slot_id, user_id, status) VALUES (%L, %L, 'Requested')$q$, rls_test.u('slot'), rls_test.u('a_viewer'))), 1);
SELECT rls_test.expect('... notifies nobody', rls_test.all_notes('assignment.requested'), 1);
UPDATE users SET user_status = 'active' WHERE id = rls_test.u('a_viewer');
DELETE FROM gig_staff_assignments WHERE user_id = rls_test.u('a_viewer');

-- 2. The reply ---------------------------------------------------------------------------------
SELECT rls_test.expect('the person accepts', rls_test.exec('a_staff', format(
  $q$UPDATE gig_staff_assignments SET status = 'Confirmed', confirmed_at = now() WHERE user_id = %L$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('... the slot organization''s Admin is told', rls_test.notes('a_admin', 'assignment.accepted'), 1);
SELECT rls_test.expect('... and its Manager', rls_test.notes('a_manager', 'assignment.accepted'), 1);
SELECT rls_test.expect('... not the person who replied', rls_test.notes('a_staff', 'assignment.accepted'), 0);
SELECT rls_test.expect('... nor another organization', rls_test.notes('b_admin', 'assignment.accepted'), 0);
SELECT rls_test.expect('... with their first name and the role', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('a_admin') AND type = 'assignment.accepted'
    AND payload->>'first_name' = 'a_staff' AND payload->>'role_name' = 'RLS test role'
    AND payload->>'gig_title' = 'Shared gig' AND payload->>'organization_id' = rls_test.u('org_a')::text), 1);
SELECT rls_test.expect('an Admin changing someone''s status', rls_test.exec('a_admin', format(
  $q$UPDATE gig_staff_assignments SET status = 'Declined' WHERE user_id = %L$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('... is not a reply', rls_test.all_notes('assignment.declined'), 0);
SELECT rls_test.expect('asking again someone who declined', rls_test.exec('a_manager', format(
  $q$UPDATE gig_staff_assignments SET status = 'Requested' WHERE user_id = %L$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('... notifies them again', rls_test.notes('a_staff', 'assignment.requested'), 2);
SELECT rls_test.expect('the person declines', rls_test.exec('a_staff', format(
  $q$UPDATE gig_staff_assignments SET status = 'Declined' WHERE user_id = %L$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('... the Admin and Manager are told', rls_test.all_notes('assignment.declined'), 2);
UPDATE gig_staff_assignments SET status = 'Confirmed' WHERE slot_id = rls_test.u('slot');
SELECT rls_test.expect('a change made without a person (the server) is no reply', rls_test.all_notes('assignment.accepted'), 2);

-- 3. Gig changes, batched ----------------------------------------------------------------------
-- Assigned (Confirmed): a_staff and a_manager.
CREATE FUNCTION rls_test.changed(p_user text, p_kinds jsonb) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u(p_user) AND type = 'gig.changed' AND payload->'kinds' = p_kinds
$$;
SELECT rls_test.expect('the Admin moves the gig a day', rls_test.exec('a_admin', format(
  $q$UPDATE gigs SET start = start + interval '1 day', "end" = "end" + interval '1 day' WHERE id = %L$q$, rls_test.u('gig'))), 1);
SELECT rls_test.expect('... nothing yet', rls_test.all_notes('gig.changed'), 0);
SELECT rls_test.expect('... nor before two quiet minutes', public.flush_gig_change_batches(now() + interval '1 minute'), 0);
SELECT rls_test.expect('the Manager adds a venue', rls_test.exec('a_manager', format(
  $q$INSERT INTO gig_participants (gig_id, organization_id, role) VALUES (%L, %L, 'Venue')$q$, rls_test.u('gig'), rls_test.u('venue'))), 1);
SELECT rls_test.expect('after two quiet minutes, one notification for the staff who made no change',
  public.flush_gig_change_batches(now() + interval '3 minutes'), 1);
SELECT rls_test.expect('... saying the date and venue changed', rls_test.changed('a_staff', '["date", "venue"]'), 1);
SELECT rls_test.expect('... with the gig', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('a_staff') AND type = 'gig.changed'
    AND payload->>'gig_title' = 'Shared gig' AND payload->>'gig_id' = rls_test.u('gig')::text), 1);
SELECT rls_test.expect('... not the Manager who changed the venue, though assigned', rls_test.notes('a_manager', 'gig.changed'), 0);
SELECT rls_test.expect('... nothing left to send', public.flush_gig_change_batches(now() + interval '10 minutes'), 0);

SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET start = start + interval '1 hour' WHERE id = %L$q$, rls_test.u('gig')));
SELECT rls_test.expect('a new time on the same day goes to both', public.flush_gig_change_batches(now() + interval '3 minutes'), 2);
SELECT rls_test.expect('... and says the time changed', rls_test.changed('a_staff', '["time"]'), 1);

SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET notes = 'Load in by the side door' WHERE id = %L$q$, rls_test.u('gig')));
SELECT rls_test.expect('other edits are not changes', (SELECT count(*)::int FROM public.gig_change_batches), 0);

SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET start = start + interval '1 hour' WHERE id = %L$q$, rls_test.u('gig')));
UPDATE public.gig_change_batches SET first_at = now() - interval '16 minutes', last_at = now();
SELECT rls_test.expect('changes that keep coming are sent after 15 minutes', public.flush_gig_change_batches(now()), 2);

SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET status = 'Cancelled' WHERE id = %L$q$, rls_test.u('gig')));
SELECT rls_test.expect('a cancellation goes to both', public.flush_gig_change_batches(now() + interval '3 minutes'), 2);
SELECT rls_test.expect('... and says so', rls_test.changed('a_staff', '["cancelled"]'), 1);
UPDATE gigs SET status = 'Booked' WHERE id = rls_test.u('gig');
DELETE FROM public.gig_change_batches;

SELECT rls_test.exec('a_admin', format($q$DELETE FROM gig_participants WHERE gig_id = %L AND role = 'Venue'$q$, rls_test.u('gig')));
SELECT rls_test.expect('removing the venue goes to both', public.flush_gig_change_batches(now() + interval '3 minutes'), 2);
SELECT rls_test.expect('... as a venue change', rls_test.changed('a_staff', '["venue"]'), 1);

UPDATE gig_staff_assignments SET status = 'Declined' WHERE user_id = rls_test.u('a_staff');
SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET start = start + interval '1 day', "end" = "end" + interval '1 day' WHERE id = %L$q$, rls_test.u('gig')));
SELECT rls_test.expect('staff who declined are not told', public.flush_gig_change_batches(now() + interval '3 minutes'), 1);
SELECT rls_test.expect('... only the Manager', rls_test.changed('a_manager', '["date"]'), 1);
UPDATE gig_staff_assignments SET status = 'Confirmed' WHERE user_id = rls_test.u('a_staff');

UPDATE gigs SET start = now() - interval '3 days', "end" = now() - interval '2 days' WHERE id = rls_test.u('gig');
DELETE FROM public.gig_change_batches;
SELECT rls_test.exec('a_admin', format($q$UPDATE gigs SET start = start + interval '1 hour' WHERE id = %L$q$, rls_test.u('gig')));
SELECT rls_test.expect('changing a gig that is over tells nobody', (SELECT count(*)::int FROM public.gig_change_batches), 0);
SELECT rls_test.expect('signed-in people cannot read the batches', rls_test.visible(rls_test.u('a_admin'), 'public.gig_change_batches'), 0);

-- 4. Payments ------------------------------------------------------------------------------------
-- Org A's books: one due today (money in), one overdue since yesterday (money out), and ones that
-- don't count: paid, due tomorrow, no due date, overdue for weeks, a quote.
CREATE FUNCTION rls_test.line(p_due date, p_direction fin_direction, p_stage fin_stage, p_org text DEFAULT 'org_a') RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO gig_financials (gig_id, organization_id, amount, date, created_by, direction, stage, due_date, paid_at, amount_settled)
  VALUES (rls_test.u('gig'), rls_test.u(p_org), 100, current_date, rls_test.u('a_admin'), p_direction, p_stage, p_due,
          CASE WHEN p_stage = 'paid' THEN now() END, CASE WHEN p_stage = 'paid' THEN 100 END)
  RETURNING id
$$;
INSERT INTO rls_test.ids SELECT 'due_today', rls_test.line(current_date, 'in', 'invoiced');
INSERT INTO rls_test.ids SELECT 'overdue', rls_test.line(current_date - 1, 'out', 'contracted');
SELECT rls_test.line(current_date, 'in', 'paid');
SELECT rls_test.line(current_date + 1, 'in', 'invoiced');
SELECT rls_test.line(NULL, 'in', 'invoiced');
SELECT rls_test.line(current_date - 30, 'out', 'invoiced');
SELECT rls_test.line(current_date, 'in', 'quoted');
SELECT rls_test.line(current_date, 'in', 'invoiced', 'org_c');

CREATE FUNCTION rls_test.payments(p_user text) RETURNS int LANGUAGE sql STABLE AS $$ SELECT rls_test.notes(p_user, 'payment.reminder') $$;
SELECT rls_test.expect('the daily run sends one notification per organization Admin', public.send_payment_reminders(current_date), 2);
SELECT rls_test.expect('... to org A''s Admin', rls_test.payments('a_admin'), 1);
SELECT rls_test.expect('... and org C''s', rls_test.payments('c_admin'), 1);
SELECT rls_test.expect('... not Managers', rls_test.payments('a_manager'), 0);
SELECT rls_test.expect('... counting one due today and one overdue', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('a_admin') AND type = 'payment.reminder'
    AND payload @> jsonb_build_object('due_count', 1, 'overdue_count', 1, 'organization_id', rls_test.u('org_a'), 'organization_name', 'Org A')), 1);
SELECT rls_test.expect('running again the same day sends nothing', public.send_payment_reminders(current_date), 0);
-- The next day: org A's line due then is due, today's is overdue, yesterday's was already sent;
-- org C's line is overdue.
SELECT rls_test.expect('the next day', public.send_payment_reminders(current_date + 1), 2);
SELECT rls_test.expect('... org A: one due, one newly overdue', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('a_admin') AND type = 'payment.reminder'
    AND payload @> '{"due_count": 1, "overdue_count": 1}'), 2);
SELECT rls_test.expect('... org C: overdue', (SELECT count(*)::int FROM public.notifications
  WHERE recipient_id = rls_test.u('c_admin') AND type = 'payment.reminder'
    AND payload @> '{"due_count": 0, "overdue_count": 1}'), 1);
UPDATE gig_financials SET due_date = current_date + 5 WHERE id = rls_test.u('due_today');
SELECT rls_test.expect('a new due date is reminded again on that day', public.send_payment_reminders(current_date + 5), 1);
SELECT rls_test.expect('nothing to remind: no notification', public.send_payment_reminders(current_date + 60), 0);
SELECT rls_test.expect('signed-in people cannot read the reminder ledger', rls_test.visible(rls_test.u('a_admin'), 'public.payment_reminders'), 0);
SELECT rls_test.expect('signed-in people cannot run the jobs', rls_test.exec('a_admin', 'SELECT public.send_payment_reminders(current_date)'), -1);
SELECT rls_test.expect('... either of them', rls_test.exec('a_admin', 'SELECT public.flush_gig_change_batches(now())'), -1);
