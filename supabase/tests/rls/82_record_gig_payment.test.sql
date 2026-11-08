-- B7: recording a payment is one call (record_gig_payment): the row is marked paid and, for a
-- partial payment split off, the rest is added as a new row, both or neither. It runs as the
-- caller, so row-level security and the filed-year lock apply.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO rls_test.ids VALUES
  ('p_bal', '00000000-0000-0000-0000-00000000e201'),
  ('p_dep', '00000000-0000-0000-0000-00000000e202'),
  ('p_over', '00000000-0000-0000-0000-00000000e203');

INSERT INTO gig_financials (id, gig_id, organization_id, direction, stage, amount, date, due_date, description, created_by) VALUES
  (rls_test.u('p_bal'),  rls_test.u('gig'), rls_test.u('org_a'), 'in', 'invoiced', 1500, '2026-05-01', '2026-06-01', 'Balance', rls_test.u('a_admin')),
  (rls_test.u('p_dep'),  rls_test.u('gig'), rls_test.u('org_a'), 'in', 'invoiced', 1000, '2026-01-10', NULL,         'Deposit', rls_test.u('a_admin')),
  (rls_test.u('p_over'), rls_test.u('gig'), rls_test.u('org_a'), 'in', 'invoiced', 250,  '2026-05-01', NULL,         'Extra',   rls_test.u('a_admin'));
INSERT INTO tax_years (organization_id, year, filed_on) VALUES (rls_test.u('org_a'), 2025, '2026-03-25');

-- As p_user, record a payment and report: <paid rows for the id> * 10 + <remainder rows>, or -1 if refused. Rolled back.
CREATE FUNCTION rls_test.pay(p_user text, p_row text, p_amount numeric, p_paid date, p_split boolean) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_id uuid := rls_test.u(p_row); v_user uuid := rls_test.u(p_user); v_desc text; v_result int;
BEGIN
  SELECT description INTO v_desc FROM public.gig_financials WHERE id = v_id;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_gig_payment(v_id, p_amount, p_paid, p_split, NULL);
    RESET ROLE;
    SELECT (SELECT count(*) FROM public.gig_financials WHERE id = v_id AND stage = 'paid')::int * 10
         + (SELECT count(*) FROM public.gig_financials WHERE description = v_desc || ' (remainder)')::int
      INTO v_result;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = v_result::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::int;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;
-- The same, returning one column of the paid row or remainder after the call (rolled back).
CREATE FUNCTION rls_test.pay_then(p_row text, p_amount numeric, p_split boolean, p_sql text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_id uuid := rls_test.u(p_row); v_user uuid := rls_test.u('a_admin'); v numeric;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.record_gig_payment(v_id, p_amount, '2026-05-20', p_split, 'CHK-9');
    RESET ROLE;
    EXECUTE p_sql INTO v USING v_id;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = coalesce(v, -999)::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN SQLERRM::numeric;
    WHEN OTHERS THEN RESET ROLE; RETURN -1;
  END;
END $$;

SELECT rls_test.expect('A partial payment, split: the row is paid and the rest is a new row',
  rls_test.pay('a_admin', 'p_bal', 600, '2026-05-20', true), 11);
SELECT rls_test.expect('  ...the paid row keeps what arrived as its amount',
  rls_test.pay_then('p_bal', 600, true, 'SELECT amount FROM public.gig_financials WHERE id = $1')::int, 600);
SELECT rls_test.expect('  ...and the reference',
  rls_test.pay_then('p_bal', 600, true, 'SELECT count(*) FROM public.gig_financials WHERE id = $1 AND reference_number = ''CHK-9'' AND paid_at IS NOT NULL')::int, 1);
SELECT rls_test.expect('  ...the remainder is owed at the old stage, due date and date',
  rls_test.pay_then('p_bal', 600, true, $q$SELECT amount FROM public.gig_financials WHERE description = 'Balance (remainder)' AND stage = 'invoiced' AND due_date = '2026-06-01' AND date = '2026-05-01' AND amount_settled IS NULL$q$)::int, 900);
SELECT rls_test.expect('A partial payment, settled: paid, no remainder',
  rls_test.pay('a_admin', 'p_bal', 600, '2026-05-20', false), 10);
SELECT rls_test.expect('An overpayment: paid at what arrived, the agreed amount kept, no remainder',
  rls_test.pay_then('p_over', 260, true, 'SELECT amount * 1000 + amount_settled FROM public.gig_financials WHERE id = $1')::int, 250260);
SELECT rls_test.expect('Refused by the filed year: nothing is paid and no remainder is left behind',
  rls_test.pay('a_admin', 'p_dep', 400, '2025-12-30', true), -1);
SELECT rls_test.expect('  ...the row is still owed, and no remainder exists',
  (SELECT count(*)::int FROM public.gig_financials WHERE (id = rls_test.u('p_dep') AND stage = 'invoiced') OR description = 'Deposit (remainder)'), 1);
SELECT rls_test.expect('A Viewer cannot record a payment', rls_test.pay('a_viewer', 'p_bal', 600, '2026-05-20', true), -1);
SELECT rls_test.expect('Another organization cannot', rls_test.pay('b_admin', 'p_bal', 600, '2026-05-20', true), -1);
SELECT rls_test.expect('Signed out cannot call it', rls_test.try_anon(format('SELECT public.record_gig_payment(%L, 1, %L, true, NULL)', rls_test.u('p_bal'), '2026-05-20')), -1);
