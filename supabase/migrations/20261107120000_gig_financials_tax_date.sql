-- B1/B24/B17 (plan approved by Cameron, 11-07): one tax date for gig money.
--
-- A payment date is a calendar day typed in the app, stored in paid_at (timestamptz) as
-- midnight UTC. The reports read it in the viewer's zone (so Jan 1 fell in the previous
-- year west of UTC), and the filed-year lock went by the row's own date instead. Now both
-- go by tax_date: paid_at's UTC day for a paid row, else the row's date. No data changes.

-- 1. The rule, in one place (the column and the lock both use it).
CREATE OR REPLACE FUNCTION public.gig_financial_tax_date(p_paid_at timestamptz, p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$ SELECT COALESCE((p_paid_at AT TIME ZONE 'UTC')::date, p_date) $$;

COMMENT ON FUNCTION public.gig_financial_tax_date(timestamptz, date) IS
  'The tax date of gig money: the paid day (paid_at''s UTC date), else the row''s date.';

-- 2. The column the reports read.
ALTER TABLE public.gig_financials
  ADD COLUMN tax_date date GENERATED ALWAYS AS (public.gig_financial_tax_date(paid_at, date)) STORED;

COMMENT ON COLUMN public.gig_financials.tax_date IS
  'The day this money counts for taxes: paid_at''s UTC date when paid, else date. Reports and the filed-year lock use it.';

-- 3. The filed-year lock goes by it. Generated columns are not computed yet in a BEFORE
--    trigger, so the trigger applies the same function to NEW.
CREATE OR REPLACE FUNCTION public.gig_financials_enforce_tax_year_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_old boolean := false;
  v_new boolean := false;
  v_old_day date;
  v_new_day date;
BEGIN
  -- Tax data: income, and expenses not linked to a purchase line.
  IF TG_OP <> 'INSERT' THEN
    v_old_day := public.gig_financial_tax_date(OLD.paid_at, OLD.date);
    v_old := (OLD.direction = 'in' OR OLD.purchase_id IS NULL)
             AND public.tax_year_is_locked(OLD.organization_id, v_old_day);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_day := public.gig_financial_tax_date(NEW.paid_at, NEW.date);
    v_new := (NEW.direction = 'in' OR NEW.purchase_id IS NULL)
             AND public.tax_year_is_locked(NEW.organization_id, v_new_day);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new THEN
      RAISE EXCEPTION 'The % tax year is locked (filed), so no gig income or expenses can be added to it.',
        extract(year FROM v_new_day) USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF v_old THEN
      RAISE EXCEPTION 'The % tax year is locked (filed), so its gig income and expenses can''t be deleted.',
        extract(year FROM v_old_day) USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF (v_old OR v_new)
     AND (NEW.organization_id, NEW.direction, NEW.stage, NEW.amount, NEW.amount_settled, NEW.currency,
          NEW.date, NEW.paid_at, NEW.category, NEW.mileage, NEW.purchase_id)
         IS DISTINCT FROM
         (OLD.organization_id, OLD.direction, OLD.stage, OLD.amount, OLD.amount_settled, OLD.currency,
          OLD.date, OLD.paid_at, OLD.category, OLD.mileage, OLD.purchase_id) THEN
    RAISE EXCEPTION 'The % tax year is locked (filed): this gig income or expense''s amount, date, category and status can''t change. Notes and descriptions still can.',
      extract(year FROM CASE WHEN v_old THEN v_old_day ELSE v_new_day END) USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
