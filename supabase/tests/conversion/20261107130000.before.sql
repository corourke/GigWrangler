-- B2: the purchase link on gig money becomes ON DELETE CASCADE. Existing links stay as they are.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000d00a1', 'conv-b2@example.test');
INSERT INTO public.users (id, email, first_name, last_name) VALUES ('00000000-0000-0000-0000-0000000d00a1', 'conv-b2@example.test', 'Conv', 'Test');
INSERT INTO public.organizations (id, name, roles) VALUES ('00000000-0000-0000-0000-0000000d0001', 'Conv Org', '{Production}');
BEGIN; -- the owner must be a participant, checked at commit
INSERT INTO public.gigs (id, title, status, start, "end", timezone, created_by, updated_by, owner_organization_id)
  VALUES ('00000000-0000-0000-0000-0000000d0002', 'Conv Gig', (enum_range(NULL::gig_status))[1], '2026-04-01T20:00:00Z', '2026-04-02T02:00:00Z', 'UTC',
          '00000000-0000-0000-0000-0000000d00a1', '00000000-0000-0000-0000-0000000d00a1', '00000000-0000-0000-0000-0000000d0001');
INSERT INTO public.gig_participants (gig_id, organization_id, role) VALUES ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000d0001', 'Production');
COMMIT;
INSERT INTO public.purchases (id, organization_id, parent_id, row_type, purchase_date, vendor, total_inv_amount) VALUES
  ('00000000-0000-0000-0000-0000000d0011', '00000000-0000-0000-0000-0000000d0001', NULL, 'header', '2026-04-01', 'V', 10);
INSERT INTO public.purchases (id, organization_id, parent_id, row_type, purchase_date, quantity, item_cost, line_cost, description, tax_treatment) VALUES
  ('00000000-0000-0000-0000-0000000d0012', '00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0011', 'line', '2026-04-01', 1, 10, 10, 'tape', 'expense');
INSERT INTO public.gig_financials (id, gig_id, organization_id, direction, stage, amount, amount_settled, paid_at, date, purchase_id, created_by) VALUES
  ('00000000-0000-0000-0000-0000000d0101', '00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000d0001', 'out', 'paid', 10, 10, '2026-04-01', '2026-04-01',
   '00000000-0000-0000-0000-0000000d0012', '00000000-0000-0000-0000-0000000d00a1'),
  ('00000000-0000-0000-0000-0000000d0102', '00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000d0001', 'out', 'paid', 25, 25, '2026-04-01', '2026-04-01',
   NULL, '00000000-0000-0000-0000-0000000d00a1');
