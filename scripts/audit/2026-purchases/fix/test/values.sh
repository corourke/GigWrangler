# Run-time values blocks for the tests.
# values <step1> <step2> <step3> <step6> <resale ids sql> <cents rows sql> <blank-cost ids sql>
values() {
  cat <<V
expected (step1_lines, step2_lines, step3_lines, step6_lines) AS (VALUES ($1::int, $2::int, $3::int, $4::int)),
resale_invoices (invoice_id) AS (VALUES $5),
cents_fixes (invoice_id, expected_difference) AS (VALUES $6),
blank_cost_assets (asset_id) AS (VALUES $7),
V
}
GOOD_RESALE="(rls_test.k('F2'))"
GOOD_CENTS="(rls_test.k('F2'), -0.07::numeric), (rls_test.k('F3'), -0.03), (rls_test.k('F4'), -0.01), (rls_test.k('F5'), 0)"
GOOD_BLANK="(rls_test.k('N1')), (rls_test.k('N2'))"
