-- Every gig money row belongs to an organization (A20): organization_id is NOT NULL, so a row
-- can't be orphaned outside every organization's view.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

SELECT rls_test.expect('organization_id is required',
  (SELECT count(*)::int FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'gig_financials' AND column_name = 'organization_id'
     AND is_nullable = 'NO'), 1);

DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.gig_financials (gig_id, organization_id, direction, stage, amount, date, created_by)
    VALUES (rls_test.u('gig'), NULL, 'in', 'accepted', 10, current_date, rls_test.u('a_admin'));
  EXCEPTION WHEN not_null_violation THEN ok := true;
  END;
  PERFORM rls_test.expect('A row with no organization is refused', CASE WHEN ok THEN 1 ELSE 0 END, 1);
END $$;
