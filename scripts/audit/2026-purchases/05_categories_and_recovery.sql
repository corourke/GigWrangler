-- #135 item 5: categories and recovery periods against the category tables (read-only).
--   line category    a 2026 line with no category, or one that isn't one of the org's active
--                    expense categories (the shared defaults, if the org has none of its own yet)
--   equipment category  equipment on a 2026 line whose category isn't one of the org's active
--                    equipment categories
--   recovery period  equipment on a depreciated 2026 line with no recovery period, or one that
--                    differs from its category's default
-- Equipment on a line: records with purchase_line_id = the line, or the one purchases.asset_id names.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id, l.asset_id, l.tax_treatment,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         l.description, l.category
    FROM purchases l
    LEFT JOIN purchases h ON h.id = l.parent_id
    CROSS JOIN params p
   WHERE l.row_type = 'line'
     AND (p.org_id IS NULL OR l.organization_id = p.org_id)
     AND COALESCE(l.purchase_date, h.purchase_date) >= p.y_start
     AND COALESCE(l.purchase_date, h.purchase_date) <  p.y_end
), expense_names AS (
  SELECT o.organization_id, lower(btrim(c.name)) AS name
    FROM (SELECT DISTINCT organization_id FROM lines) o
    JOIN expense_categories c
      ON c.active AND (c.organization_id = o.organization_id
         OR (c.organization_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM expense_categories own WHERE own.organization_id = o.organization_id)))
), equipment AS (
  SELECT l.organization_id, l.invoice_id, l.line_id, l.line_date, l.vendor, l.tax_treatment,
         a.id AS asset_id, a.manufacturer_model, a.category AS asset_category, a.recovery_period,
         c.id AS category_id, c.default_recovery_period
    FROM lines l
    JOIN assets a ON a.purchase_line_id = l.line_id OR a.id = l.asset_id
    LEFT JOIN equipment_categories c
      ON c.organization_id = a.organization_id AND c.active AND lower(btrim(c.name)) = lower(btrim(a.category))
)
SELECT 'line category' AS finding, l.organization_id, l.invoice_id, l.line_id, NULL::uuid AS asset_id,
       l.line_date, l.vendor, l.description, l.category AS current_category, NULL::smallint AS recovery_period,
       NULL::smallint AS category_default,
       CASE WHEN NULLIF(btrim(l.category), '') IS NULL THEN 'Cameron decides (the line has no category)'
            ELSE 'Cameron decides (pick one of the org''s expense categories)' END AS suggested_action
  FROM lines l
 WHERE NOT EXISTS (SELECT 1 FROM expense_names e
                    WHERE e.organization_id = l.organization_id AND e.name = lower(btrim(l.category)))
UNION ALL
SELECT 'equipment category', organization_id, invoice_id, line_id, asset_id,
       line_date, vendor, manufacturer_model, asset_category, recovery_period, NULL,
       'Cameron decides (pick one of the org''s equipment categories)'
  FROM equipment WHERE category_id IS NULL
UNION ALL
SELECT 'recovery period', organization_id, invoice_id, line_id, asset_id,
       line_date, vendor, manufacturer_model, asset_category, recovery_period, default_recovery_period,
       CASE WHEN recovery_period IS NULL AND default_recovery_period IS NOT NULL
              THEN 'set recovery_period = ' || default_recovery_period
            WHEN recovery_period IS NULL THEN 'Cameron decides (the category has no default)'
            ELSE 'Cameron decides (differs from the category default)' END
  FROM equipment
 WHERE tax_treatment = 'depreciate'
   AND (recovery_period IS NULL OR recovery_period IS DISTINCT FROM default_recovery_period)
 ORDER BY 1, 2, 6, 4;
