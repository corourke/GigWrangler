-- A12: gigs before the all_day column. All-day was inferred from a 12:00 UTC start (the app's
-- convention, with the end at 12:00 UTC on the last day).
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000e00a1', 'conv-a12@example.test');
INSERT INTO public.users (id, email, first_name, last_name) VALUES ('00000000-0000-0000-0000-0000000e00a1', 'conv-a12@example.test', 'Conv', 'Test');
INSERT INTO public.organizations (id, name, roles) VALUES ('00000000-0000-0000-0000-0000000e0001', 'Conv Org', '{Production}');
BEGIN; -- the owner must be a participant, checked at commit
-- 01: all-day, one day (start = end = noon UTC).
-- 02: all-day, three days (noon UTC to noon UTC two days later).
-- 03: timed, 20:00-02:00 UTC.
-- 04: noon UTC start only (a timed gig that ends at 15:00 UTC): stays timed.
-- 05: noon UTC end only: stays timed.
-- 06: 12:00:30 UTC: not exactly noon, stays timed.
INSERT INTO public.gigs (id, title, status, start, "end", timezone, created_by, updated_by, owner_organization_id, updated_at)
SELECT ('00000000-0000-0000-0000-0000000e00' || g.n)::uuid, 'Conv ' || g.n, (enum_range(NULL::gig_status))[1], g.s::timestamptz, g.e::timestamptz,
       'America/Los_Angeles', '00000000-0000-0000-0000-0000000e00a1', '00000000-0000-0000-0000-0000000e00a1',
       '00000000-0000-0000-0000-0000000e0001', '2026-01-01T00:00:00Z'
FROM (VALUES ('01', '2026-05-01T12:00:00Z', '2026-05-01T12:00:00Z'),
             ('02', '2026-05-01T12:00:00Z', '2026-05-03T12:00:00Z'),
             ('03', '2026-05-01T20:00:00Z', '2026-05-02T02:00:00Z'),
             ('04', '2026-05-01T12:00:00Z', '2026-05-01T15:00:00Z'),
             ('05', '2026-05-01T09:00:00Z', '2026-05-01T12:00:00Z'),
             ('06', '2026-05-01T12:00:30Z', '2026-05-01T12:00:30Z')) g(n, s, e);
INSERT INTO public.gig_participants (gig_id, organization_id, role)
SELECT ('00000000-0000-0000-0000-0000000e00' || n)::uuid, '00000000-0000-0000-0000-0000000e0001', 'Production'
FROM unnest(ARRAY['01', '02', '03', '04', '05', '06']) n;
COMMIT;
