-- #337 PR 1: depreciation for the Schedule C report (Cameron, 11-03).
--   * A filed year's figures, copied by hand from its Form 4562: lines 12 (Section 179), 14 (bonus),
--     17 (MACRS on earlier years), 21 (listed property) and 22 (the total, Schedule C line 13), and its
--     line 19 rows, one per class: (c) basis, (d) recovery period, (e) convention, (f) method, (g) deduction.
--   * The open year's optional planned Section 179 and bonus, other depreciation expected, and
--     the convention for its estimate (HY unless the user picks MQ).
-- Keyed by organization and year, not tied to tax_years: the open year's planned amounts need no
-- tax_years row (which would list it as a year to lock), and deleting a tax year keeps its figures.
-- Admins and Managers read; only Admins write, also for a locked year (Q1: these are a transcription
-- of the filed return, not the books behind it). save_tax_year_depreciation writes a year in one go.

CREATE TABLE public.tax_year_depreciation (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  line_12 numeric(14,2) CHECK (line_12 >= 0),
  line_14 numeric(14,2) CHECK (line_14 >= 0),
  line_17 numeric(14,2) CHECK (line_17 >= 0),
  line_21 numeric(14,2) CHECK (line_21 >= 0),
  line_22 numeric(14,2) CHECK (line_22 >= 0),
  planned_179 numeric(14,2) CHECK (planned_179 >= 0),
  planned_bonus numeric(14,2) CHECK (planned_bonus >= 0),
  other_expected numeric(14,2) CHECK (other_expected >= 0),
  estimate_convention text NOT NULL DEFAULT 'HY' CHECK (estimate_convention IN ('HY', 'MQ')),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, year)
);
COMMENT ON TABLE public.tax_year_depreciation IS
  'Per organization and year: Form 4562 figures for a filed year, or planned amounts for the open year (#337).';

CREATE TABLE public.tax_year_depreciation_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  year smallint NOT NULL,
  recovery_years smallint NOT NULL CHECK (recovery_years IN (3, 5, 7, 10, 15, 20)),
  basis numeric(14,2) NOT NULL CHECK (basis >= 0),
  convention text NOT NULL CHECK (convention IN ('HY', 'MQ')),
  method text NOT NULL CHECK (method IN ('200DB', '150DB', 'SL')),
  deduction numeric(14,2) CHECK (deduction >= 0),
  FOREIGN KEY (organization_id, year) REFERENCES public.tax_year_depreciation(organization_id, year) ON DELETE CASCADE
);
COMMENT ON TABLE public.tax_year_depreciation_rows IS
  'A year''s Form 4562 line 19 rows (GDS 3-20 year property): basis, recovery period, convention, method, deduction (#337).';
CREATE INDEX tax_year_depreciation_rows_year_idx ON public.tax_year_depreciation_rows (organization_id, year);

-- Who saved a year's figures, and when: set here, not by the caller.
CREATE FUNCTION public.tax_year_depreciation_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tax_year_depreciation_stamp
  BEFORE INSERT OR UPDATE ON public.tax_year_depreciation
  FOR EACH ROW EXECUTE FUNCTION public.tax_year_depreciation_stamp();

ALTER TABLE public.tax_year_depreciation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and Managers see their org's depreciation" ON public.tax_year_depreciation
  FOR SELECT USING (public.user_is_admin_or_manager_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins add their org's depreciation" ON public.tax_year_depreciation
  FOR INSERT WITH CHECK (public.user_is_admin_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins change their org's depreciation" ON public.tax_year_depreciation
  FOR UPDATE USING (public.user_is_admin_of_org(organization_id, auth.uid()))
  WITH CHECK (public.user_is_admin_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins remove their org's depreciation" ON public.tax_year_depreciation
  FOR DELETE USING (public.user_is_admin_of_org(organization_id, auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_year_depreciation TO authenticated;

ALTER TABLE public.tax_year_depreciation_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and Managers see their org's depreciation rows" ON public.tax_year_depreciation_rows
  FOR SELECT USING (public.user_is_admin_or_manager_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins add their org's depreciation rows" ON public.tax_year_depreciation_rows
  FOR INSERT WITH CHECK (public.user_is_admin_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins change their org's depreciation rows" ON public.tax_year_depreciation_rows
  FOR UPDATE USING (public.user_is_admin_of_org(organization_id, auth.uid()))
  WITH CHECK (public.user_is_admin_of_org(organization_id, auth.uid()));
CREATE POLICY "Admins remove their org's depreciation rows" ON public.tax_year_depreciation_rows
  FOR DELETE USING (public.user_is_admin_of_org(organization_id, auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_year_depreciation_rows TO authenticated;

-- Saves a year's figures and replaces its rows in one transaction. SECURITY INVOKER on purpose: the
-- policies above decide who may, so a Manager or another org's Admin is refused as on the tables.
-- p_figures: { line_12, line_14, line_17, line_21, line_22, planned_179, planned_bonus,
-- other_expected, estimate_convention }; a key left out is saved blank (HY for the convention).
-- p_rows: [{ recovery_years, basis, convention, method, deduction }].
CREATE FUNCTION public.save_tax_year_depreciation(p_org uuid, p_year smallint, p_figures jsonb, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tax_year_depreciation AS d (organization_id, year, line_12, line_14, line_17, line_21, line_22,
    planned_179, planned_bonus, other_expected, estimate_convention)
  VALUES (p_org, p_year, (p_figures->>'line_12')::numeric, (p_figures->>'line_14')::numeric, (p_figures->>'line_17')::numeric,
    (p_figures->>'line_21')::numeric, (p_figures->>'line_22')::numeric, (p_figures->>'planned_179')::numeric,
    (p_figures->>'planned_bonus')::numeric, (p_figures->>'other_expected')::numeric,
    COALESCE(p_figures->>'estimate_convention', 'HY'))
  ON CONFLICT (organization_id, year) DO UPDATE SET
    line_12 = EXCLUDED.line_12, line_14 = EXCLUDED.line_14, line_17 = EXCLUDED.line_17,
    line_21 = EXCLUDED.line_21, line_22 = EXCLUDED.line_22, planned_179 = EXCLUDED.planned_179,
    planned_bonus = EXCLUDED.planned_bonus, other_expected = EXCLUDED.other_expected,
    estimate_convention = EXCLUDED.estimate_convention;

  DELETE FROM public.tax_year_depreciation_rows WHERE organization_id = p_org AND year = p_year;
  INSERT INTO public.tax_year_depreciation_rows (organization_id, year, recovery_years, basis, convention, method, deduction)
  SELECT p_org, p_year, (r->>'recovery_years')::smallint, (r->>'basis')::numeric, r->>'convention', r->>'method',
    (r->>'deduction')::numeric
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r;
END $$;
REVOKE EXECUTE ON FUNCTION public.save_tax_year_depreciation(uuid, smallint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tax_year_depreciation(uuid, smallint, jsonb, jsonb) TO authenticated;
