-- B1/B24/B17: tax_date on existing rows. Paid rows are mostly midnight UTC (typed
-- days); a few were stamped with the moment they were marked paid.
SET TimeZone = 'America/Los_Angeles';
INSERT INTO public.organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000c0001', 'Conv Org');
INSERT INTO public.gigs (id, title, start, "end", status, primary_organization_id)
  VALUES ('00000000-0000-0000-0000-0000000c0002', 'Conv Gig', '2025-12-30T20:00:00Z', '2025-12-31T02:00:00Z', 'Booked', '00000000-0000-0000-0000-0000000c0001');
INSERT INTO public.gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date) VALUES
  ('00000000-0000-0000-0000-0000000c0101', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'in',  'paid',     100, 100,  '2026-01-01T00:00:00+00:00', '2025-12-30'),
  ('00000000-0000-0000-0000-0000000c0102', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'out', 'paid',     20,  20,   '2026-03-04T03:15:00+00:00', '2026-03-03'),
  ('00000000-0000-0000-0000-0000000c0103', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0001', 'in',  'invoiced', 50,  NULL, NULL,                        '2025-11-15');
