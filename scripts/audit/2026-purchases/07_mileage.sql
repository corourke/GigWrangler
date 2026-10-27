-- #135 item 7 (#125 F1): mileage rows against the IRS rate on each trip's date (read-only).
-- The rate is $0.725 a mile through 2026-06-30 (IR-2025-128) and $0.76 from 2026-07-01
-- (IR-2026-29), the same table as IRS_MILEAGE_RATES in src/utils/financials.utils.ts. Expected =
-- miles × rate, rounded to the cent; recorded = amount_settled, else amount. Lists 2026 rows where
-- they differ, and mileage rows filed somewhere other than Car and truck expenses (line 9).
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), rates (rate_from, rate_to, rate) AS (
  VALUES (DATE '2026-01-01', DATE '2026-06-30', 0.725), (DATE '2026-07-01', DATE '2026-12-31', 0.76)
), trips AS (
  SELECT g.organization_id, g.id AS ledger_id, g.gig_id, g.date, g.description, g.category, g.stage,
         g.mileage, COALESCE(g.amount_settled, g.amount) AS recorded, r.rate,
         ROUND(g.mileage * r.rate, 2) AS expected
    FROM gig_financials g
    CROSS JOIN params p
    LEFT JOIN rates r ON g.date BETWEEN r.rate_from AND r.rate_to
   WHERE g.mileage IS NOT NULL
     AND (p.org_id IS NULL OR g.organization_id = p.org_id)
     AND g.date >= p.y_start AND g.date < p.y_end
)
SELECT CASE WHEN recorded IS DISTINCT FROM expected THEN 'amount' ELSE 'category' END AS finding,
       organization_id, ledger_id, gig_id, date, description, category, stage, mileage, rate,
       recorded, expected, ROUND(recorded - expected, 2) AS difference,
       CASE WHEN recorded IS DISTINCT FROM expected THEN 'set the amount to expected'
            ELSE 'set category = Car and truck expenses' END AS suggested_action
  FROM trips
 WHERE recorded IS DISTINCT FROM expected
    OR category IS DISTINCT FROM 'Car and truck expenses'
 ORDER BY organization_id, date, ledger_id;
