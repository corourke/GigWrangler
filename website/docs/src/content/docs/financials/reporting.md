---
title: Reporting
description: Income, Expenses, Assets, Grey zone, Schedule C and Needs attention reports for each tax year, with CSV downloads to hand to your tax program or accountant.
sidebar:
  order: 8
---

**Financials → Reporting** gathers a tax year's figures into six reports: **Income**, **Expenses**, **Assets**, **Grey zone**, **Schedule C** and **Needs attention**. Each one downloads as a CSV file you can give to your tax program or accountant. Admins and Managers can open it. GigWrangler doesn't calculate tax; it lists what you received, spent and bought.

The reports use the cash basis. Money counts in the year it was received or paid, and equipment counts in the year it was bought.

## Choosing a year and a report

1. Open **Financials → Reporting**.
2. Choose a year in **Tax year**. The list holds this year and every year in which you have purchases, paid gig money or equipment you sold or retired.
3. Select **Income**, **Expenses**, **Assets**, **Grey zone**, **Schedule C** or **Needs attention**.

If an Admin has marked the year as filed, a **{year} is filed** badge appears beside the report buttons. See [Filing a year](#filing-a-year).

## Downloading a CSV

Select **Download CSV** to save the report you're looking at for the year you chose. The file is named after your organization, the report and the year, such as `demo-sound-lighting-expenses-2026.csv` or `demo-sound-lighting-schedule-c-2026.csv`. The Assets report also has **Download disposals CSV**, described below.

## The Income report

The Income report lists every gig payment you received in the year: money in that has reached the paid stage, counted on the date it was paid. It counts the amount actually received.

The boxes at the top show **Received in {year}** and the number of **Payments**. The table has these columns: **Date received**, **Gig**, **From**, **Description**, **Reference** and **Amount**, with a **Total** at the bottom. The gig's own date appears beside its title.

If nothing was received, you'll see "No gig payments were received in {year}."

![The Income report for 2026: the total received, the number of payments, and a table of payments with the date received, gig, payer, description, reference and amount](../../../assets/screenshots/financials/reporting-income.png)

## The Expenses report

The Expenses report lists what you paid in the year, from two places:

- **Purchases:** every purchase line you chose to **Expense**, on the line's date. Depreciated lines go in the Assets report instead.
- **Gigs:** money out that has been paid and didn't come from a purchase, such as quick expenses, mileage and staff pay, on the date it was paid.

A gig cost that came from a purchase isn't listed twice. The purchase counts it once.

The boxes at the top show **Expenses in {year}** and the number of **Items**. The first table groups the expenses by IRS Schedule C line, with each line's categories under it and a **Total**. Anything without a Schedule C line goes under "No Schedule C line", at the end.

If you have expense categories on line 4, cost of goods sold (see [Goods you buy to resell](/settings/categories/#goods-you-buy-to-resell)), they get their own table first, "Line 4: Cost of goods sold (Part III), not in the expenses total", with its categories and a **Total**, and a **Cost of goods sold** box at the top. The table of the other lines follows under **Expenses (Part II)**. **Expenses in {year}** doesn't include line 4, but **Items** and **Every expense** do.

Below it, **Every expense** lists each item with **Date paid**, **Source** (**Purchase** or **Gig**), **Payee**, **Description**, **Category**, **Line** and **Amount**. Mileage shows its miles beside the description. A purchase's amount includes its share of tax and shipping (see [Cost allocation](/financials/cost-allocation/)).

An item whose category isn't on your expense list, or has none, can't be placed on a Schedule C line. An amber **Need a category** box counts them, and the category shows in amber. For a purchase, edit the purchase to choose a category; for a gig's own cost, edit the gig, then on its [Financials tab](/financials/gig-expenses/) open the cost's **⋯** menu → **Edit** and choose a **Category**. A gig cost only needs a category when it has none. Your lists are under [Expense and equipment categories](/settings/categories/).

The CSV adds the line number and name, the gig and the miles as separate columns.

## The Assets report

The Assets report lists the depreciated equipment you bought in the year, counted on the purchase date. Items you expensed aren't here.

The boxes at the top show **Bought in {year}**, the number of **Items**, **Need a recovery period** (when any are missing) and **De minimis candidates**. A row of totals by recovery period follows, with "No period yet" for items without one.

The table has **Date bought**, **Description**, **Category**, **Qty**, **Cost each**, **Cost** (what was paid, including tax and shipping), **Recovery period** and **De minimis**, with a **Total**.

- **Recovery period** shows 5-year, 7-year or 15-year. If an item has none, select **Choose…** to open its equipment record and pick one. See [Recovery period](/financials/tax-treatment/#recovery-period).
- **Candidate** in **De minimis** marks items costing $2,500 or less each. The safe harbor could expense them, but you decide that when you file.

If you bought no depreciated equipment, you'll see "No depreciated equipment was bought in {year}."

![The Assets report for 2026: Tax year, the report buttons, Download CSV, totals for equipment bought, items and de minimis candidates, the 7-year total, and a table of depreciated equipment with cost and recovery period](../../../assets/screenshots/financials/reporting-assets.png)

### Disposed of in {year}

**Disposed of in {year}** lists depreciated equipment you sold, retired or wrote off as missing in the year, whenever you bought it. Each unit or lot has its own row, at its share of the purchase line's cost. Equipment written off as missing has the status **Missing** and no sale proceeds. It shows **Description**, **Date bought**, **Cost**, **Date disposed**, **Sale proceeds** and **Status**. Select **Download disposals CSV** to save it.

## The Grey zone report

The Grey zone report lists the equipment you bought in the year that cost from $200 to $2,500 each, including its share of tax and shipping. Items in that range can be expensed or depreciated, and the choice is yours, so this is the list to check before you file. Equipment means items filed under an equipment category, or tracked as equipment. Both treatments are listed.

The boxes at the top show **Grey zone in {year}**, and how many are **Expensed** and **Depreciated**. The table has **Date bought**, **Description**, **Category**, **Qty**, **Cost each**, **Cost** and **Treatment** (**Expense** or **Depreciate**), with a **Total**.

To change an item's treatment, select **Change…** beside it. The purchase opens for editing; choose **Expense** or **Depreciate** on the line and select **Save Changes**. The report updates when you save. In a filed year the report is read-only and **Change…** doesn't appear. See [Tax treatment and equipment](/financials/tax-treatment/).

If nothing falls in the range, you'll see "No equipment costing $200 to $2,500 each was bought in {year}."

The CSV adds the vendor and a **Tracked as equipment** column.

![The Grey zone report for 2026: the total, 1 expensed and 2 depreciated, then a stage box and four moving heads set to Depreciate and a lighting controller set to Expense, each with Change…](../../../assets/screenshots/financials/reporting-grey-zone.png)

## The Schedule C report

The Schedule C report pulls the year together in the order of your Schedule C. It has no figures of its own: gross receipts are the Income report's total, and each line is the Expenses report's total for that line.

The boxes at the top show **Gross receipts {year}**, **Expenses** and **Net before depreciation**. The table goes:

1. **Gross receipts**.
2. **Line 4: Cost of goods sold (Part III)**, the Expenses report's line 4 total ($0.00 if you have none).
3. **Gross profit**: gross receipts less cost of goods sold.
4. Each other Schedule C line that has expenses, such as **Line 9: Car and truck expenses**.
5. **Total expenses**, which doesn't include line 4.
6. **Net (before depreciation)**: gross profit less total expenses.

- **Line 9** also shows its miles, and a note under it gives what those miles come to at the IRS rate on each trip's date. Mileage is counted once, on its category's line. If the mileage you recorded differs from the IRS-rate amount, or a trip has a different category, an amber note says what to correct on the gig's [Financials tab](/financials/gig-expenses/).
- **No category (no Schedule C line)** appears in amber when some expenses have no category, or one that isn't on your list. It's included in the total. Fix it as described under [The Expenses report](#the-expenses-report).
- **Not deducted (category has no Schedule C line; not in total)** appears below the net when expenses are in a category with no Schedule C line, such as Reimbursable. It isn't in the total or the net.

Depreciation isn't included: "Depreciation and Section 179 are worked out by your tax program from the Assets report." If no expenses were paid, the table says "No expenses were paid in {year}."

The CSV has the columns **Line**, **Description**, **Amount** and **Miles**, with the rows in the same order, line 4 and gross profit included.

![The Schedule C report for 2026: gross receipts, expenses and net before depreciation, then a table from Gross receipts, Line 4 Cost of goods sold at $0.00 and Gross profit, through Line 9 with 124 miles at the IRS rate, Lines 11, 20a, 22 and 27b, an amber No category row, Total expenses and Net, with the depreciation note below](../../../assets/screenshots/financials/reporting-schedule-c.png)

## The Needs attention report

The Needs attention report lists what would leave the year's reports wrong or incomplete. Only groups with something in them appear, each with a count:

- **Expensed with no expense category:** purchases with no category, or one that isn't on your expense list.
- **Depreciated with no recovery period:** depreciated equipment bought in the year with no recovery period, and depreciated purchases that aren't tracked as equipment.
- **Equipment with no cost:** equipment bought in the year with no cost.
- **Disposed or returned with no date disposed:** equipment marked Disposed or Returned with no date, whatever year it was bought.
- **Invoices that don't add up:** invoices dated in the year whose lines don't add up to the invoice total, with how far off they are.

Each row shows the **Item**, **Date**, **Amount** and **Problem**. Select **Edit purchase…** to open the purchase, or **Edit equipment…** to open the equipment record. The report updates when you save a purchase. In a filed year, **Edit purchase…** doesn't appear, but **Edit equipment…** still does.

If there's nothing to fix, you'll see "Nothing needs attention for {year}."

The CSV has the columns **Group**, **Item**, **Date**, **Amount** and **Problem**.

![The Needs attention report for 2026: an AA batteries receipt line with No category, and a Harbor Truck Rental invoice whose lines total $378.40 against an invoice total of $423.40, each with Edit purchase…](../../../assets/screenshots/financials/reporting-needs-attention.png)

## Filing a year

Below the reports, **Filed tax years** shows which years are locked. An Admin locks a year after filing; Managers can see the list. Locking, and what it protects, is explained in [Tax treatment and equipment](/financials/tax-treatment/#filed-years-are-locked).

## Related

- [Tax treatment and equipment](/financials/tax-treatment/)
- [Purchases](/financials/purchases/)
- [Expense and equipment categories](/settings/categories/)
