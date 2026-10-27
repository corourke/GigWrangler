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

GOOD=$(values 5 5 1 16 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")
preview() { { echo "BEGIN READ ONLY;"; with_values "$here/preview.sql" "$1"; echo "ROLLBACK;"; } | q -F '|' 2>&1; }
apply()   { with_values "$here/apply.sql" "$1" | sed "s/set_config('fix135.save', 'false', true)/set_config('fix135.save', '$2', true)/" | q 2>&1; }

# 2. The preview, read-only, lists exactly the expected rows.
out=$(preview "$GOOD") || { bad "preview runs read-only"; echo "$out"; }
rows=$(echo "$out" | grep -c '^all checks passed|' || true)
[ "$rows" = 42 ] && ok "preview lists 42 changes" || { bad "preview lists 42 changes (got $rows)"; echo "$out"; }
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
expect_row "step 6: Lighting"                                 6 C1  category Lighting "Small lighting parts"
expect_row "step 6: other case and spacing"                   6 C2  category " software " "Software subscriptions"
expect_row "step 6: to the org's own category"                6 C3  category Audio "Small audio tools and supplies"
expect_row "step 6: Computer"                                 6 C4  category Computer "Office expenses"
expect_row "step 6: Networking"                               6 C5  category Networking "Small networking parts"
expect_row "step 6: Office"                                   6 C6  category Office "Office expenses"
expect_row "step 6: Cases/Bags"                               6 C7  category Cases/Bags "Cases and bags"
expect_row "step 6: Transportation"                           6 C8  category Transportation "Travel"
expect_row "step 6: Power"                                    6 C9  category Power "Small power and networking parts"
expect_row "step 6: Car and Truck Exp"                        6 C10 category "Car and Truck Exp" "Car and truck expenses"
expect_row "step 6: Small power parts and consumables"        6 C11 category "Small power parts and consumables" "Small power tools and consumables"
expect_row "step 6: an inactive category is mapped"           6 C12 category "Small audio parts" "Small audio tools and supplies"
expect_row "step 6: Small Parts"                              6 C13 category "Small Parts" "Other small parts and supplies"
expect_row "step 6: Misc"                                     6 C14 category Misc "Other small parts and supplies"
expect_row "step 6: Tools"                                    6 C15 category Tools "Supplies"
expect_row "step 6: a line step 2 also expenses"              6 D2  category Tools "Supplies"
expect_row "step 2: ...and its tax treatment"                 2 D2  tax_treatment depreciate expense
no_row "step 6: a 2025 line: unchanged"                       C16
no_row "step 6: a current category in other case: unchanged"  C17
expect_row "step 7: no cost → 0"                              7 N1  item_cost "" 0.00
expect_row "step 7: every organization"                       7 N2  item_cost "" 0.00
no_row "step 7: already 0: unchanged"                         Z
no_row "step 7: costed: unchanged"                            V
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
stops "placeholders"              "$(values NULL NULL NULL NULL '(NULL::uuid)' '(NULL::uuid, NULL::numeric)' '(NULL::uuid)')" "fill in the run-time values"
stops "step 1 count off by one"   "$(values 6 5 1 16 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "step 1 finds 5 lines, expected 6"
stops "step 2 count off by one"   "$(values 5 4 1 16 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "step 2 finds 5 lines, expected 4"
stops "step 3 count off by one"   "$(values 5 5 0 16 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "step 3 finds 1 lines, expected 0"
stops "unknown resale invoice"    "$(values 5 5 0 16 "(rls_test.k('nope'))" "$GOOD_CENTS" "$GOOD_BLANK")" "resale invoice .* is not an invoice"
stops "a line given as an invoice" "$(values 5 5 1 16 "$GOOD_RESALE" "(rls_test.k('R1'), -0.07::numeric)" "$GOOD_BLANK")" "is not an invoice with lines"
stops "wrong difference"          "$(values 5 5 1 16 "$GOOD_RESALE" "(rls_test.k('F2'), -0.05::numeric)" "$GOOD_BLANK")" "lines are off by -0.07, expected -0.05"
stops "step 6 count off by one"   "$(values 5 5 1 17 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "step 6 finds 16 lines, expected 17"
stops "step 7: already 0"         "$(values 5 5 1 16 "$GOOD_RESALE" "$GOOD_CENTS" "(rls_test.k('N1')), (rls_test.k('Z'))")" "step 7: equipment .* already has a cost (0.00)"
stops "step 7: unknown equipment" "$(values 5 5 1 16 "$GOOD_RESALE" "$GOOD_CENTS" "(rls_test.k('nope'))")" "step 7: equipment .* not found"
# An unmapped name, a blank category, and a target org B doesn't have.
q -c "INSERT INTO purchases (id, organization_id, parent_id, row_type, quantity, item_cost, line_cost, tax_treatment, category) VALUES
  (rls_test.k('X1'), rls_test.u('org_a'), rls_test.k('F6'), 'line', 1, 0, 0, 'expense', 'Bogus'),
  (rls_test.k('X2'), rls_test.u('org_a'), rls_test.k('F6'), 'line', 1, 0, 0, 'expense', '  '),
  (rls_test.k('X3'), rls_test.u('org_b'), rls_test.k('FB'), 'line', 1, 0, 0, 'expense', 'Tools')" >/dev/null
before=$(snapshot)
stops "step 6: an unmapped name"  "$(values 5 5 1 19 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "no mapping for category 'Bogus' (1 lines)"
stops "step 6: a blank category"  "$(values 5 5 1 19 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "no mapping for category (blank) (1 lines)"
stops "step 6: a target the org doesn't have" "$(values 5 5 1 19 "$GOOD_RESALE" "$GOOD_CENTS" "$GOOD_BLANK")" "'Supplies' is not an active expense category of organization $(q -c "SELECT rls_test.u('org_b')")"
q -c "DELETE FROM purchases WHERE id IN (rls_test.k('X1'), rls_test.k('X2'), rls_test.k('X3'))" >/dev/null
before=$(snapshot)
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
echo "$a" | grep -q "STOP: .*step 1 finds 0 lines, expected 5" && ok "a second run stops" || bad "a second run stops"

[ $fail = 0 ] && echo "all fix checks passed" || { echo "some fix checks failed"; exit 1; }
