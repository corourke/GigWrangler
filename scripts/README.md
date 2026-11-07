# GigManager Scripts

## Spreadsheet Import (Columns A-Z)

The system supports a comprehensive 26-column spreadsheet import for assets and expenses. The mapping follows the legacy Act4Audio format with enhanced fields.

### Source Types
- **0-Invoice**: Header row. Defines the vendor, date, and total invoice amount.
- **1-Asset**: Individual trackable equipment.
- **2-Expense**: Non-trackable expense items (shipping, tax, small parts).

### Column Mapping (A-Z)

| Col | CSV Column Name | Req? | Type | Notes |
|---|---|---|---|---|
| A | `acquisition_date` | Yes | Date | YYYY-MM-DD |
| B | `source` | Yes | Enum | 0, 1, or 2 |
| C | `vendor` | Yes* | String | *Req for Header |
| D | `total_inv_amount` | Yes* | Number | *Req for Header |
| E | `payment_method` | No | String | e.g. Visa, Amex |
| F | `line_amount` | No* | Number | *Req for Item if no price |
| G | `line_cost` | No | Number | Computed if empty |
| H | `quantity` | Yes | Integer | Default: 1 |
| I | `item_price` | No | Number | Selling price |
| J | `item_cost` | No | Number | Burdened cost |
| K | `manufacturer_model` | Yes* | String | *Req for Asset |
| L | `category` | Yes* | String | e.g. Audio, Video |
| M | `sub_category` | No | String | Older sheets only: fills Type when Type is empty |
| N | `type` | No | String | e.g. Dynamic Mic |
| O | `kit` | No | String | Add to named kit |
| P | `serial_number` | No | String | |
| Q | `tag_number` | No | String | |
| R | `description` | No | String | |
| S | `insured` | No | Boolean | |
| T | `insurance_class` | No | String | |
| U | `replacement_value` | No | Number | |
| V | `retired_on` | No | Date | |
| W | `liquidation_amt` | No | Number | |
| X | `service_life` | No | Integer | Years |
| Y | `dep_method` | No | String | e.g. MACRS |
| Z | `status` | No | Enum | e.g. Active |

### Cost Allocation Logic
For each purchase group (Header + Items):
1. **Factor** = `Invoice Total / Sum(Item Price * Quantity)`.
2. **Line Cost** = `(Item Price * Quantity) * Factor`.
3. **Item Cost** = `Line Cost / Quantity`.
4. **Penny Reconciliation**: The final item's cost is adjusted so that `Sum(Line Cost) == Invoice Total`.

---

## Native Implementation (Edge Function) Setup

The `ai-scan` Edge Function requires an Anthropic API key to process PDFs.

### Configuration

1. **API Key**: Obtain a paid API key from the [Anthropic Console](https://console.anthropic.com/).
2. **Supabase Secret**: Add the key to your Supabase project:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=your_key_here
   ```
   Alternatively, add it via the Supabase Dashboard under **Project Settings -> Edge Functions -> Secrets**.

---

## Demo data for user-guide screenshots (`seed-demo.sh`)

`scripts/seed-demo.sh` posts `scripts/seed-demo.sql` to the **development** Supabase project (`qcrzwsazasaojqoqxwnr`) through the Management API `database/query` endpoint (curl + jq; credentials come from your environment or proxy, the script sends no token). **Dev only:** it refuses to run for any other project ref and must never be pointed at production.

- **Idempotent.** The SQL first deletes every row belonging to the demo organizations and users (fixed UUIDs of the form `de000000-0000-4000-8000-<kind><n>`), then re-inserts. Rows without a demo UUID are never touched.
- **Pinned dates.** Every date hangs off an anchor date, the demo world's "today" (default `2026-10-07`; pass another as `./scripts/seed-demo.sh 2027-01-15` or `SEED_DEMO_ANCHOR`). Screenshots freeze the browser clock to the same date and use the `America/Los_Angeles` time zone, so Upcoming/Past and "next 30 days" don't drift. Move the anchor only for a full screenshot refresh. Gigs are placed by week and weekday, so they stay on Friday and Saturday evenings.
- **Contents.** "Demo Sound & Lighting" plus five partner orgs (Harborlight Pavilion and Cedar Hall, venues; Neon Orchard and Paper Lanterns, acts; Brightwave Events, the main client); 7 logins (one per role, one in no organization, a platform moderator, and a venue contact) and 10 people without logins; 17 gigs from about 8 weeks back to 14 weeks ahead across all statuses (two of them two-day, and two that deliberately conflict), with participants, day-of contacts, schedules, staffing (fees, and rates per hour, day and half day; finalized on finished gigs) and kit assignments; 26 equipment items owned as 26 tagged units (speakers, subs, wedges, consoles, wireless, moving heads, wash bars with two in maintenance, controller, power distros) and 15 counted lots (mics, DI boxes, cables, pars, stands, truss); 6 kits (a nested band package holding two kits and two containers, a mic case and an XLR cable box) using all three kinds of kit line: a specific unit or lot, "N × any" of an item, and another kit; last-scanned locations, with counts for lots; 4 purchases, each line's tax treatment following its per-item cost (under $200 Expense, over $2,500 Depreciate, the grey zone mixed); a gig ledger with paid, invoiced, overdue, contracted and quoted rows; three weeks of activity history; and the year before the anchor's filed and locked, with invented Form 4562 figures (Section 179 $4,000, one 7-year mid-quarter line 19 row of $6,000 → $214, line 22 $4,214). The clean-up removes the demo tax years first, so a locked year never blocks a reseed.
- **People.** First names start with the letter of their role (Admin **A**licia, Manager **M**arcus, Staff **S**ofia and the freelance crew, Viewer **V**ictor and the partner contacts), so a screenshot shows who is who. Avatars stay as initials.
- **Demo logins** (password `demo-pass-2026`):

  | Email | Name | Role in Demo Sound & Lighting |
  |---|---|---|
  | `demo-admin@gigwrangler.test` | Alicia Hale | Admin |
  | `demo-manager@gigwrangler.test` | Marcus Reyes | Manager |
  | `demo-staff@gigwrangler.test` | Sofia Lindqvist | Staff |
  | `demo-viewer@gigwrangler.test` | Victor Okafor | Viewer |
  | `demo-newuser@gigwrangler.test` | Nina Newman | none: signed up, no organization yet (onboarding screenshots) |
  | `demo-moderator@gigwrangler.test` | Petra Lund | none: a platform moderator (reviews requests on unclaimed organizations) |
  | `vera.holm@cedar-hall.example` | Vera Holm | none here: a Viewer at Cedar Hall who has asked to claim it |

  The `.test` addresses receive no mail, so flows that send email (invitations, sign-up confirmation, password reset) can't be completed with them yet. Screenshotting those needs a way to simulate email delivery (noted in WORK_PLAN.md §5).
- **Run:** `./scripts/seed-demo.sh` (prints per-table row counts on success).
- The SQL targets the live dev schema. If dev gains new required columns or constraints (for example migration `20261012000000` renaming `purchases.row_type` `item`/`asset` to `line`), update `seed-demo.sql` to match.
