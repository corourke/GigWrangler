-- A scan queued on a phone carries an id made on the phone (client_id), so a retry after a lost
-- reply can't record the same scan twice. Scans without one (older phones, the web app) are
-- unaffected.
ALTER TABLE public.inventory_tracking ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_tracking_client_id_key
  ON public.inventory_tracking (client_id) WHERE client_id IS NOT NULL;
COMMENT ON COLUMN public.inventory_tracking.client_id IS 'Id the phone gave the scan when it queued it; makes a retried scan a no-op.';
