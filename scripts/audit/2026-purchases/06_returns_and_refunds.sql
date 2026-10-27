-- #135 item 6 and F5: returns, refunds and equipment status (read-only).
--   returned, no date / refund  equipment Returned or Disposed with no retired_on, or no
--                    liquidation_amt (the refund or sale proceeds, net of return shipping)
--   active, retired  equipment Active with a retired_on date
--   inactive         equipment Inactive, to be kept, disposed or returned
--   return line      a 2026 line with a negative cost that isn't expensed (a refund of an expensed
--                    item is a negative expense line on a return invoice, as in the 2025 fixes)
--   return invoice   a 2026 invoice with a negative total, to check its refund is recorded
-- The equipment checks cover every year (F5); the purchase checks cover 2026. A return that was
-- never entered, or one paid as store credit, can't be found from the data: see README.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), equipment AS (
  SELECT a.* FROM assets a CROSS JOIN params p
   WHERE p.org_id IS NULL OR a.organization_id = p.org_id
), lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id, l.tax_treatment, l.description,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         ROUND(COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)), 2) AS line_cost
    FROM purchases l
    LEFT JOIN purchases h ON h.id = l.parent_id
    CROSS JOIN params p
   WHERE l.row_type = 'line'
     AND (p.org_id IS NULL OR l.organization_id = p.org_id)
     AND COALESCE(l.purchase_date, h.purchase_date) >= p.y_start
     AND COALESCE(l.purchase_date, h.purchase_date) <  p.y_end
)
SELECT 'returned, no date / refund' AS finding, organization_id, purchase_id AS invoice_id, purchase_line_id AS line_id,
       id AS asset_id, manufacturer_model AS description, status, acquisition_date AS dated, retired_on,
       liquidation_amt AS amount,
       'Cameron decides (enter ' || concat_ws(' and ', CASE WHEN retired_on IS NULL THEN 'the date' END,
                                                       CASE WHEN liquidation_amt IS NULL THEN 'the refund' END) || ')' AS suggested_action
  FROM equipment WHERE status IN ('Returned', 'Disposed') AND (retired_on IS NULL OR liquidation_amt IS NULL)
UNION ALL
SELECT 'active, retired', organization_id, purchase_id, purchase_line_id, id, manufacturer_model, status,
       acquisition_date, retired_on, liquidation_amt,
       'Cameron decides (clear the date, or mark it Returned or Disposed)'
  FROM equipment WHERE status = 'Active' AND retired_on IS NOT NULL
UNION ALL
SELECT 'inactive', organization_id, purchase_id, purchase_line_id, id, manufacturer_model, status,
       acquisition_date, retired_on, liquidation_amt,
       'Cameron decides (keep Inactive, or mark it Returned or Disposed)'
  FROM equipment WHERE status = 'Inactive'
UNION ALL
SELECT 'return line', organization_id, invoice_id, line_id, NULL, description, tax_treatment, line_date, NULL,
       line_cost, 'set tax_treatment = expense'
  FROM lines WHERE line_cost < 0 AND tax_treatment IS DISTINCT FROM 'expense'
UNION ALL
SELECT 'return invoice', h.organization_id, h.id, NULL, NULL, COALESCE(h.description, h.vendor), NULL, h.purchase_date, NULL,
       h.total_inv_amount, 'Cameron decides (check the refund is recorded)'
  FROM purchases h CROSS JOIN params p
 WHERE h.row_type = 'header' AND h.total_inv_amount < 0
   AND (p.org_id IS NULL OR h.organization_id = p.org_id)
   AND h.purchase_date >= p.y_start AND h.purchase_date < p.y_end
 ORDER BY 1, 2, 8, 5;
