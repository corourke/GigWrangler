-- The ai-scan function now also limits an organization's scans in the trailing 24 hours
-- (SCANS_PER_ORG_PER_DAY in supabase/functions/ai-scan/scanLimits.ts); index that count.
CREATE INDEX IF NOT EXISTS idx_ai_scan_usage_org_time ON public.ai_scan_usage (organization_id, created_at);
