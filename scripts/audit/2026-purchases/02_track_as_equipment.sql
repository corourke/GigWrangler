-- #135 item 2: track-as-equipment candidates (read-only).
-- Every 2026 line, with whether it's tracked as equipment (records on the line: purchase_line_id,
-- or the record purchases.asset_id names) and how many records and pieces it has. Untracked lines
-- filed under an equipment category, or costing $200 or more per item, sort first. Tracking is
-- Cameron's call per line, whatever the tax treatment.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id, l.asset_id,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         l.description, l.category, l.quantity, l.tax_treatment,
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
), tracked AS (
  SELECT l.line_id, count(a.id) AS records, COALESCE(sum(COALESCE(a.quantity, 1)), 0) AS pieces
    FROM lines l
    LEFT JOIN assets a ON a.purchase_line_id = l.line_id OR a.id = l.asset_id
   GROUP BY l.line_id
)
SELECT l.organization_id, l.invoice_id, l.line_id, l.line_date, l.vendor, l.description, l.category,
       l.quantity, l.item_cost, l.line_cost, l.tax_treatment,
       t.records > 0 AS tracked, t.records, t.pieces,
       EXISTS (SELECT 1 FROM equipment_categories c
                WHERE c.organization_id = l.organization_id AND c.active
                  AND lower(btrim(c.name)) = lower(btrim(l.category))) AS equipment_category,
       'Cameron decides' AS suggested_action
  FROM lines l
  JOIN tracked t USING (line_id)
 ORDER BY (t.records = 0 AND (l.item_cost >= 200 OR EXISTS (
            SELECT 1 FROM equipment_categories c
             WHERE c.organization_id = l.organization_id AND c.active
               AND lower(btrim(c.name)) = lower(btrim(l.category))))) DESC,
          l.organization_id, l.line_date, l.line_id;
