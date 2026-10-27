-- #135 F4: depreciable equipment cost (basis) per tax year, one row per record behind each total
-- (read-only). Same rule as the Assets report (src/utils/taxReports.ts buildAssetReport):
-- depreciated lines whose own date (else their invoice's) is in the year; a line's cost is
-- line_cost, else item_cost × quantity; each record's share is cut by its pieces from a running
-- total in id order, so a line's records always add up to the line. A depreciated line with no
-- record is one row with no asset_id. year_total is the sum for the year and organization; the
-- coordinator compares it with the filed return privately (filed figures never go in the repo).
WITH params AS (
  SELECT NULL::uuid AS org_id
), lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id, l.asset_id AS line_asset_id,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         l.description, COALESCE(NULLIF(l.quantity, 0), 1) AS quantity,
         ROUND(COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)), 2) AS line_cost
    FROM purchases l
    LEFT JOIN purchases h ON h.id = l.parent_id
    CROSS JOIN params p
   WHERE l.row_type = 'line' AND l.tax_treatment = 'depreciate'
     AND (p.org_id IS NULL OR l.organization_id = p.org_id)
     AND EXTRACT(YEAR FROM COALESCE(l.purchase_date, h.purchase_date)) IN (2024, 2025, 2026)
), records AS (
  SELECT l.*, a.id AS asset_id, a.manufacturer_model, a.category, a.recovery_period, a.status,
         COALESCE(a.quantity, 1) AS pieces,
         sum(COALESCE(a.quantity, 1)) OVER (PARTITION BY l.line_id ORDER BY a.id) AS pieces_after
    FROM lines l
    LEFT JOIN assets a ON a.purchase_line_id = l.line_id OR a.id = l.line_asset_id
), shares AS (
  SELECT r.*, EXTRACT(YEAR FROM r.line_date)::int AS tax_year,
         CASE WHEN r.asset_id IS NULL THEN r.line_cost
              ELSE ROUND(r.line_cost * r.pieces_after / r.quantity, 2)
                 - ROUND(r.line_cost * (r.pieces_after - r.pieces) / r.quantity, 2) END AS record_cost
    FROM records r
)
SELECT tax_year, organization_id, invoice_id, line_id, asset_id, line_date, vendor,
       COALESCE(manufacturer_model, description) AS description, category, recovery_period, status,
       quantity AS line_quantity, CASE WHEN asset_id IS NULL THEN NULL ELSE pieces END AS pieces,
       line_cost, record_cost,
       sum(record_cost) OVER (PARTITION BY tax_year, organization_id) AS year_total,
       CASE WHEN asset_id IS NULL THEN 'Cameron decides (a depreciated line with no equipment record)' END AS suggested_action
  FROM shares
 ORDER BY tax_year, organization_id, line_date, line_id, asset_id;
