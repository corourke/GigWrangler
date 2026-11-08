-- B21: a purchase line's gig changes in one call, with its gig expenses, or not at all.
--
-- Before, the Purchases tab updated the line's gig_id and then moved or deleted each of the line's
-- gig expenses (gig_financials.purchase_id = the line) in separate calls. A refused step (a filed
-- year, no permission) left the line on its new gig and the expenses behind.
--
-- set_purchase_line_gig(line, gig, remove_entries):
--   * the same gig as now: no writes; returns changed = false.
--   * another gig: the line and every gig expense of it move there. The gig must have the line's
--     organization on it.
--   * no gig: the line is unlinked. If it has gig expenses they are deleted, but only with
--     p_remove_entries (the user confirmed); otherwise it is refused and nothing changes.
-- SECURITY INVOKER: RLS and the filed-year locks apply to every write.
-- Returns { changed, moved: [{before, after}], removed: [row], entries } for the app's history.
-- Error messages are fixed text; the app shows them as they are.
CREATE OR REPLACE FUNCTION public.set_purchase_line_gig(
  p_line_id uuid, p_gig_id uuid, p_remove_entries boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_line public.purchases%ROWTYPE;
  v_row public.gig_financials%ROWTYPE;
  v_after jsonb;
  v_moved jsonb := '[]'::jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_entries int := 0;
  v_expected int;
  v_n int;
BEGIN
  SELECT * INTO v_line FROM public.purchases
  WHERE id = p_line_id AND row_type <> 'header'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase line not found, or you do not have permission to change it.' USING ERRCODE = '42501';
  END IF;

  IF v_line.gig_id IS NOT DISTINCT FROM p_gig_id THEN
    SELECT count(*) INTO v_entries FROM public.gig_financials
    WHERE purchase_id = p_line_id AND gig_id IS NOT DISTINCT FROM p_gig_id;
    RETURN jsonb_build_object('changed', false, 'moved', v_moved, 'removed', v_removed, 'entries', v_entries);
  END IF;

  -- The line's organization must be on the gig. Invoker RLS alone would let someone who belongs
  -- to two organizations put one's line on the other's gig.
  IF p_gig_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gig_participants gp
    WHERE gp.gig_id = p_gig_id AND gp.organization_id = v_line.organization_id
  ) THEN
    RAISE EXCEPTION 'This organization is not on that gig.' USING ERRCODE = '42501';
  END IF;

  IF p_gig_id IS NULL
     AND NOT p_remove_entries
     AND EXISTS (SELECT 1 FROM public.gig_financials WHERE purchase_id = p_line_id) THEN
    RAISE EXCEPTION 'This line has gig expenses. Confirm removing them first.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.purchases SET gig_id = p_gig_id, updated_by = auth.uid() WHERE id = p_line_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Purchase line not found, or you do not have permission to change it.' USING ERRCODE = '42501';
  END IF;

  IF p_gig_id IS NOT NULL THEN
    FOR v_row IN
      SELECT * FROM public.gig_financials
      WHERE purchase_id = p_line_id AND gig_id IS DISTINCT FROM p_gig_id
      FOR UPDATE
    LOOP
      UPDATE public.gig_financials SET gig_id = p_gig_id, updated_by = auth.uid()
      WHERE id = v_row.id
      RETURNING to_jsonb(gig_financials.*) INTO v_after;
      IF v_after IS NULL THEN
        RAISE EXCEPTION 'A gig expense could not be changed.' USING ERRCODE = '42501';
      END IF;
      v_moved := v_moved || jsonb_build_array(jsonb_build_object('before', to_jsonb(v_row), 'after', v_after));
    END LOOP;
    SELECT count(*) INTO v_entries FROM public.gig_financials WHERE purchase_id = p_line_id AND gig_id = p_gig_id;
  ELSE
    SELECT count(*) INTO v_expected FROM public.gig_financials WHERE purchase_id = p_line_id;
    IF v_expected > 0 THEN
      WITH d AS (DELETE FROM public.gig_financials WHERE purchase_id = p_line_id RETURNING *)
      SELECT coalesce(jsonb_agg(to_jsonb(d.*)), '[]'::jsonb), count(*) INTO v_removed, v_n FROM d;
      IF v_n <> v_expected THEN
        RAISE EXCEPTION 'A gig expense could not be removed.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('changed', true, 'moved', v_moved, 'removed', v_removed, 'entries', v_entries);
END;
$$;

REVOKE ALL ON FUNCTION public.set_purchase_line_gig(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_line_gig(uuid, uuid, boolean) TO authenticated;
