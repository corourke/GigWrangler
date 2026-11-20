-- Crew arrival times (#458): the server bounds the time itself.
--
-- The time is the phone's clock, so a wrong clock or a hand-made request could put an arrival far
-- from the gig. The write is now refused unless:
--   * the time is not more than 5 minutes ahead of the server's clock;
--   * the time is within 12 hours before the gig starts to 12 hours after it ends (as before); and
--   * the write itself happens no later than 2 days after that window closes, so a tap made at the
--     gig with no signal still syncs when the phone is next online.
-- Clearing a time has no time limit. Same function and signature as 20261120100000; only its body
-- changes, so the existing rules that call it pick this up.

CREATE OR REPLACE FUNCTION public.gig_arrival_time_ok(p_gig_id uuid, p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       public.user_has_access_to_gig(p_gig_id, auth.uid())
       OR EXISTS (
         SELECT 1 FROM gig_staff_assignments a JOIN gig_staff_slots s ON s.id = a.slot_id
          WHERE s.gig_id = p_gig_id AND a.user_id = auth.uid()
       )
     )
     AND p_at <= now() + interval '5 minutes'
     AND EXISTS (
       SELECT 1 FROM gigs g
        WHERE g.id = p_gig_id
          AND p_at >= g.start - interval '12 hours'
          AND p_at <= g."end" + interval '12 hours'
          AND now() <= g."end" + interval '12 hours' + interval '2 days'
     )
$$;
