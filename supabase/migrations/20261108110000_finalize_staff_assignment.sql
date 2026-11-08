-- B5 (plan approved by Cameron, 11-08): finalizing a staff member's pay is one call.
-- * Amount: the fee when there is one, $0 included (before, a $0 fee fell through to the rate);
--   otherwise rate x the units entered, which are required and kept as entered (0 and decimals).
-- * The labor row is dated by the gig's start date in the gig's time zone, not the day it was
--   finalized. Its year is that date while it is owed, so a gig in a filed year is refused.
-- * The row and the assignment's completion and back-link are written together (before, two
--   app calls: a failure between them left a labor row with no assignment pointing at it).
-- SECURITY INVOKER: row-level security and the filed-year lock apply.

CREATE OR REPLACE FUNCTION public.finalize_staff_assignment(p_assignment_id uuid, p_units numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_asg record;
  v_amount numeric;
  v_fin_id uuid;
BEGIN
  SELECT a.id, a.fee, a.rate, a.completed_at, s.gig_id, s.organization_id, r.name AS role_name,
         g.start AS gig_start, g.timezone AS gig_timezone
    INTO v_asg
    FROM public.gig_staff_assignments a
    JOIN public.gig_staff_slots s ON s.id = a.slot_id
    JOIN public.gigs g ON g.id = s.gig_id
    LEFT JOIN public.staff_roles r ON r.id = s.staff_role_id
   WHERE a.id = p_assignment_id
     FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff assignment not found, or you do not have permission to finalize it.';
  END IF;
  IF v_asg.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This staff assignment is already finalized.';
  END IF;
  IF p_units IS NOT NULL AND p_units < 0 THEN
    RAISE EXCEPTION 'Units worked can''t be negative.';
  END IF;

  IF v_asg.fee IS NOT NULL THEN
    v_amount := v_asg.fee;
  ELSIF v_asg.rate IS NOT NULL THEN
    IF p_units IS NULL THEN
      RAISE EXCEPTION 'Enter the units worked to finalize a rate.';
    END IF;
    v_amount := round(v_asg.rate * p_units, 2);
  ELSE
    v_amount := 0;
  END IF;

  INSERT INTO public.gig_financials (
    gig_id, organization_id, amount, date, direction, stage, category, description,
    staff_assignment_id, created_by)
  VALUES (
    v_asg.gig_id, v_asg.organization_id, v_amount,
    (v_asg.gig_start AT TIME ZONE coalesce(nullif(v_asg.gig_timezone, ''), 'UTC'))::date,
    'out', 'invoiced', 'Contract labor', 'Labor: ' || coalesce(v_asg.role_name, 'Staff'),
    v_asg.id, auth.uid())
  RETURNING id INTO v_fin_id;

  UPDATE public.gig_staff_assignments
     SET completed_at = now(), units_completed = p_units, gig_financial_id = v_fin_id
   WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff assignment not found, or you do not have permission to finalize it.';
  END IF;

  RETURN v_fin_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_staff_assignment(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_staff_assignment(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.finalize_staff_assignment(uuid, numeric) IS
  'Finalize a staff assignment''s pay: the owed labor row (dated by the gig''s start date) and the assignment''s completion, together (B5).';
