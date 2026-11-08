---
title: Purchases
description: Find, check, fix and link your invoices and their line items.
sidebar:
  order: 3
---

**Financials → Purchases** lists every invoice and receipt you've recorded. Admins and Managers also get two buttons next to the page title, **Scan invoices** and **Add purchase**. Each opens its own screen; **Back to Purchases** (the arrow left of the title) returns to the report, with your filters as you left them. See [Receipts and invoices](/financials/receipts-and-invoices/).

## The report

**Filters:**
- **Vendor**, **Type** (**All Types**, **Expensed**, **Depreciated**, **Equipment**), and a **From** / **To** date range. **Equipment** shows every line tracked as equipment, expensed or depreciated.
- Quick ranges: **Last 30 days** (the default), **This month**, **Last month**, **This quarter**, **This year**, **Last year**, **All time**.
- **Clear all filters** puts everything back to the defaults.

**Totals.** The box beside the filters shows:
- the total for what's on screen, labelled **Last 30 days** or **Filtered**, with the number of **Depreciated** and **Expensed** lines;
- the **All time** total.

**Views.** The two buttons switch between them:
- **Detailed view:** one card per invoice, with its lines.
- **Summary view:** one row per invoice. A warning icon marks invoices whose lines don't add up to the invoice total. Click a row to jump to that invoice.

## An invoice

Each invoice card shows the date, vendor, description and **Invoice Total**, and these buttons:

- **Gig Details**: shows the linked gig.
- **Attach Doc** / **View Doc**: attach the invoice file, or open it.
- **Edit** (pencil): opens the purchase on the review screen. See [Receipts and invoices](/financials/receipts-and-invoices/#the-review-screen).
- **Delete** (trash): deletes the invoice and its lines, after you confirm. If any line is a gig's expense, that money-out row is deleted too, and the confirmation says how much and from how many gigs, such as "This also removes $378.40 of expenses from 1 gig." Equipment records are **not** deleted.

## A line

Each purchase is a card. Its blue band at the top shows the date, the vendor, the invoice description and year, and the **Invoice total**.

The line table shows **Type** (**Expense** or **Depreciate**), **Description / Model**, **Equipment** (a box icon when the item is tracked as equipment), **Category**, **Qty**, **Price** and **Cost**. Long descriptions are cut short; hover to read the whole thing. **Cost** is the item's share of the invoice total; see [Cost allocation](/financials/cost-allocation/).

Click a line to open it. You'll see its price and cost figures, and these actions:

- **Asset Details**: the equipment record, with **Edit Asset** and **Open Asset**.
- **Gig Details**: the linked gig, with **Open Gig**.
- **Delete Item**: removes the line, and the gig's money-out row if the line is a gig's expense. Its equipment record, if any, is kept.
- **Track as equipment** (lines that aren't yet): creates one equipment record holding the line's whole quantity (a lot), so you can tag it and put it in kits. Its tax treatment doesn't change, and if it's a gig's expense it stays one. This works for purchases from filed years too.

To change a line's tax treatment, **Edit** the purchase.

### Linking a line to a gig

Use **Assign Gig:** on the line to say it was a cost of a particular gig (a van rental, a replacement cable for that show).

- **First time:** you're asked **Create gig expense record?**
  - **Create record** adds the line's cost to the gig's money out as paid.
  - **Skip** keeps the link without adding it.
- **Moving the line to another gig** moves its expense too.
- **Clearing the gig** asks whether to **Unlink and delete entry** or **Keep linked**.
- **Add to gig ledger** appears on any expense line that's linked to a gig but isn't in its money out yet, for example after you clicked **Skip**.

Only **expensed** lines can be a gig's cost, whether or not they're tracked as equipment. A **depreciated** line can't be assigned to a gig: it's bought for the business, not for one show. A purchase is never linked to a gig as a whole, only line by line. Scanning a receipt on a gig (**Upload Receipt**) links just its expensed lines.
