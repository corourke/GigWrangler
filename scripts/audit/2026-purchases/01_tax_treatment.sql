-- #135 item 1: tax treatment against the #133 rule (read-only).
-- Per-item cost (item_cost, else line cost / quantity) under $200 → expense; over $2,500 →
-- depreciate; $200 to $2,500 inclusive is Cameron's call. Lists 2026 lines that break the rule,
-- and every grey-zone line whatever its treatment. A depreciated line can't be linked to a gig,
-- so gig_id / gig_rows show what an expense → depreciate change would have to undo first.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         l.description, l.category, l.quantity, l.tax_treatment, l.gig_id,
         ROUND(COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)), 2) AS line_cost,
         ROUND(COALESCE(l.item_cost,
           COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)) / COALESCE(NULLIF(l.quantity, 0), 1)), 2) AS item_cost
    FROM purchases l
    LEFT JOIN purchases h ON h.id = l.parent_id
    CROSS JOIN params p
   WHERE l.row_type = 'line'
     AND (p.org_id IS NULL OR l.organization_id = p.org_id)
     AND COALESCE(l.purchase_date, h.purchase_date) >= p.y_start
     AND COALESCE(l.purchase_date, h.purchase_date) <  p.y_end
)
SELECT l.organization_id, l.invoice_id, l.line_id, l.line_date, l.vendor, l.description, l.category,
       l.quantity, l.item_cost, l.line_cost, l.tax_treatment, l.gig_id,
       (SELECT count(*) FROM gig_financials g WHERE g.purchase_id = l.line_id) AS gig_rows,
       CASE
         WHEN l.item_cost < 200 THEN 'set tax_treatment = expense'
         WHEN l.item_cost > 2500 THEN 'set tax_treatment = depreciate'
         ELSE 'Cameron decides (grey zone $200–$2,500; now ' || l.tax_treatment || ')'
       END AS suggested_action
  FROM lines l
 WHERE (l.item_cost < 200 AND l.tax_treatment IS DISTINCT FROM 'expense')
    OR (l.item_cost > 2500 AND l.tax_treatment IS DISTINCT FROM 'depreciate')
    OR (l.item_cost BETWEEN 200 AND 2500)
 ORDER BY l.organization_id, l.line_date, l.line_id;
