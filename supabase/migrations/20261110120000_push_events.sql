-- Push notifications (plan approved by Cameron, 11-10), part 4: the events that notify people.
-- Each one adds a row to notifications (the bell); a push follows where the person has a device
-- and the switch on (part 2).
--
-- * assignment.requested: someone is asked to work a gig. To that person (not when they assigned
--   themselves, nor someone without a sign-in).
-- * assignment.accepted / assignment.declined: the person replies. To the Admins and Managers of the
--   slot's organization, never the person who replied. A status set by someone else isn't a reply.
-- * gig.changed: a gig's date, time or venue changes, or it is cancelled. To its assigned staff
--   (Requested or Confirmed), never someone who made the change. Changes are gathered per gig and
--   sent once things are quiet for two minutes, or after 15 minutes at most (a job every minute).
--   Gigs that are over are left alone.
-- * payment.reminder: lines in either direction, unpaid, with a due date: once on the due date and
--   once overdue (up to a week late). One notification per organization Admin per day with the
--   counts. payment_reminders records what was sent, so nothing goes twice for a line and its
--   due date; a new due date is reminded again. A job at 15:00 UTC every day.
--
-- Access requests already notify their deciders (server/routes/accessRequests.ts).

-- People who can receive a notification: signed up and active.
CREATE OR REPLACE FUNCTION public.push_recipient_active(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND coalesce(user_status, 'active') = 'active')
$$;

-- The calendar day a gig starts or ends on, where it happens (all-day gigs are stored at 12:00 UTC).
CREATE OR REPLACE FUNCTION public.gig_local_day(p_at timestamptz, p_timezone text, p_all_day boolean) RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (CASE WHEN p_all_day THEN p_at AT TIME ZONE 'UTC' ELSE p_at AT TIME ZONE coalesce(p_timezone, 'UTC') END)::date
$$;

-- 1. Asked to work a gig, and the reply -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_staff_assignment_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_gig record;
  v_payload jsonb;
BEGIN
  SELECT g.id, g.title, g."end", s.organization_id, r.name AS role_name,
         to_char(CASE WHEN g.all_day THEN g.start AT TIME ZONE 'UTC' ELSE g.start AT TIME ZONE g.timezone END, 'Dy DD Mon') AS gig_date
    INTO v_gig
    FROM public.gig_staff_slots s
    JOIN public.gigs g ON g.id = s.gig_id
    LEFT JOIN public.staff_roles r ON r.id = s.staff_role_id
   WHERE s.id = NEW.slot_id;
  IF NOT FOUND OR v_gig."end" < now() THEN
    RETURN NULL;
  END IF;
  v_payload := jsonb_build_object('assignment_id', NEW.id, 'gig_id', v_gig.id, 'gig_title', v_gig.title,
                                  'role_name', v_gig.role_name, 'organization_id', v_gig.organization_id);

  IF NEW.status IN ('Requested', 'Invited')
     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('Requested', 'Invited') OR OLD.user_id IS DISTINCT FROM NEW.user_id)
     AND NEW.user_id IS DISTINCT FROM v_actor
     AND public.push_recipient_active(NEW.user_id) THEN
    INSERT INTO public.notifications (recipient_id, type, payload)
    VALUES (NEW.user_id, 'assignment.requested', v_payload || jsonb_build_object('gig_date', v_gig.gig_date));
  END IF;

  IF TG_OP = 'UPDATE' AND v_actor IS NOT NULL AND v_actor = NEW.user_id
     AND NEW.status IN ('Confirmed', 'Declined') AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (recipient_id, type, payload)
    SELECT m.user_id,
           CASE NEW.status WHEN 'Confirmed' THEN 'assignment.accepted' ELSE 'assignment.declined' END,
           v_payload || jsonb_build_object('first_name', (SELECT first_name FROM public.users WHERE id = NEW.user_id))
      FROM public.organization_members m
     WHERE m.organization_id = v_gig.organization_id
       AND m.role IN ('Admin', 'Manager')
       AND m.user_id <> NEW.user_id
       AND public.push_recipient_active(m.user_id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER gig_staff_assignments_notify
  AFTER INSERT OR UPDATE OF status, user_id ON public.gig_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_staff_assignment_event();

-- 2. Gig changes, gathered per gig ----------------------------------------------------------
CREATE TABLE public.gig_change_batches (
  gig_id uuid PRIMARY KEY REFERENCES public.gigs(id) ON DELETE CASCADE,
  kinds text[] NOT NULL,
  actor_ids uuid[] NOT NULL DEFAULT '{}',
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gig_change_batches IS
  'Gig changes waiting to be sent to the gig''s staff: what changed (date, time, venue, cancelled) and who changed it. Emptied by flush_gig_change_batches.';
ALTER TABLE public.gig_change_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_change_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gig_change_batches TO service_role;
-- Every table with row-level security carries the two-factor rule (migration 20261107110000).
CREATE POLICY "Two-factor sign-in when required" ON public.gig_change_batches
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

CREATE OR REPLACE FUNCTION public.queue_gig_change(p_gig_id uuid, p_kinds text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.gig_change_batches AS b (gig_id, kinds, actor_ids)
  VALUES (p_gig_id, p_kinds, CASE WHEN auth.uid() IS NULL THEN '{}'::uuid[] ELSE ARRAY[auth.uid()] END)
  ON CONFLICT (gig_id) DO UPDATE
    SET kinds = ARRAY(SELECT DISTINCT unnest(b.kinds || EXCLUDED.kinds)),
        actor_ids = ARRAY(SELECT DISTINCT unnest(b.actor_ids || EXCLUDED.actor_ids)),
        last_at = now()
$$;

CREATE OR REPLACE FUNCTION public.notify_gig_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kinds text[] := '{}';
BEGIN
  IF NEW."end" < now() AND OLD."end" < now() THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    v_kinds := v_kinds || 'cancelled'::text;
  END IF;
  IF public.gig_local_day(OLD.start, OLD.timezone, OLD.all_day) IS DISTINCT FROM public.gig_local_day(NEW.start, NEW.timezone, NEW.all_day)
     OR public.gig_local_day(OLD."end", OLD.timezone, OLD.all_day) IS DISTINCT FROM public.gig_local_day(NEW."end", NEW.timezone, NEW.all_day) THEN
    v_kinds := v_kinds || 'date'::text;
  ELSIF (OLD.start, OLD."end", OLD.timezone, OLD.all_day) IS DISTINCT FROM (NEW.start, NEW."end", NEW.timezone, NEW.all_day) THEN
    v_kinds := v_kinds || 'time'::text;
  END IF;
  IF cardinality(v_kinds) > 0 THEN
    PERFORM public.queue_gig_change(NEW.id, v_kinds);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER gigs_notify_change
  AFTER UPDATE OF start, "end", timezone, all_day, status ON public.gigs
  FOR EACH ROW EXECUTE FUNCTION public.notify_gig_change();

CREATE OR REPLACE FUNCTION public.notify_gig_venue_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gig_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.role = 'Venue' OR NEW.role = 'Venue')
       OR (OLD.organization_id, OLD.role, OLD.inactive, OLD.gig_id) IS NOT DISTINCT FROM (NEW.organization_id, NEW.role, NEW.inactive, NEW.gig_id) THEN
      RETURN NULL;
    END IF;
    v_gig_id := NEW.gig_id;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'Venue' THEN RETURN NULL; END IF;
    v_gig_id := NEW.gig_id;
  ELSE
    IF OLD.role <> 'Venue' THEN RETURN NULL; END IF;
    v_gig_id := OLD.gig_id;
  END IF;
  -- A gig being deleted takes its venue with it: nothing to tell.
  IF EXISTS (SELECT 1 FROM public.gigs WHERE id = v_gig_id AND "end" >= now()) THEN
    PERFORM public.queue_gig_change(v_gig_id, ARRAY['venue']);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER gig_participants_notify_venue
  AFTER INSERT OR UPDATE OR DELETE ON public.gig_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_gig_venue_change();

-- Sends the batches that have been quiet for two minutes, or waiting 15. Returns the number of
-- notifications added.
CREATE OR REPLACE FUNCTION public.flush_gig_change_batches(p_now timestamptz DEFAULT now()) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int := 0;
  v_rows int;
  b record;
BEGIN
  FOR b IN
    DELETE FROM public.gig_change_batches
     WHERE last_at <= p_now - interval '2 minutes' OR first_at <= p_now - interval '15 minutes'
    RETURNING *
  LOOP
    INSERT INTO public.notifications (recipient_id, type, payload)
    SELECT staff.user_id, 'gig.changed',
           jsonb_build_object(
             'gig_id', g.id, 'gig_title', g.title, 'organization_id', staff.organization_id,
             'kinds', (SELECT jsonb_agg(k ORDER BY array_position(ARRAY['cancelled', 'date', 'time', 'venue'], k))
                         FROM unnest(b.kinds) k))
      FROM public.gigs g
      JOIN LATERAL (
        SELECT a.user_id, (array_agg(s.organization_id ORDER BY s.organization_id))[1] AS organization_id
          FROM public.gig_staff_slots s
          JOIN public.gig_staff_assignments a ON a.slot_id = s.id
         WHERE s.gig_id = g.id AND a.status IN ('Requested', 'Invited', 'Confirmed')
         GROUP BY a.user_id
      ) staff ON true
     WHERE g.id = b.gig_id
       AND NOT (staff.user_id = ANY (b.actor_ids))
       AND public.push_recipient_active(staff.user_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;
  RETURN v_total;
END $$;

-- 3. Payments due and overdue ---------------------------------------------------------------
CREATE TABLE public.payment_reminders (
  gig_financial_id uuid NOT NULL REFERENCES public.gig_financials(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('due', 'overdue')),
  due_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gig_financial_id, kind, due_date)
);
COMMENT ON TABLE public.payment_reminders IS
  'Payment reminders already sent: one per line, kind (due, overdue) and due date, so none is sent twice.';
ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_reminders TO service_role;
CREATE POLICY "Two-factor sign-in when required" ON public.payment_reminders
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

-- Reminds each organization's Admins of its lines due today and newly overdue. Returns the number of
-- notifications added.
CREATE OR REPLACE FUNCTION public.send_payment_reminders(p_today date DEFAULT current_date) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows int;
BEGIN
  WITH candidates AS (
    SELECT f.id, f.organization_id, f.due_date,
           CASE WHEN f.due_date = p_today THEN 'due' ELSE 'overdue' END AS kind
      FROM public.gig_financials f
     WHERE f.due_date BETWEEN p_today - 7 AND p_today
       AND f.stage IN ('accepted', 'contract_sent', 'contracted', 'invoiced')
  ), fresh AS (
    INSERT INTO public.payment_reminders (gig_financial_id, kind, due_date)
    SELECT id, kind, due_date FROM candidates
    ON CONFLICT DO NOTHING
    RETURNING gig_financial_id, kind
  ), counts AS (
    SELECT c.organization_id,
           count(*) FILTER (WHERE fr.kind = 'due') AS due_count,
           count(*) FILTER (WHERE fr.kind = 'overdue') AS overdue_count
      FROM fresh fr
      JOIN candidates c ON c.id = fr.gig_financial_id AND c.kind = fr.kind
     GROUP BY c.organization_id
  )
  INSERT INTO public.notifications (recipient_id, type, payload)
  SELECT m.user_id, 'payment.reminder',
         jsonb_build_object('organization_id', o.id, 'organization_name', o.name,
                            'due_count', c.due_count, 'overdue_count', c.overdue_count)
    FROM counts c
    JOIN public.organizations o ON o.id = c.organization_id
    JOIN public.organization_members m ON m.organization_id = c.organization_id AND m.role = 'Admin'
   WHERE public.push_recipient_active(m.user_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- Only the scheduled jobs and triggers use these.
REVOKE ALL ON FUNCTION public.push_recipient_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_gig_change(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flush_gig_change_batches(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_payment_reminders(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flush_gig_change_batches(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_payment_reminders(date) TO service_role;

-- 4. Schedules ------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
SELECT cron.schedule('push-gig-changes', '* * * * *', $$SELECT public.flush_gig_change_batches()$$);
SELECT cron.schedule('push-payment-reminders', '0 15 * * *', $$SELECT public.send_payment_reminders()$$);
