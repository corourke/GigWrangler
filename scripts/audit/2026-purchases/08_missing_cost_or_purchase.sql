-- #135 F6: equipment with no cost, or no purchase link (read-only, every year).
--   no cost          item_cost is empty or 0
--   no purchase      not on a purchase line (purchase_line_id), not on an invoice (purchase_id),
--                    and not the record a line's asset_id names: owned before, or never linked
-- A piece split off a lot (write-off or maintenance) is listed with the lot it came from.
WITH params AS (
  SELECT NULL::uuid AS org_id
), equipment AS (
  SELECT a.* FROM assets a CROSS JOIN params p
   WHERE p.org_id IS NULL OR a.organization_id = p.org_id
)
SELECT 'no cost' AS finding, organization_id, id AS asset_id, manufacturer_model, category, status, quantity,
       acquisition_date, item_cost, purchase_line_id, purchase_id,
       COALESCE(written_off_from, maintenance_from) AS split_from,
       'Cameron decides (enter the cost)' AS suggested_action
  FROM equipment WHERE COALESCE(item_cost, 0) = 0
UNION ALL
SELECT 'no purchase', e.organization_id, e.id, e.manufacturer_model, e.category, e.status, e.quantity,
       e.acquisition_date, e.item_cost, e.purchase_line_id, e.purchase_id,
       COALESCE(e.written_off_from, e.maintenance_from),
       'Cameron decides (link it to its purchase line, or note it as owned before)'
  FROM equipment e
 WHERE e.purchase_line_id IS NULL AND e.purchase_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM purchases l WHERE l.asset_id = e.id)
 ORDER BY 1, 2, 8, 3;
