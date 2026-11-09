-- A12: whether a gig is all-day is its own column.
--
-- Before, an all-day gig was one whose start was exactly 12:00 UTC (its end 12:00 UTC on its last
-- date), and the app inferred that in about a dozen places. A timed gig that really started at
-- 12:00 UTC (5 AM in Los Angeles) showed as all-day. All-day gigs keep the 12:00 UTC storage, so
-- their dates read the same everywhere; the flag says which gigs they are.
ALTER TABLE public.gigs ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.gigs.all_day IS
  'All-day gig (A12): start and end are dates, stored at 12:00 UTC, and shown without times. Otherwise start and end are instants shown in the gig''s time zone.';

-- Backfill: the gigs the app treated as all-day, that start and end at exactly 12:00 UTC. A gig
-- with 12:00 UTC on one end only stays timed (coordinator, 11-09).
-- Leave updated_at alone: this isn't an edit anyone made.
ALTER TABLE public.gigs DISABLE TRIGGER update_gigs_updated_at;
UPDATE public.gigs
SET all_day = true
WHERE (start AT TIME ZONE 'UTC')::time = '12:00:00'
  AND ("end" AT TIME ZONE 'UTC')::time = '12:00:00';
ALTER TABLE public.gigs ENABLE TRIGGER update_gigs_updated_at;

-- create_gig_complex stores the flag (absent = timed). Otherwise as in 20261020000000.
CREATE OR REPLACE FUNCTION public.create_gig_complex(
  p_gig_data jsonb, p_participants jsonb DEFAULT '[]'::jsonb, p_staff_slots jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gig_id UUID;
  v_user_id UUID;
  v_participant JSONB;
  v_slot JSONB;
  v_role_id UUID;
  v_primary_org_id UUID;
  v_owner_id UUID;
  v_parent_id UUID;
  v_slot_org_id UUID;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  v_primary_org_id := (p_gig_data->>'primary_organization_id')::UUID;
  IF v_primary_org_id IS NULL THEN
    RAISE EXCEPTION 'primary_organization_id is required to create a gig';
  END IF;

  v_owner_id := v_primary_org_id;
  v_parent_id := (p_gig_data->>'parent_gig_id')::UUID;
  IF v_parent_id IS NOT NULL THEN
    SELECT g.owner_organization_id INTO v_owner_id FROM gigs g WHERE g.id = v_parent_id;
    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'Parent gig not found';
    END IF;
    IF v_owner_id <> v_primary_org_id THEN
      RAISE EXCEPTION 'A child gig belongs to its parent''s owner organization';
    END IF;
  END IF;

  IF NOT public.user_is_admin_or_manager_of_org(v_owner_id, v_user_id) THEN
    RAISE EXCEPTION 'Insufficient permissions: only Admins and Managers can create gigs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_participants) p
                 WHERE (p->>'organization_id')::UUID = v_owner_id) THEN
    RAISE EXCEPTION 'The owner organization must be one of the gig''s participants';
  END IF;

  INSERT INTO gigs (title, start, "end", all_day, timezone, status, notes, tags, parent_gig_id, hierarchy_depth,
                    owner_organization_id, created_by, updated_by)
  VALUES (
    p_gig_data->>'title',
    (p_gig_data->>'start')::TIMESTAMPTZ,
    (p_gig_data->>'end')::TIMESTAMPTZ,
    COALESCE((p_gig_data->>'all_day')::BOOLEAN, false),
    COALESCE(p_gig_data->>'timezone', 'UTC'),
    COALESCE(p_gig_data->>'status', 'DateHold')::gig_status,
    p_gig_data->>'notes',
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_gig_data->'tags') x), ARRAY[]::TEXT[]),
    v_parent_id,
    COALESCE((p_gig_data->>'hierarchy_depth')::INTEGER, 0),
    v_owner_id,
    v_user_id,
    v_user_id
  ) RETURNING gigs.id INTO v_gig_id;

  FOR v_participant IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
    INSERT INTO gig_participants (gig_id, organization_id, role, notes)
    VALUES (v_gig_id, (v_participant->>'organization_id')::UUID,
            (v_participant->>'role')::organization_role, v_participant->>'notes');
  END LOOP;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_staff_slots) LOOP
    v_slot_org_id := COALESCE((v_slot->>'organization_id')::UUID, v_primary_org_id);
    IF NOT public.user_is_admin_or_manager_of_org(v_slot_org_id, v_user_id) THEN
      RAISE EXCEPTION 'Insufficient permissions: staff slots can only be created for your own organization';
    END IF;

    INSERT INTO staff_roles (name)
    VALUES (v_slot->>'role')
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING staff_roles.id INTO v_role_id;

    INSERT INTO gig_staff_slots (gig_id, organization_id, staff_role_id, required_count, notes)
    VALUES (v_gig_id, v_slot_org_id, v_role_id,
            COALESCE((v_slot->>'required_count')::INTEGER, 1), v_slot->>'notes');
  END LOOP;

  RETURN QUERY SELECT v_gig_id;
END;
$$;
