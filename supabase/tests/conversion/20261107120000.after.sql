SET TimeZone = 'America/Los_Angeles';
DO $$
BEGIN
  IF (SELECT tax_date FROM public.gig_financials WHERE id = '00000000-0000-0000-0000-0000000c0101') IS DISTINCT FROM '2026-01-01'::date THEN
    RAISE EXCEPTION 'A typed day stays that day';
  END IF;
  IF (SELECT tax_date FROM public.gig_financials WHERE id = '00000000-0000-0000-0000-0000000c0102') IS DISTINCT FROM '2026-03-04'::date THEN
    RAISE EXCEPTION 'A stamped moment takes its UTC day';
  END IF;
  IF (SELECT tax_date FROM public.gig_financials WHERE id = '00000000-0000-0000-0000-0000000c0103') IS DISTINCT FROM '2025-11-15'::date THEN
    RAISE EXCEPTION 'An unpaid row takes its date';
  END IF;
  IF (SELECT count(*) FROM public.gig_financials WHERE paid_at IS NOT NULL AND tax_date IS NULL) <> 0 THEN
    RAISE EXCEPTION 'Every paid row has a tax date';
  END IF;
  RAISE NOTICE 'tax_date conversion: ok';
END $$;
