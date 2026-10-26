-- #183 D2 (#317): the app saves purchases through create_purchase_transaction_v2 only, so the
-- v1 kept for app builds from before #183 (20261017000000) goes. Nothing else in the database
-- calls it. No CASCADE: if something did depend on it, this should fail rather than take it along.
DROP FUNCTION IF EXISTS public.create_purchase_transaction_v1(jsonb, jsonb[], jsonb[]);
