# Run-time values blocks for the tests. values <step1> <step2> <step3> <resale ids sql> <cents rows sql>
values() {
  cat <<V
expected (step1_lines, step2_lines, step3_lines) AS (VALUES ($1::int, $2::int, $3::int)),
resale_invoices (invoice_id) AS (VALUES $4),
cents_fixes (invoice_id, expected_difference) AS (VALUES $5),
V
}
GOOD_RESALE="(rls_test.k('F2'))"
GOOD_CENTS="(rls_test.k('F2'), -0.07::numeric), (rls_test.k('F3'), -0.03), (rls_test.k('F4'), -0.01), (rls_test.k('F5'), 0)"
