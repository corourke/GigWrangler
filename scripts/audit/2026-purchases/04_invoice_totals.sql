-- #135 item 4: invoice totals equal their lines (read-only).
-- 2026 invoices (headers) whose total_inv_amount differs from the sum of their lines' cost
-- (line_cost, else item_cost × quantity) by more than $0.01, as in the 2025 fixes. An invoice with
-- no total, or with no lines, is listed too.
WITH params AS (
  SELECT NULL::uuid AS org_id, DATE '2026-01-01' AS y_start, DATE '2027-01-01' AS y_end
), invoices AS (
  SELECT h.organization_id, h.id AS invoice_id, h.purchase_date, h.vendor, h.description,
         h.total_inv_amount,
         count(l.id) AS lines,
         ROUND(COALESCE(sum(COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1))), 0), 2) AS lines_total
    FROM purchases h
    LEFT JOIN purchases l ON l.parent_id = h.id AND l.row_type = 'line'
    CROSS JOIN params p
   WHERE h.row_type = 'header'
     AND (p.org_id IS NULL OR h.organization_id = p.org_id)
     AND h.purchase_date >= p.y_start AND h.purchase_date < p.y_end
   GROUP BY h.id
)
SELECT organization_id, invoice_id, purchase_date, vendor, description, lines,
       total_inv_amount, lines_total, ROUND(total_inv_amount - lines_total, 2) AS difference,
       CASE WHEN lines = 0 THEN 'Cameron decides (an invoice with no lines)'
            WHEN total_inv_amount IS NULL THEN 'set total_inv_amount = lines_total'
            ELSE 'Cameron decides (fix the total, or a line''s cost)' END AS suggested_action
  FROM invoices
 WHERE lines = 0 OR total_inv_amount IS NULL OR ABS(total_inv_amount - lines_total) > 0.01
 ORDER BY organization_id, purchase_date, invoice_id;
