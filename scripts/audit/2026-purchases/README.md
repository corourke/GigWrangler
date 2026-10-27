# 2026 purchase data audit worksheet (#135)

Read-only queries that list the 2026 purchase, equipment and gig-expense rows that need a look
before 2026 is filed. Each query only reads. Nothing here changes data. Fixes come later, once
Cameron has decided the open calls.

## Running them

Run each file on its own in the Supabase SQL editor or with psql. To be sure nothing writes, wrap it:

```sql
BEGIN READ ONLY;
\i scripts/audit/2026-purchases/01_tax_treatment.sql
ROLLBACK;
```

Each query starts with a `params` row:

| Param | Default | Meaning |
|---|---|---|
| `org_id` | `NULL` (every organization) | Set to one organization's id to see only its rows |
| `y_start`, `y_end` | `2026-01-01`, `2027-01-01` | The year, as start (included) and end (excluded) |

08 covers every year and only takes `org_id`. 09 covers 2024 to 2026 and groups by year.

Every row names the organization and the ids needed to find the record in the app. Rows that
need a fix have a `suggested_action` such as `set tax_treatment = expense`. Rows that need a
decision say `Cameron decides (...)`.

A line's date is its own `purchase_date`, else its invoice's. A line's cost is `line_cost`, else
`item_cost × quantity`. Its per-item cost is `item_cost`, else line cost ÷ quantity. These match
the app (`src/utils/taxTreatment.ts`, `src/utils/taxReports.ts`).

## The queries

| File | What it lists |
|---|---|
| `01_tax_treatment.sql` | Lines whose tax treatment breaks the rule (under $200 per item → expense, over $2,500 → depreciate), and every line from $200 to $2,500, which is Cameron's call. `gig_id` / `gig_rows` show what has to be unlinked before a line can be depreciated. |
| `02_track_as_equipment.sql` | Every 2026 line, showing whether it's tracked as equipment and with how many records and pieces. Untracked lines in an equipment category, or $200 or more per item, sort first. |
| `03_gig_expense_links.sql` | Gig ledger rows and purchase lines that don't match: `double count`, `whole invoice`, `other gig`, `no ledger row`, `not expensed`, and `no purchase link` (money out with no purchase; it may be a real non-purchase expense). |
| `04_invoice_totals.sql` | Invoices whose total differs from the sum of their lines by more than $0.01, has no total, or has no lines. |
| `05_categories_and_recovery.sql` | Lines with a missing or unknown expense category, and equipment with an unknown equipment category. Also depreciated equipment with no recovery period, or one that differs from its category's default. |
| `06_returns_and_refunds.sql` | Equipment that is Returned or Disposed with no date or refund, Active with a retired date, or Inactive. These cover every year. Also 2026 return lines that aren't expensed, and 2026 invoices with a negative total. |
| `07_mileage.sql` | 2026 mileage rows whose amount isn't miles × the IRS rate on the trip's date ($0.725 through June 30, $0.76 from July 1), or that aren't filed under Car and truck expenses. |
| `08_missing_cost_or_purchase.sql` | Equipment with no cost, or not linked to any purchase. Covers every year. |
| `09_depreciable_basis_by_year.sql` | Depreciable cost per tax year, one row per record, with each year's total per organization. It uses the same rule as the Assets report. |

## What these can't find

- **Returns never entered.** If an item went back but neither a return invoice nor a status change
  was recorded, nothing in the data shows it. Check the store and card statements for refunds.
- **Store credit.** A return paid as store credit has no refund on the card. If it was entered at
  all, it looks like any other return. 06 only checks that a returned item has a date and an amount.
- **Wrong amounts that add up.** 04 checks that lines add up to the invoice. It can't tell whether
  the invoice itself matches the receipt.

## Tests

`test/` holds a fixture with one row for each case a query must list, and near misses it must
not list: the $200 and $2,500 boundaries, mileage on June 30 and July 1, cents rounding, and
records splitting a line's cost. `test/run.sh` loads the fixture into the migrated test database
from `supabase/tests/rls/run.sh`, runs every query, checks the ids each one returns, and rolls
back.

```sh
# from the repo root, after supabase/tests/rls/run.sh has built gw_rls_test
PGHOST=/var/run/postgresql scripts/audit/2026-purchases/test/run.sh
```
