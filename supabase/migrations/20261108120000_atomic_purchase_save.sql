-- B6 (plan approved 11-08): saving a purchase is one call, all or nothing.
--
-- 1. update_purchase_v1(purchase, plan): the edit dialog's save. Before, the app made one call per
--    step (equipment decisions, the header, units, line updates, new lines, removed lines, recovery
--    periods, equipment fields, the gig money the lines feed); a failure partway left a half-saved
--    purchase. Now the same steps run, in the same order, in one transaction.
-- 2. create_purchase_transaction_v3(header, items, units, gig, ledger): v2, plus, for a purchase
--    scanned on a gig, linking its expensed lines to the gig and adding their gig expenses in the
--    same transaction (before: separate calls after the purchase was saved).
--
-- update_purchase_v1 is SECURITY INVOKER: row-level security, the filed-year locks and every
-- trigger apply as for the separate calls it replaces. v3 is SECURITY DEFINER like v2, with v2's
-- checks, and checks the organization is on the gig before adding gig money.

-- 1. The edit ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_v1(p_purchase_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  -- Fields each step may write; anything else in the plan is ignored.
  c_header text[] := ARRAY['vendor', 'purchase_date', 'description', 'total_inv_amount', 'payment_method', 'category'];
  c_line text[] := ARRAY['description', 'quantity', 'item_price', 'item_cost', 'line_amount', 'line_cost', 'category',
                         'tax_treatment', 'purchase_date', 'vendor'];
  c_asset text[] := ARRAY['manufacturer_model', 'description', 'category', 'quantity', 'item_price', 'item_cost', 'vendor',
                          'acquisition_date', 'serial_number', 'tag_number', 'replacement_value', 'insurance_policy_added',
                          'recovery_period'];
  v_header public.purchases;
  v_op jsonb;
  v_ids uuid[];
  v_id uuid;
  v_cols text;
  v_before jsonb;
  v_after jsonb;
  v_n int;
  v_periods jsonb := '[]';
  v_assets jsonb := '[]';
  v_financials jsonb := '[]';
  v_status jsonb := '[]';
BEGIN
  SELECT * INTO v_header FROM public.purchases WHERE id = p_purchase_id AND row_type = 'header' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found, or you do not have permission to change it.';
  END IF;

  -- 1. Equipment decisions for lines whose quantity changed (first, as before).
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'equipment', '[]')) LOOP
    v_id := (v_op->>'asset_id')::uuid;
    IF v_op->>'op' = 'lot_quantity' THEN
      SELECT to_jsonb(a) INTO v_before FROM public.assets a WHERE a.id = v_id;
      UPDATE public.assets a SET quantity = (v_op->>'quantity')::numeric, updated_by = auth.uid(), updated_at = now()
       WHERE a.id = v_id RETURNING to_jsonb(a) INTO v_after;
      IF v_after IS NULL THEN RAISE EXCEPTION 'Equipment not found, or you do not have permission to change it.'; END IF;
      v_assets := v_assets || jsonb_build_object('before', v_before, 'after', v_after);
    ELSIF v_op->>'op' = 'repoint' THEN
      UPDATE public.purchases SET asset_id = v_id, updated_by = auth.uid(), updated_at = now()
       WHERE id = (v_op->>'line_id')::uuid AND parent_id = p_purchase_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN RAISE EXCEPTION 'That line is not on this purchase.'; END IF;
    ELSIF v_op->>'op' = 'remove_unit' AND v_op->>'how' = 'inactive' THEN
      SELECT to_jsonb(a) INTO v_before FROM public.assets a WHERE a.id = v_id;
      PERFORM public.update_asset_status(v_id, 'Inactive');
      UPDATE public.assets SET purchase_line_id = NULL, updated_by = auth.uid(), updated_at = now() WHERE id = v_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN RAISE EXCEPTION 'Equipment not found, or you do not have permission to change it.'; END IF;
      IF v_before->>'status' IS DISTINCT FROM 'Inactive' THEN
        v_status := v_status || jsonb_build_object('asset_id', v_id, 'from', v_before->>'status', 'to', 'Inactive',
          'asset_model', v_before->>'manufacturer_model', 'category', v_before->>'category', 'organization_id', v_before->>'organization_id');
      END IF;
    ELSIF v_op->>'op' = 'remove_unit' THEN
      DELETE FROM public.assets WHERE id = v_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN RAISE EXCEPTION 'Equipment not found, or you do not have permission to delete it.'; END IF;
    ELSE
      RAISE EXCEPTION 'Unknown equipment step: %', v_op->>'op';
    END IF;
  END LOOP;

  -- 2. The header.
  SELECT string_agg(format('%I', k), ', ') INTO v_cols
    FROM jsonb_object_keys(coalesce(p_plan->'header', '{}')) k WHERE k = ANY (c_header);
  IF v_cols IS NOT NULL THEN
    EXECUTE format('UPDATE public.purchases t SET (%s, updated_by, updated_at) = (SELECT %s, auth.uid(), now() FROM jsonb_populate_record(NULL::public.purchases, $1) r) WHERE t.id = $2',
                   v_cols, (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(p_plan->'header') k WHERE k = ANY (c_header)))
      USING p_plan->'header', p_purchase_id;
  END IF;

  -- 3. Units for saved lines that start being tracked (before their treatment changes).
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'track_lines', '[]')) LOOP
    PERFORM 1 FROM public.purchases WHERE id = (v_op->>'line_id')::uuid AND parent_id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on this purchase.'; END IF;
    v_ids := public.add_purchase_line_units((v_op->>'line_id')::uuid, ARRAY(SELECT jsonb_array_elements(coalesce(v_op->'units', '[]'))));
    IF v_op->>'period' IS NOT NULL THEN
      v_periods := v_periods || (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u, 'period', v_op->'period')), '[]') FROM unnest(v_ids) u);
    END IF;
  END LOOP;

  -- 4. Saved lines.
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'updated_items', '[]')) LOOP
    PERFORM 1 FROM public.purchases WHERE id = (v_op->>'id')::uuid AND parent_id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on this purchase.'; END IF;
    SELECT string_agg(format('%I', k), ', ') INTO v_cols
      FROM jsonb_object_keys(coalesce(v_op->'data', '{}')) k WHERE k = ANY (c_line);
    IF v_cols IS NOT NULL THEN
      EXECUTE format('UPDATE public.purchases t SET (%s, updated_by, updated_at) = (SELECT %s, auth.uid(), now() FROM jsonb_populate_record(NULL::public.purchases, $1) r) WHERE t.id = $2',
                     v_cols, (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(v_op->'data') k WHERE k = ANY (c_line)))
        USING v_op->'data', (v_op->>'id')::uuid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN RAISE EXCEPTION 'A line could not be saved.'; END IF;
    END IF;
  END LOOP;

  -- 5. New lines. A tracked one is added as an expense, gets its units, then takes its treatment
  --    (a depreciated line needs its equipment first).
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'new_items', '[]')) LOOP
    SELECT string_agg(format('%I', k), ', ') INTO v_cols
      FROM jsonb_object_keys(coalesce(v_op->'data', '{}')) k WHERE k = ANY (c_line) AND k <> 'tax_treatment';
    EXECUTE format('INSERT INTO public.purchases (organization_id, parent_id, row_type, tax_treatment, created_by, updated_by%s) SELECT $1, $2, ''line'', $3, auth.uid(), auth.uid()%s FROM jsonb_populate_record(NULL::public.purchases, $4) r RETURNING id',
                   CASE WHEN v_cols IS NULL THEN '' ELSE ', ' || v_cols END,
                   coalesce((SELECT ', ' || string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(v_op->'data') k WHERE k = ANY (c_line) AND k <> 'tax_treatment'), ''))
      INTO v_id
      USING v_header.organization_id, p_purchase_id,
            CASE WHEN (v_op->>'track')::boolean THEN 'expense' ELSE nullif(v_op->'data'->>'tax_treatment', '') END,
            v_op->'data';
    IF (v_op->>'track')::boolean THEN
      v_ids := public.add_purchase_line_units(v_id, ARRAY(SELECT jsonb_array_elements(coalesce(v_op->'units', '[]'))));
      IF v_op->>'period' IS NOT NULL THEN
        v_periods := v_periods || (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u, 'period', v_op->'period')), '[]') FROM unnest(v_ids) u);
      END IF;
      IF v_op->'data'->>'tax_treatment' = 'depreciate' THEN
        UPDATE public.purchases SET tax_treatment = 'depreciate', updated_by = auth.uid(), updated_at = now() WHERE id = v_id;
      END IF;
    END IF;
  END LOOP;

  -- 6. More units on saved lines.
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'add_units', '[]')) LOOP
    PERFORM 1 FROM public.purchases WHERE id = (v_op->>'line_id')::uuid AND parent_id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That line is not on this purchase.'; END IF;
    PERFORM public.add_purchase_line_units((v_op->>'line_id')::uuid, ARRAY(SELECT jsonb_array_elements(coalesce(v_op->'units', '[]'))));
  END LOOP;

  -- 7. Removed lines (their gig expenses go with them, B2).
  FOR v_id IN SELECT (jsonb_array_elements_text(coalesce(p_plan->'removed_item_ids', '[]')))::uuid LOOP
    DELETE FROM public.purchases WHERE id = v_id AND parent_id = p_purchase_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RAISE EXCEPTION 'A removed line could not be deleted.'; END IF;
  END LOOP;

  -- 8. Recovery periods of the new units, once their lines are depreciated.
  FOR v_op IN SELECT * FROM jsonb_array_elements(v_periods) LOOP
    UPDATE public.assets SET recovery_period = (v_op->>'period')::smallint, updated_by = auth.uid(), updated_at = now()
     WHERE id = (v_op->>'id')::uuid;
  END LOOP;

  -- 9. Equipment fields that follow the lines and the pop-up.
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'asset_changes', '[]')) LOOP
    v_id := (v_op->>'asset_id')::uuid;
    SELECT string_agg(format('%I', k), ', ') INTO v_cols
      FROM jsonb_object_keys(coalesce(v_op->'data', '{}')) k WHERE k = ANY (c_asset);
    CONTINUE WHEN v_cols IS NULL;
    SELECT to_jsonb(a) INTO v_before FROM public.assets a WHERE a.id = v_id;
    EXECUTE format('UPDATE public.assets t SET (%s, updated_by, updated_at) = (SELECT %s, auth.uid(), now() FROM jsonb_populate_record(NULL::public.assets, $1) r) WHERE t.id = $2 RETURNING to_jsonb(t)',
                   v_cols, (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(v_op->'data') k WHERE k = ANY (c_asset)))
      INTO v_after USING v_op->'data', v_id;
    IF v_after IS NULL THEN RAISE EXCEPTION 'Equipment not found, or you do not have permission to change it.'; END IF;
    v_assets := v_assets || jsonb_build_object('before', v_before, 'after', v_after);
  END LOOP;

  -- 10. The gig money the lines feed.
  FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'gig_changes', '[]')) LOOP
    v_id := (v_op->>'fin_id')::uuid;
    SELECT to_jsonb(f) INTO v_before FROM public.gig_financials f WHERE f.id = v_id;
    UPDATE public.gig_financials f
       SET amount = (v_op->>'amount')::numeric,
           amount_settled = CASE WHEN (v_op->>'settle')::boolean THEN (v_op->>'amount')::numeric ELSE f.amount_settled END,
           updated_by = auth.uid()
     WHERE f.id = v_id
    RETURNING to_jsonb(f) INTO v_after;
    IF v_after IS NULL THEN RAISE EXCEPTION 'A gig expense could not be updated.'; END IF;
    v_financials := v_financials || jsonb_build_object('before', v_before, 'after', v_after);
  END LOOP;

  RETURN jsonb_build_object('assets', v_assets, 'financials', v_financials, 'status_changes', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.update_purchase_v1(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_v1(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_purchase_v1(uuid, jsonb) IS
  'Save a purchase edit in one transaction (B6): equipment decisions, header, lines, units, recovery periods, equipment fields and gig money. Returns the equipment and gig rows changed (before/after) for the history.';

-- 2. Creating a purchase, linked to a gig in the same call ----------------------------------------
-- p_ledger: one entry per expensed line to put on the gig: line_index (0-based into p_items),
-- amount, category, description, date, paid_at.
CREATE OR REPLACE FUNCTION public.create_purchase_transaction_v3(
  p_header jsonb, p_items jsonb[], p_units jsonb[], p_gig_id uuid DEFAULT NULL, p_ledger jsonb[] DEFAULT ARRAY[]::jsonb[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := (p_header->>'organization_id')::uuid;
  v_result jsonb;
  v_line_ids uuid[];
  v_entry jsonb;
  v_line public.purchases%ROWTYPE;
  v_fin jsonb;
  v_ledger jsonb := '[]';
BEGIN
  IF coalesce(array_length(p_ledger, 1), 0) > 0 AND p_gig_id IS NULL THEN
    RAISE EXCEPTION 'Gig expenses need a gig.' USING ERRCODE = '22023';
  END IF;
  IF p_gig_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.gig_participants gp WHERE gp.gig_id = p_gig_id AND gp.organization_id = v_org) THEN
    RAISE EXCEPTION 'This organization is not on that gig.' USING ERRCODE = '42501';
  END IF;

  -- v2 checks the caller and the rows, and records the purchase, its lines and units.
  v_result := public.create_purchase_transaction_v2(p_header, p_items, p_units);
  SELECT array_agg(x::uuid) INTO v_line_ids FROM jsonb_array_elements_text(v_result->'line_ids') x;

  FOREACH v_entry IN ARRAY coalesce(p_ledger, ARRAY[]::jsonb[]) LOOP
    SELECT * INTO v_line FROM public.purchases WHERE id = v_line_ids[(v_entry->>'line_index')::int + 1];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Each gig expense must name a line of this purchase' USING ERRCODE = '22023';
    END IF;
    UPDATE public.purchases SET gig_id = p_gig_id, updated_by = auth.uid() WHERE id = v_line.id;
    INSERT INTO public.gig_financials (
      gig_id, organization_id, date, amount, amount_settled, direction, stage, category, description,
      purchase_id, paid_at, created_by)
    VALUES (
      p_gig_id, v_org, (v_entry->>'date')::date, (v_entry->>'amount')::numeric, (v_entry->>'amount')::numeric,
      'out', 'paid', (v_entry->>'category')::public.fin_category, v_entry->>'description',
      v_line.id, (v_entry->>'paid_at')::date::timestamp AT TIME ZONE 'UTC', auth.uid())
    RETURNING to_jsonb(gig_financials.*) INTO v_fin;
    v_ledger := v_ledger || v_fin;
  END LOOP;

  RETURN v_result || jsonb_build_object('ledger', v_ledger);
END $$;
REVOKE EXECUTE ON FUNCTION public.create_purchase_transaction_v3(jsonb, jsonb[], jsonb[], uuid, jsonb[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_transaction_v3(jsonb, jsonb[], jsonb[], uuid, jsonb[]) TO authenticated;

COMMENT ON FUNCTION public.create_purchase_transaction_v3(jsonb, jsonb[], jsonb[], uuid, jsonb[]) IS
  'create_purchase_transaction_v2, plus linking expensed lines to a gig and adding their gig expenses in the same transaction (B6).';
