-- A2: an index on every foreign key that had none (34). Joins and filters on these columns, and
-- the scan Postgres makes when a referenced row is deleted, no longer read the whole table.
-- RLS test 89 keeps it so: it fails if a foreign key in public has no index on its columns.
-- Plain CREATE INDEX (migrations run in a transaction); the tables are small, so each build is quick.

CREATE INDEX IF NOT EXISTS idx_access_requests_handled_by ON public.access_requests (handled_by);
CREATE INDEX IF NOT EXISTS idx_assets_maintenance_by ON public.assets (maintenance_by);
CREATE INDEX IF NOT EXISTS idx_assets_maintenance_from ON public.assets (maintenance_from);
CREATE INDEX IF NOT EXISTS idx_assets_maintenance_pending_gig_id ON public.assets (maintenance_pending_gig_id);
CREATE INDEX IF NOT EXISTS idx_assets_purchase_id ON public.assets (purchase_id);
CREATE INDEX IF NOT EXISTS idx_assets_written_off_from ON public.assets (written_off_from);
CREATE INDEX IF NOT EXISTS idx_attachments_organization_id ON public.attachments (organization_id);
CREATE INDEX IF NOT EXISTS idx_entity_attachments_attachment_id ON public.entity_attachments (attachment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_categories_organization_id ON public.equipment_categories (organization_id);
CREATE INDEX IF NOT EXISTS idx_equipment_items_created_by ON public.equipment_items (created_by);
CREATE INDEX IF NOT EXISTS idx_equipment_items_updated_by ON public.equipment_items (updated_by);
CREATE INDEX IF NOT EXISTS idx_expense_categories_organization_id ON public.expense_categories (organization_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_schedule_c_line ON public.expense_categories (schedule_c_line);
CREATE INDEX IF NOT EXISTS idx_gig_financials_counterparty_id ON public.gig_financials (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_gig_financials_purchase_id ON public.gig_financials (purchase_id);
CREATE INDEX IF NOT EXISTS idx_gig_financials_staff_assignment_id ON public.gig_financials (staff_assignment_id);
CREATE INDEX IF NOT EXISTS idx_gig_financials_updated_by ON public.gig_financials (updated_by);
CREATE INDEX IF NOT EXISTS idx_gig_participant_contacts_organization_id ON public.gig_participant_contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_gig_participant_contacts_user_id ON public.gig_participant_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_gig_staff_assignments_gig_financial_id ON public.gig_staff_assignments (gig_financial_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tracking_asset_id ON public.inventory_tracking (asset_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tracking_kit_id ON public.inventory_tracking (kit_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tracking_organization_id ON public.inventory_tracking (organization_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tracking_scanned_by ON public.inventory_tracking (scanned_by);
CREATE INDEX IF NOT EXISTS idx_invitations_accepted_by ON public.invitations (accepted_by);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_kit_components_equipment_item_id ON public.kit_components (equipment_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_scan_queue_attachment_id ON public.purchase_scan_queue (attachment_id);
CREATE INDEX IF NOT EXISTS idx_purchases_asset_id ON public.purchases (asset_id);
CREATE INDEX IF NOT EXISTS idx_purchases_gig_id ON public.purchases (gig_id);
CREATE INDEX IF NOT EXISTS idx_purchases_organization_id ON public.purchases (organization_id);
CREATE INDEX IF NOT EXISTS idx_purchases_parent_id ON public.purchases (parent_id);
CREATE INDEX IF NOT EXISTS idx_tax_year_depreciation_updated_by ON public.tax_year_depreciation (updated_by);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices (user_id);
