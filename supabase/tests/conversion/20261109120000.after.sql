-- A12: only gigs that start and end at exactly 12:00 UTC become all-day; nothing else changes.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s: got %s, want %s', e.gig, g.all_day, e.all_day), '; ') INTO bad
  FROM (VALUES ('01', true), ('02', true), ('03', false), ('04', false), ('05', false), ('06', false)) e(gig, all_day)
  JOIN gigs g ON g.id = ('00000000-0000-0000-0000-0000000e00' || e.gig)::uuid
  WHERE g.all_day IS DISTINCT FROM e.all_day;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Wrong all_day: %', bad; END IF;
  -- The backfill is not an edit anyone made: updated_at stays.
  IF EXISTS (SELECT 1 FROM gigs WHERE id::text LIKE '00000000-0000-0000-0000-0000000e00%' AND updated_at <> '2026-01-01T00:00:00Z') THEN
    RAISE EXCEPTION 'The backfill changed updated_at';
  END IF;
  -- New gigs default to timed, and the column is required.
  IF (SELECT column_default FROM information_schema.columns WHERE table_name = 'gigs' AND column_name = 'all_day') <> 'false'
     OR (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'gigs' AND column_name = 'all_day') <> 'NO' THEN
    RAISE EXCEPTION 'all_day must be NOT NULL DEFAULT false';
  END IF;
END $$;
