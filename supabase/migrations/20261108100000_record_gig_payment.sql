-- B7: recording a payment against a gig money row is one call. The row is marked paid and, when
-- less than agreed arrives and the rest stays owed ("split"), the rest is added as a new row at
-- the original stage, both in one transaction. Before, the app added the remainder first; when
-- the paid update was then refused (a filed year, no permission), the remainder stayed behind.
-- SECURITY INVOKER: row-level security and the filed-year lock apply as for any write.

CREATE OR REPLACE FUNCTION public.record_gig_payment(
  p_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_split boolean,
  p_reference text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_row public.gig_financials;
  v_paid public.gig_financials;
  v_remainder public.gig_financials;
  v_short numeric;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'The amount received must be zero or more.';
  END IF;
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'The payment date is required.';
  END IF;

  SELECT * INTO v_row FROM public.gig_financials WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial record not found, or you do not have permission to change it.';
  END IF;

  v_short := coalesce(v_row.amount, 0) - p_amount;

  -- A paid day is a calendar day, stored as midnight UTC (B1).
  UPDATE public.gig_financials
     SET stage = 'paid',
         amount = CASE WHEN v_short > 0.004 THEN p_amount ELSE amount END,
         amount_settled = p_amount,
         paid_at = p_paid_at::timestamp AT TIME ZONE 'UTC',
         reference_number = coalesce(nullif(btrim(p_reference), ''), reference_number),
         updated_by = auth.uid()
   WHERE id = p_id
  RETURNING * INTO v_paid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial record not found, or you do not have permission to change it.';
  END IF;

  IF p_split AND v_short > 0.004 THEN
    INSERT INTO public.gig_financials (
      gig_id, organization_id, direction, stage, amount, date, due_date, category, description,
      counterparty_id, external_entity_name, currency, created_by)
    VALUES (
      v_row.gig_id, v_row.organization_id, v_row.direction, v_row.stage, round(v_short, 2), v_row.date,
      v_row.due_date, v_row.category,
      CASE WHEN coalesce(v_row.description, '') <> '' THEN v_row.description || ' (remainder)' ELSE 'Remainder' END,
      v_row.counterparty_id, v_row.external_entity_name, v_row.currency, auth.uid())
    RETURNING * INTO v_remainder;
  END IF;

  RETURN jsonb_build_object(
    'paid', to_jsonb(v_paid),
    'remainder', CASE WHEN v_remainder.id IS NULL THEN NULL ELSE to_jsonb(v_remainder) END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_gig_payment(uuid, numeric, date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_gig_payment(uuid, numeric, date, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.record_gig_payment(uuid, numeric, date, boolean, text) IS
  'Mark a gig money row paid and, for a partial payment split off, add the rest as a new owed row: both or neither (B7).';
