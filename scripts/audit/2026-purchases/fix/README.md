# 2026 purchase fixes (#135)

These scripts make the fixes Cameron has decided on the [worksheet](../README.md). There are two
files, and they choose their rows with the same query:

| File | What it does | Where it runs |
|---|---|---|
| `preview.sql` | SELECT only. Lists every value the fix would change, with its current and new value. | Any connection, including a read-only one |
| `apply.sql` | Makes exactly those changes in one transaction. It doesn't save unless its save flag is set. | Only with Cameron's OK |

## The steps

Tracking as equipment and tax treatment are independent. Changing a line's tax treatment never
adds, removes or unlinks an equipment record.

| Step | Change |
|---|---|
| 1 | 2026 depreciated lines with a per-item cost under $200 → `tax_treatment = expense` |
| 2 | 2026 depreciated lines with a per-item cost from $200 to $2,500 → expense. Grey-zone lines already expensed stay as they are. |
| 3 | Every other line on the named resale invoice(s) that isn't already an expense → expense |
| 3b | Not built yet: record the resale stock as cost of goods sold, once its category is decided |
| 4 | On each named invoice, lower the largest line's `line_cost` so its lines add up to the invoice total. `item_cost` doesn't change. If two lines tie for largest, the one with the lower id changes. |
| 5 | Not built yet: a "Cost of goods sold (resale)" category on Schedule C line 4 for the resale stock. First, line 4 has to be added to `schedule_c_lines`, and the tax report has to show it apart from the Part II expenses. |
| 6 | 2026 lines whose category isn't one of the org's active expense categories (`05`'s "line category" finding) move to the category named by Cameron's map, which is in the script. Old names match ignoring case and surrounding spaces. Only `purchases.category` on lines changes; equipment categories don't. |
| 7 | The named equipment with a blank cost gets `item_cost = 0` |
| T | What the triggers do: equipment that no depreciated line covers any more loses its `recovery_period` |

After steps 1 and 2, the only 2026 depreciated lines left are those over $2,500.

The rules match the worksheet:
- A line's date is its own, else its invoice's.
- Per-item cost is `item_cost`, else the line cost ÷ quantity.
- Line cost is `line_cost`, else `item_cost × quantity`.

## Run-time values

Both files start with the same block, between `-- >>> RUN-TIME VALUES` and
`-- <<< RUN-TIME VALUES`. Fill it in identically in both files:

```sql
expected (step1_lines, step2_lines, step3_lines, step6_lines) AS (VALUES (<n>, <n>, <n>, <n>)),
resale_invoices (invoice_id) AS (VALUES ('<invoice id>'::uuid)),
cents_fixes (invoice_id, expected_difference) AS (VALUES ('<invoice id>'::uuid, <invoice total - lines>::numeric), ('<invoice id>'::uuid, <...>)),
blank_cost_assets (asset_id) AS (VALUES ('<equipment id>'::uuid), ('<equipment id>'::uuid)),
```

To name nothing for a list, write `(SELECT NULL::uuid WHERE false)` in place of its `VALUES (...)`.
For `cents_fixes`, write `(SELECT NULL::uuid, NULL::numeric WHERE false)`.

The repo copy holds placeholders, and the guards refuse to run until they're replaced. Real ids,
counts and amounts never go in the repo, a commit or a PR.

## Guards

`preview.sql` stops with an error starting `STOP:` if any of these fails. Because it's a plain
SELECT, the error shows as an "invalid input syntax for type integer".
- Each step's row count equals the expected count.
- Each named invoice exists, and each step 4 invoice has lines.
- Each step 4 invoice's lines are off from its total by exactly the expected difference.
- The 2026 tax year isn't locked for any organization touched. A locked year would refuse the
  change anyway.
- No 2026 depreciated line at $2,500 or less would be left.
- A step 4 line that stays depreciated has its equipment record. The app refuses to save one that
  doesn't.
- In step 6, every line's category is in the map. A blank category counts as not in the map, and the
  error lists each unmapped name with its count. Every mapped name is one of that organization's
  active expense categories.
- In step 7, every named piece of equipment exists and its cost is blank now. One already at 0 stops
  the run, so it isn't touched.

`apply.sql` runs the preview's query word for word, so the same guards stop it. It then checks:
- each UPDATE changed exactly the planned rows, matching each row's current value;
- every purchase and equipment row, compared with a snapshot, changed in exactly the planned
  values, including the recovery periods the triggers clear, and nothing else.

## Running it on prod (Cameron)

You'll get the run-time values privately from the coordinator: the counts, invoice ids, expected
differences and equipment ids. Use the Supabase SQL editor for the prod project, or psql.

1. **Fill in the values in both files.** In `preview.sql` and `apply.sql`, replace the lines
   between `-- >>> RUN-TIME VALUES` and `-- <<< RUN-TIME VALUES` with the block you were given. It
   must be the same in both files. Don't save the filled-in copies to the repo.
2. **Preview.** Run the filled-in `preview.sql`.
   - **Success** is one row per change, and every row says `all checks passed` in the `checks`
     column. Read the rows: these are exactly the changes the apply will make.
   - **Failure** is an error containing `STOP:` followed by the problem, for example
     `STOP: step 6 finds 101 lines, expected 102`. Nothing has changed. Send the message to the
     coordinator and stop here.
3. **Dry run.** Run the filled-in `apply.sql` without changing anything else.
   - **Success** is the error `Dry run: nothing was saved. Set fix135.save to 'true' to save.` It
     means every change was made, matched the plan exactly, and was then rolled back.
   - **Failure** is any error containing `STOP:`. Nothing has changed.
4. **Save.** In `apply.sql`, find this line near the top:
   ```sql
   SELECT set_config('fix135.save', 'false', true);  -- 'true' saves the changes
   ```
   Change `'false'` to `'true'`, then run the file once.
   - **Success** is no error at all. Every change is saved in one transaction.
   - **Failure** is any error. Nothing is saved, because it's all or nothing.
5. **Check.** Run the filled-in `preview.sql` again. It should now stop with a `STOP:` error that
   includes `step 1 finds 0 lines, expected …`. The fixes are in, so the old counts no longer match.
   Running `apply.sql` a second time stops the same way, so it can't apply twice.

What the triggers do when a line goes from depreciate to expense:
- `purchases_sync_asset_recovery_period` clears the equipment's recovery period, unless another
  depreciated line still covers it. Those changes are the step T rows.
- Nothing else changes. Only a change *to* depreciate is refused for a line on a gig. The
  equipment record and its link to the line stay.

## Tests

`test/run.sh` builds a throwaway copy of the migrated test database, loads `test/fixture.sql` and
checks that:
- `apply.sql` embeds the preview's query unchanged;
- the read-only preview lists exactly the expected rows, with near misses left out (every
  old name in the map, a current category in another case, a 2025 line, and equipment already
  at 0 or costed);
- every guard stops both scripts and leaves the data as it was;
- a dry run saves nothing;
- a saving run changes exactly the previewed rows and values, with no equipment record added,
  removed or unlinked;
- a second run stops.

```sh
# from the repo root
PGHOST=/var/run/postgresql supabase/tests/rls/run.sh --only-migrations
PGHOST=/var/run/postgresql scripts/audit/2026-purchases/fix/test/run.sh
```
