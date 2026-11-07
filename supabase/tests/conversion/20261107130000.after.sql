DO $$
BEGIN
  IF (SELECT purchase_id FROM public.gig_financials WHERE id = '00000000-0000-0000-0000-0000000d0101')
     IS DISTINCT FROM '00000000-0000-0000-0000-0000000d0012'::uuid THEN
    RAISE EXCEPTION 'A linked gig expense stays linked';
  END IF;
  IF (SELECT count(*) FROM public.gig_financials WHERE id IN ('00000000-0000-0000-0000-0000000d0101', '00000000-0000-0000-0000-0000000d0102')) <> 2 THEN
    RAISE EXCEPTION 'No gig money is removed by the migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gig_financials'::regclass
                 AND conname = 'gig_financials_purchase_id_fkey' AND confdeltype = 'c' AND convalidated) THEN
    RAISE EXCEPTION 'The purchase link deletes with the purchase';
  END IF;
  RAISE NOTICE 'purchase link conversion: ok';
END $$;
