-- Mobile receipt capture (11-10): a receipt captured on a gig's page is queued with
-- that gig, so its desktop review opens as a cost of the gig (as scanning from the
-- gig's Financials does). The gig must be one the queue row's org takes part in.
-- Deleting the gig keeps the receipt in the queue, unlinked.
-- Tested by supabase/tests/rls/92_purchase_scan_queue_gig.test.sql.

ALTER TABLE public.purchase_scan_queue
  ADD COLUMN gig_id uuid REFERENCES public.gigs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_scan_queue_gig_id ON public.purchase_scan_queue (gig_id);

DROP POLICY "Admins and Managers manage their org's scan queue" ON public.purchase_scan_queue;

CREATE POLICY "Admins and Managers manage their org's scan queue" ON public.purchase_scan_queue
  FOR ALL TO authenticated
  USING (public.user_is_admin_or_manager_of_org(organization_id, auth.uid()))
  WITH CHECK (
    public.user_is_admin_or_manager_of_org(organization_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE a.id = attachment_id AND a.organization_id = purchase_scan_queue.organization_id
    )
    AND (gig_id IS NULL OR public.org_participates_in_gig(organization_id, gig_id))
  );
