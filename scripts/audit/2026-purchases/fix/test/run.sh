#!/usr/bin/env bash
# Tests the #135 fix scripts: preview.sql and apply.sql against fixture.sql in a throwaway copy of
# the migrated test database (gw_rls_test, from supabase/tests/rls/run.sh --only-migrations).
# Checks: apply embeds preview's query unchanged; preview is read-only and lists the expected
# rows; every guard stops both scripts; a dry run saves nothing; a saving run changes exactly the
# rows and values the preview listed.
# Usage (repo root): PGHOST=... PGUSER=postgres scripts/audit/2026-purchases/fix/test/run.sh
set -euo pipefail
here=scripts/audit/2026-purchases/fix
DB=gw_fix_test
. "$here/test/values.sh"
fail=0
ok()  { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }

# 1. apply.sql runs preview.sql's query word for word.
diff <(sed -n '/^WITH$/,$p' "$here/preview.sql" | sed '$ s/;$//') \
     <(sed -n '/^-- >>> PLAN/,/^-- <<< PLAN/p' "$here/apply.sql" | sed '1d;$d') >/dev/null \
  && ok "apply.sql embeds preview.sql's query" || bad "apply.sql embeds preview.sql's query"

# Replaces the run-time values block of a script with $2.
with_values() {
  awk -v block="$2" '/^-- >>> RUN-TIME VALUES/ {print; print block; skip=1; next}
                     /^-- <<< RUN-TIME VALUES/ {skip=0} !skip' "$1"
}
q() { psql -qXAt -v ON_ERROR_STOP=1 -d $DB "$@"; }
snapshot() { q -c "SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (SELECT (to_jsonb(p) - 'updated_at')::text x FROM purchases p UNION ALL SELECT (to_jsonb(a) - 'updated_at')::text FROM assets a) s"; }

PGOPTIONS="-c client_min_messages=warning" psql -qX -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE gw_rls_test" >/dev/null
trap 'PGOPTIONS="-c client_min_messages=warning" psql -qX -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
{ echo "BEGIN;"; cat supabase/tests/rls/_harness.sql supabase/tests/rls/_fixture.sql "$here/test/fixture.sql"; echo "COMMIT;"; } | q >/dev/null
before=$(snapshot)

GOOD=$(values 5 5 1 "$GOOD_RESALE" "$GOOD_CENTS")
preview() { { echo "BEGIN READ ONLY;"; with_values "$here/preview.sql" "$1"; echo "ROLLBACK;"; } | q -F '|' 2>&1; }
apply()   { with_values "$here/apply.sql" "$1" | sed "s/set_config('fix135.save', 'false', true)/set_config('fix135.save', '$2', true)/" | q 2>&1; }

# 2. The preview, read-only, lists exactly the expected rows.
out=$(preview "$GOOD") || { bad "preview runs read-only"; echo "$out"; }
rows=$(echo "$out" | grep -c '^all checks passed|' || true)
[ "$rows" = 24 ] && ok "preview lists 24 changes" || { bad "preview lists 24 changes (got $rows)"; echo "$out"; }
expect_row() {  # label, step, key, field, current, new
  echo "$out" | awk -F'|' -v s="$2" -v id="$(q -c "SELECT rls_test.k('$3')")" -v f="$4" -v c="$5" -v n="$6" \
    '$2==s && $4==id && $12==f && $13==c && $14==n {found=1} END {exit !found}' \
    && ok "$1" || bad "$1"
}
no_row() {  # label, key
  ! echo "$out" | grep -q "$(q -c "SELECT rls_test.k('$2')")" && ok "$1" || bad "$1"
}
expect_row "step 1: \$199.99 depreciated → expense"         1 D1  tax_treatment depreciate expense
expect_row "step 1: no item cost, 600 / 4 = 150"             1 D7  tax_treatment depreciate expense
expect_row "step 1: a depreciated return"                     1 D13 tax_treatment depreciate expense
expect_row "step 1: a 2026 line on a 2025 invoice"            1 D14 tax_treatment depreciate expense
expect_row "step 1: every organization"                       1 DB  tax_treatment depreciate expense
expect_row "step 2: \$200.00"                                 2 D2  tax_treatment depreciate expense
expect_row "step 2: \$2,500.00"                               2 D3  tax_treatment depreciate expense
expect_row "step 2: the resale invoice's grey line is step 2" 2 R3  tax_treatment depreciate expense
expect_row "step 2: no line_cost, 2 × 1500"                   2 S1  tax_treatment depreciate expense
expect_row "step 3: the resale invoice's tracked \$3,000 line" 3 R1 tax_treatment depreciate expense
expect_row "step 4: lines 7¢ over, largest line lowered"      4 R1  line_cost 6000.00 5999.93
expect_row "step 4: no line_cost: 3000 - 0.03"                4 S1  line_cost "" 2999.97
expect_row "trigger: equipment of an expensed line loses its period" T AD1 recovery_period 7 ""
expect_row "trigger: equipment of the resale line loses its period"  T AR1 recovery_period 7 ""
no_row "\$2,500.01 depreciated: unchanged"                   D4
no_row "\$3,000 depreciated: unchanged"                       D9
no_row "already expensed: unchanged"                          D5
no_row "grey, expensed, on a gig: unchanged"                  D6
no_row "2025 line: unchanged"                                 D10
no_row "2025 line on a 2026 invoice: unchanged"               D15
no_row "resale stock already expensed: unchanged"             R2
no_row "equipment still covered by a depreciated line keeps its period" AD8
no_row "expensed line's equipment has no period to clear"     AD5
no_row "an invoice that adds up: unchanged"                   E1
ties=$(echo "$out" | awk -F'|' '$2=="4" && $12=="line_cost" && $14=="49.99"' | wc -l)
low=$(q -c "SELECT least(rls_test.k('T1'), rls_test.k('T2'))")
[ "$ties" = 1 ] && echo "$out" | grep -q "^all checks passed|4|purchases|$low|" && ok "step 4: a tie lowers only the lower id" || bad "step 4: a tie lowers only the lower id"

# 3. Every guard stops the preview and the apply, and leaves the data as it was.
stops() {  # label, values block, expected message
  local p a
  p=$(preview "$2" || true); a=$(apply "$2" true || true)
  if echo "$p" | grep -q "STOP:.*$3" && echo "$a" | grep -q "STOP:.*$3" && [ "$(snapshot)" = "$before" ]; then ok "$1"
  else bad "$1"; echo "preview: $p" | tail -3; echo "apply: $a" | tail -3; fi
}
stops "placeholders"              "$(values NULL NULL NULL '(NULL::uuid)' '(NULL::uuid, NULL::numeric)')" "fill in the run-time values"
stops "step 1 count off by one"   "$(values 6 5 1 "$GOOD_RESALE" "$GOOD_CENTS")" "step 1 finds 5 lines, expected 6"
stops "step 2 count off by one"   "$(values 5 4 1 "$GOOD_RESALE" "$GOOD_CENTS")" "step 2 finds 5 lines, expected 4"
stops "step 3 count off by one"   "$(values 5 5 0 "$GOOD_RESALE" "$GOOD_CENTS")" "step 3 finds 1 lines, expected 0"
stops "unknown resale invoice"    "$(values 5 5 0 "(rls_test.k('nope'))" "$GOOD_CENTS")" "resale invoice .* is not an invoice"
stops "a line given as an invoice" "$(values 5 5 1 "$GOOD_RESALE" "(rls_test.k('R1'), -0.07::numeric)")" "is not an invoice with lines"
stops "wrong difference"          "$(values 5 5 1 "$GOOD_RESALE" "(rls_test.k('F2'), -0.05::numeric)")" "lines are off by -0.07, expected -0.05"
q -c "INSERT INTO tax_years (organization_id, year, locked) VALUES (rls_test.u('org_b'), 2026, true)" >/dev/null
before=$(snapshot)
stops "a locked tax year"         "$GOOD" "the 2026 tax year is locked for organization $(q -c "SELECT rls_test.u('org_b')")"
q -c "DELETE FROM tax_years WHERE organization_id = rls_test.u('org_b') AND year = 2026" >/dev/null
before=$(snapshot)

# 4. A dry run changes everything, checks it, and then saves nothing.
a=$(apply "$GOOD" false || true)
echo "$a" | grep -q "Dry run: nothing was saved" && [ "$(snapshot)" = "$before" ] \
  && ok "a dry run saves nothing" || { bad "a dry run saves nothing"; echo "$a" | tail -5; }

# 5. A saving run changes exactly what the preview listed.
q -c "CREATE TABLE fix_test_before AS SELECT 'purchases' t, id, to_jsonb(p) - 'updated_at' j FROM purchases p UNION ALL SELECT 'assets', id, to_jsonb(a) - 'updated_at' FROM assets a" >/dev/null
a=$(apply "$GOOD" true) || { bad "a saving run"; echo "$a"; }
changed=$(q -F '|' -c "SELECT b.t, b.id, k, n.j ->> k FROM fix_test_before b
  JOIN (SELECT 'purchases' t, id, to_jsonb(p) - 'updated_at' j FROM purchases p UNION ALL SELECT 'assets', id, to_jsonb(a) - 'updated_at' FROM assets a) n USING (t, id)
  CROSS JOIN LATERAL jsonb_object_keys(b.j) k WHERE b.j -> k IS DISTINCT FROM n.j -> k ORDER BY 1, 2, 3")
planned=$(echo "$out" | awk -F'|' '$1=="all checks passed" {print $3 "|" $4 "|" $12 "|" $14}' | sort -t'|' -k1,1 -k2,2 -k3,3)
[ "$changed" = "$planned" ] && ok "the saved changes are exactly the preview's" \
  || { bad "the saved changes are exactly the preview's"; diff <(echo "$changed") <(echo "$planned"); }
[ "$(q -c "SELECT count(*) FROM purchases WHERE asset_id IS NOT NULL") $(q -c "SELECT count(*) FROM assets WHERE purchase_line_id IS NOT NULL")" = "16 15" ] \
  && ok "no equipment record is added, removed or unlinked" || bad "no equipment record is added, removed or unlinked"
a=$(apply "$GOOD" true || true)
echo "$a" | grep -q "STOP: step 1 finds 0 lines, expected 5" && ok "a second run stops" || bad "a second run stops"

[ $fail = 0 ] && echo "all fix checks passed" || { echo "some fix checks failed"; exit 1; }
