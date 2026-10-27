-- #135 fix, apply. Changes exactly the rows preview.sql lists, in one transaction.
-- It runs preview.sql's query word for word (between the PLAN markers; test/run.sh checks the
-- two copies match), so the same guards stop it. Then it:
--   - snapshots purchases and assets,
--   - sets the step 1-3 lines to expense and the step 4 line costs, each UPDATE also matching the
--     row's current value and required to change exactly the planned rows,
--   - compares every purchase and equipment row with the snapshot: the changed values must be
--     exactly the plan's, including the recovery periods the triggers clear,
--   - shows each changed row, current and new.
-- Saving: the flag below is 'false', so a run does all of this and then rolls back with
-- "Dry run: nothing was saved." Set it to 'true' only with Cameron's OK.
-- Fill in the run-time values block the same way as in preview.sql.
BEGIN;
SELECT set_config('fix135.save', 'false', true);  -- 'true' saves the changes

CREATE TEMP TABLE fix_plan ON COMMIT DROP AS
-- >>> PLAN (same as preview.sql)
WITH
-- >>> RUN-TIME VALUES
expected (step1_lines, step2_lines, step3_lines) AS (VALUES (NULL::int, NULL::int, NULL::int)),
resale_invoices (invoice_id) AS (VALUES (NULL::uuid)),
cents_fixes (invoice_id, expected_difference) AS (VALUES (NULL::uuid, NULL::numeric)),
-- <<< RUN-TIME VALUES
lines AS (
  SELECT l.organization_id, l.parent_id AS invoice_id, l.id AS line_id, l.asset_id,
         COALESCE(l.purchase_date, h.purchase_date) AS line_date, COALESCE(l.vendor, h.vendor) AS vendor,
         l.description, l.tax_treatment, l.line_cost AS line_cost_column,
         ROUND(COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)), 2) AS line_cost,
         ROUND(COALESCE(l.item_cost,
           COALESCE(l.line_cost, COALESCE(l.item_cost, 0) * COALESCE(l.quantity, 1)) / COALESCE(NULLIF(l.quantity, 0), 1)), 2) AS item_cost
    FROM purchases l
    LEFT JOIN purchases h ON h.id = l.parent_id
   WHERE l.row_type = 'line'
), to_expense AS (
  SELECT 1 AS step, l.* FROM lines l
   WHERE l.line_date >= DATE '2026-01-01' AND l.line_date < DATE '2027-01-01'
     AND l.tax_treatment = 'depreciate' AND l.item_cost < 200
  UNION ALL
  SELECT 2, l.* FROM lines l
   WHERE l.line_date >= DATE '2026-01-01' AND l.line_date < DATE '2027-01-01'
     AND l.tax_treatment = 'depreciate' AND l.item_cost BETWEEN 200 AND 2500
  UNION ALL
  SELECT 3, l.* FROM lines l
   WHERE l.invoice_id IN (SELECT invoice_id FROM resale_invoices)
     AND l.tax_treatment IS DISTINCT FROM 'expense'
     AND NOT (l.line_date >= DATE '2026-01-01' AND l.line_date < DATE '2027-01-01'
              AND l.tax_treatment = 'depreciate' AND l.item_cost <= 2500)
), cents AS (
  SELECT c.invoice_id, c.expected_difference, h.organization_id, h.total_inv_amount,
         ROUND(h.total_inv_amount - (SELECT ROUND(COALESCE(sum(l.line_cost), 0), 2) FROM lines l WHERE l.invoice_id = c.invoice_id), 2) AS difference,
         (SELECT l.line_id FROM lines l WHERE l.invoice_id = c.invoice_id
           ORDER BY l.line_cost DESC, l.line_id LIMIT 1) AS line_id
    FROM cents_fixes c
    LEFT JOIN purchases h ON h.id = c.invoice_id AND h.row_type = 'header'
), recovery AS (
  -- What purchases_sync_asset_recovery_period does once the lines are expensed: equipment on a
  -- changed line (its purchase_line_id, or the line's asset_id) loses its period unless a
  -- depreciated line this fix doesn't change still covers it.
  SELECT DISTINCT a.id AS asset_id, a.organization_id, a.recovery_period, a.manufacturer_model
    FROM assets a
    JOIN to_expense t ON t.line_id = a.purchase_line_id OR t.asset_id = a.id
   WHERE a.recovery_period IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM purchases o
                      WHERE o.tax_treatment = 'depreciate'
                        AND (o.id = a.purchase_line_id OR o.asset_id = a.id)
                        AND o.id NOT IN (SELECT line_id FROM to_expense))
), problems (problem) AS (
  SELECT 'fill in the run-time values (expected counts)'
    FROM expected WHERE step1_lines IS NULL OR step2_lines IS NULL OR step3_lines IS NULL
  UNION ALL
  SELECT format('step %s finds %s lines, expected %s', s.step, (SELECT count(*) FROM to_expense t WHERE t.step = s.step), s.want)
    FROM expected e, LATERAL (VALUES (1, e.step1_lines), (2, e.step2_lines), (3, e.step3_lines)) s (step, want)
   WHERE s.want IS NOT NULL AND (SELECT count(*) FROM to_expense t WHERE t.step = s.step) <> s.want
  UNION ALL
  SELECT format('resale invoice %s is not an invoice', COALESCE(r.invoice_id::text, '(placeholder)'))
    FROM resale_invoices r
   WHERE NOT EXISTS (SELECT 1 FROM purchases h WHERE h.id = r.invoice_id AND h.row_type = 'header')
  UNION ALL
  SELECT format('invoice %s to even up is not an invoice with lines', COALESCE(c.invoice_id::text, '(placeholder)'))
    FROM cents c WHERE c.organization_id IS NULL OR c.line_id IS NULL
  UNION ALL
  SELECT format('invoice %s: lines are off by %s, expected %s', c.invoice_id, c.difference, COALESCE(c.expected_difference::text, '(placeholder)'))
    FROM cents c
   WHERE c.line_id IS NOT NULL AND c.difference IS DISTINCT FROM c.expected_difference
  UNION ALL
  SELECT format('invoice %s: its largest line is depreciated with no equipment record, so it can''t be saved', c.invoice_id)
    FROM cents c JOIN purchases l ON l.id = c.line_id
   WHERE l.tax_treatment = 'depreciate' AND l.asset_id IS NULL
     AND l.id NOT IN (SELECT line_id FROM to_expense)
  UNION ALL
  SELECT format('the %s tax year is locked for organization %s', extract(year FROM x.line_date), x.organization_id)
    FROM (SELECT organization_id, line_date FROM to_expense
          UNION SELECT l.organization_id, l.line_date FROM cents c JOIN lines l ON l.line_id = c.line_id) x
   WHERE public.tax_year_is_locked(x.organization_id, x.line_date)
  UNION ALL
  SELECT 'a 2026 depreciated line at $2,500 or less would be left'
    FROM lines l
   WHERE l.line_date >= DATE '2026-01-01' AND l.line_date < DATE '2027-01-01'
     AND l.tax_treatment = 'depreciate' AND l.item_cost <= 2500
     AND l.line_id NOT IN (SELECT line_id FROM to_expense)
), guard AS (
  SELECT CASE WHEN count(*) = 0 THEN 'all checks passed'
              ELSE ('STOP: ' || string_agg(problem, '; '))::int::text END AS checks
    FROM problems
), plan AS (
  SELECT t.step::text AS step, 'purchases' AS table_name, t.line_id AS row_id, t.organization_id,
         t.invoice_id, t.line_date, t.vendor, t.description, t.item_cost, t.line_cost,
         'tax_treatment' AS field, t.tax_treatment AS current_value, 'expense' AS new_value
    FROM to_expense t
  UNION ALL
  SELECT '4', 'purchases', l.line_id, l.organization_id, l.invoice_id, l.line_date, l.vendor,
         l.description, l.item_cost, l.line_cost,
         'line_cost', l.line_cost_column::text, (l.line_cost + c.difference)::numeric(12, 2)::text
    FROM cents c JOIN lines l ON l.line_id = c.line_id
   WHERE c.difference <> 0
  UNION ALL
  SELECT 'T', 'assets', r.asset_id, r.organization_id, NULL, NULL, NULL, r.manufacturer_model, NULL, NULL,
         'recovery_period', r.recovery_period::text, NULL
    FROM recovery r
)
SELECT g.checks, p.*
  FROM guard g
  LEFT JOIN plan p ON true
 ORDER BY p.step, p.organization_id, p.line_date, p.row_id, p.field
-- <<< PLAN
;
DELETE FROM fix_plan WHERE row_id IS NULL;  -- the guard's row when nothing is planned

CREATE TEMP TABLE fix_before ON COMMIT DROP AS
  SELECT 'purchases' AS table_name, id AS row_id, to_jsonb(p) - 'updated_at' AS row_data FROM purchases p
  UNION ALL
  SELECT 'assets', id, to_jsonb(a) - 'updated_at' FROM assets a;

DO $fix$
DECLARE
  v_want int;
  v_done int;
BEGIN
  SELECT count(*) INTO v_want FROM fix_plan WHERE table_name = 'purchases' AND field = 'tax_treatment';
  UPDATE purchases p SET tax_treatment = 'expense'
    FROM fix_plan f
   WHERE f.table_name = 'purchases' AND f.field = 'tax_treatment' AND p.id = f.row_id
     AND p.tax_treatment IS NOT DISTINCT FROM f.current_value;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_want THEN
    RAISE EXCEPTION 'STOP: % lines set to expense, planned %', v_done, v_want;
  END IF;

  SELECT count(*) INTO v_want FROM fix_plan WHERE table_name = 'purchases' AND field = 'line_cost';
  UPDATE purchases p SET line_cost = f.new_value::numeric
    FROM fix_plan f
   WHERE f.table_name = 'purchases' AND f.field = 'line_cost' AND p.id = f.row_id
     AND p.line_cost IS NOT DISTINCT FROM f.current_value::numeric;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  IF v_done <> v_want THEN
    RAISE EXCEPTION 'STOP: % line costs changed, planned %', v_done, v_want;
  END IF;

  -- Every value that changed, against the plan (both ways).
  CREATE TEMP TABLE fix_changed ON COMMIT DROP AS
    SELECT b.table_name, b.row_id, k.key AS field, b.row_data ->> k.key AS current_value, n.row_data ->> k.key AS new_value
      FROM fix_before b
      JOIN (SELECT 'purchases' AS table_name, id AS row_id, to_jsonb(p) - 'updated_at' AS row_data FROM purchases p
            UNION ALL
            SELECT 'assets', id, to_jsonb(a) - 'updated_at' FROM assets a) n
        ON n.table_name = b.table_name AND n.row_id = b.row_id
      CROSS JOIN LATERAL jsonb_object_keys(b.row_data) k (key)
     WHERE (b.row_data -> k.key) IS DISTINCT FROM (n.row_data -> k.key);
  IF EXISTS (SELECT table_name, row_id FROM fix_before
             EXCEPT SELECT table_name, row_id FROM (SELECT 'purchases', id FROM purchases UNION ALL SELECT 'assets', id FROM assets) x (table_name, row_id))
     OR (SELECT count(*) FROM purchases) + (SELECT count(*) FROM assets) <> (SELECT count(*) FROM fix_before) THEN
    RAISE EXCEPTION 'STOP: rows were added or removed';
  END IF;
  IF EXISTS (
       (SELECT table_name, row_id, field, new_value FROM fix_changed
        EXCEPT SELECT table_name, row_id, field, new_value FROM fix_plan)
       UNION ALL
       (SELECT table_name, row_id, field, new_value FROM fix_plan
        EXCEPT SELECT table_name, row_id, field, new_value FROM fix_changed)) THEN
    RAISE EXCEPTION 'STOP: the changed values differ from the plan';
  END IF;
END
$fix$;

SELECT f.step, f.table_name, f.row_id, f.organization_id, f.invoice_id, f.line_date, f.vendor,
       f.description, f.field, f.current_value, c.new_value AS saved_value
  FROM fix_plan f
  JOIN fix_changed c USING (table_name, row_id, field)
 ORDER BY f.step, f.organization_id, f.line_date, f.row_id, f.field;

DO $save$
BEGIN
  IF current_setting('fix135.save', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Dry run: nothing was saved. Set fix135.save to ''true'' to save.';
  END IF;
END
$save$;
COMMIT;
