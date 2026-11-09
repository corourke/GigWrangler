-- A20: every gig money row belongs to an organization. Checked read-only on prod 2026-11-08:
-- no row has a null organization_id. If one did, this fails and changes nothing.
ALTER TABLE public.gig_financials ALTER COLUMN organization_id SET NOT NULL;
