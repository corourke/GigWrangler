-- B2 (plan approved by Cameron, 11-07): deleting a purchase line, or a whole purchase
-- (its lines go with it through parent_id), removes the gig expenses linked to those lines.
-- Before, the link was ON DELETE SET NULL: the gig expense stayed, unlinked, and then counted
-- as gig money and in the tax report as a separate expense.
-- A purchase in a filed year still can't be deleted (purchases_c_tax_year_lock), so a filed
-- year never loses rows this way. Existing links are unchanged; no data changes.

ALTER TABLE public.gig_financials DROP CONSTRAINT gig_financials_purchase_id_fkey;
ALTER TABLE public.gig_financials
  ADD CONSTRAINT gig_financials_purchase_id_fkey
  FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;
