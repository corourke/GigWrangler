-- Schedule C line 4, cost of goods sold (#321). Goods bought for resale are worked out in
-- Part III and come off gross receipts on line 4, apart from the Part II expenses (lines 8-27b).
-- Adding the line lets an expense category use it (the foreign key from
-- expense_categories.schedule_c_line); the reports keep it out of the Part II totals.
-- Inventory (Part III lines 35-41) isn't tracked: resale purchases count in the year paid.
INSERT INTO public.schedule_c_lines (code, label, sort_order) VALUES
  ('4', 'Cost of goods sold (Part III)', 4)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE public.schedule_c_lines IS
  'IRS Schedule C lines an expense category can be filed on: the Part II expense lines, and line 4 (cost of goods sold, from Part III). Reference; changed by migration.';
