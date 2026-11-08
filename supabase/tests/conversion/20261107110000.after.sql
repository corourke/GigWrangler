-- Existing Admins, and only they, get a grace date 14 days from the migration; once each.
DO $$
DECLARE got text;
BEGIN
  SELECT string_agg(right(user_id::text, 2), ',' ORDER BY user_id) INTO got
  FROM public.user_mfa_requirements
  WHERE required_after BETWEEN now() + interval '13 days 23 hours' AND now() + interval '14 days 1 hour';
  IF got IS DISTINCT FROM 'a1,a2' THEN
    RAISE EXCEPTION 'Expected grace dates for a1,a2 only; got %', coalesce(got, 'none');
  END IF;
  IF (SELECT count(*) FROM public.user_mfa_requirements) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 grace dates, got %', (SELECT count(*) FROM public.user_mfa_requirements);
  END IF;
END $$;
