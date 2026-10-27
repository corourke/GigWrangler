-- #135 item 3: gig expense links (read-only). One row per finding:
--   double count     more than one ledger row points at the same purchase line (each row listed)
--   whole invoice    a ledger row points at an invoice header, not a line (#130)
--   other gig        a ledger row points at a line booked to a different gig, or to none
--   no ledger row    a line booked to a gig has no ledger row pointing at it
--   not expensed     a ledger row points at a depreciated line (only expensed lines are gig expenses)
--   no purchase link a 2026 money-out row (not mileage, not staff pay) with no purchase_id; it may
--                    be a real non-purchase expense, so Cameron decides
-- 2026 means the line's date (else its invoice's); for an unlinked ledger row, the row's date.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), rows AS (
  SELECT p.id, p.organization_id, p.row_type, p.parent_id, p.gig_id, p.tax_treatment, p.description,
         COALESCE(p.vendor, h.vendor) AS vendor, COALESCE(p.purchase_date, h.purchase_date) AS row_date
    FROM purchases p
    LEFT JOIN purchases h ON h.id = p.parent_id
    CROSS JOIN params x
   WHERE (x.org_id IS NULL OR p.organization_id = x.org_id)
     AND COALESCE(p.purchase_date, h.purchase_date) >= x.y_start
     AND COALESCE(p.purchase_date, h.purchase_date) <  x.y_end
), linked AS (
  SELECT g.id AS ledger_id, g.gig_id AS ledger_gig_id, g.amount, g.amount_settled, g.stage, r.*,
         count(*) OVER (PARTITION BY g.purchase_id) AS rows_for_purchase
    FROM gig_financials g
    JOIN rows r ON r.id = g.purchase_id
)
SELECT 'double count' AS finding, organization_id, CASE WHEN row_type = 'header' THEN id ELSE parent_id END AS invoice_id,
       CASE WHEN row_type = 'line' THEN id END AS line_id, ledger_id, ledger_gig_id, gig_id AS line_gig_id,
       row_date, vendor, description, tax_treatment, amount, amount_settled, stage,
       'Cameron decides (keep one ledger row for the line)' AS suggested_action
  FROM linked WHERE row_type = 'line' AND rows_for_purchase > 1
UNION ALL
SELECT 'whole invoice', organization_id, id, NULL, ledger_id, ledger_gig_id, NULL,
       row_date, vendor, description, NULL, amount, amount_settled, stage,
       'Cameron decides (point the ledger row at the invoice''s gig line, or remove it)'
  FROM linked WHERE row_type = 'header'
UNION ALL
SELECT 'other gig', organization_id, parent_id, id, ledger_id, ledger_gig_id, gig_id,
       row_date, vendor, description, tax_treatment, amount, amount_settled, stage,
       'Cameron decides (the line and its ledger row name different gigs)'
  FROM linked WHERE row_type = 'line' AND gig_id IS DISTINCT FROM ledger_gig_id
   AND tax_treatment IS DISTINCT FROM 'depreciate'  -- that's 'not expensed' below
UNION ALL
SELECT 'not expensed', organization_id, parent_id, id, ledger_id, ledger_gig_id, gig_id,
       row_date, vendor, description, tax_treatment, amount, amount_settled, stage,
       'Cameron decides (remove the gig expense row, or expense the line)'
  FROM linked WHERE row_type = 'line' AND tax_treatment = 'depreciate'
UNION ALL
SELECT 'no ledger row', r.organization_id, r.parent_id, r.id, NULL, NULL, r.gig_id,
       r.row_date, r.vendor, r.description, r.tax_treatment, NULL, NULL, NULL,
       'create the line''s gig expense row'
  FROM rows r
 WHERE r.row_type = 'line' AND r.gig_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM gig_financials g WHERE g.purchase_id = r.id)
UNION ALL
SELECT 'no purchase link', g.organization_id, NULL, NULL, g.id, g.gig_id, NULL,
       g.date, g.external_entity_name, g.description, NULL, g.amount, g.amount_settled, g.stage,
       'Cameron decides (link to a purchase line, or leave as a non-purchase expense)'
  FROM gig_financials g CROSS JOIN params x
 WHERE (x.org_id IS NULL OR g.organization_id = x.org_id)
   AND g.direction = 'out' AND g.purchase_id IS NULL AND g.mileage IS NULL AND g.staff_assignment_id IS NULL
   AND g.date >= x.y_start AND g.date < x.y_end
 ORDER BY 1, 2, 8, 5;
