-- B1/B24/B17: tax_date on existing rows. Paid rows are mostly midnight UTC (typed
-- days); a few were stamped with the moment they were marked paid.
SET TimeZone = 'America/Los_Angeles';
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000c00a1', 'conv-tax@example.test');
INSERT INTO public.users (id, email, first_name, last_name) VALUES ('00000000-0000-0000-0000-0000000c00a1', 'conv-tax@example.test', 'Conv', 'Test');
INSERT INTO public.organizations (id, name, roles) VALUES ('00000000-0000-0000-0000-0000000c0001', 'Conv Org', '{Production}');
BEGIN; -- the owner must be a participant, checked at commit
INSERT INTO public.gigs (id, title, status, start, "end", timezone, created_by, updated_by, owner_organization_id)
  VALUES ('00000000-0000-0000-0000-0000000c0002', 'Conv Gig', (enum_range(NULL::gig_status))[1], '2025-12-30T20:00:00Z', '2025-12-31T02:00:00Z', 'UTC', '00000000-0000-0000-0000-0000000c00a1', '00000000-0000-0000-0000-0000000c00a1', '00000000-0000-0000-0000-0000000c0001');
INSERT INTO public.gig_participants (gig_id, organization_id, role) VALUES ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'Production');
COMMIT;
INSERT INTO public.gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, created_by) VALUES
  ('00000000-0000-0000-0000-0000000c0101', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'in',  'paid',     100, 100,  '2026-01-01T00:00:00+00:00', '2025-12-30', '00000000-0000-0000-0000-0000000c00a1'),
  ('00000000-0000-0000-0000-0000000c0102', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'out', 'paid',     20,  20,   '2026-03-04T03:15:00+00:00', '2026-03-03', '00000000-0000-0000-0000-0000000c00a1'),
  ('00000000-0000-0000-0000-0000000c0103', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'in',  'invoiced', 50,  NULL, NULL,                        '2025-11-15', '00000000-0000-0000-0000-0000000c00a1');
