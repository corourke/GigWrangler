---
title: Tax treatment and equipment
description: Expense or depreciate, tracking gear as equipment, and filed years.
sidebar:
  order: 7
---

Every item you buy raises two separate questions. GigWrangler now asks them separately.

Both questions appear on every line of the purchase screen, whether you scan an invoice, add one by hand, or edit one.

## 1. Track as equipment?

Turn on the **Equipment** switch under the line for gear you'll look after: cables, stands, fixtures, cases. It gets equipment records (one for each unit, or one for a lot), so you can tag it and put it in kits. In its **Equipment details** you say what item it is, with its equipment category (Audio, Lighting, …).

Leave it off for things you use up, like tape, batteries and software.

## 2. Expense or depreciate?

For tax purposes, each item is either an **expense** (deducted in the year you buy it) or a **depreciable asset** (deducted over several years). Choose **Expense** or **Depreciate** under the line. The **(?)** next to the choice explains it:

> Per-item cost of less than $200 should automatically be expensed. Any item over $2500 should be depreciated. From $200 to $2500 is a grey zone.

- **Under $200 per item:** set to **Expense** for you.
- **Over $2,500:** set to **Depreciate**.
- **In between:** you choose. Until you do, the choice is outlined in amber and **Save Purchase** waits, with a note saying how many items still need a choice. The [Grey zone report](/financials/reporting/#the-grey-zone-report) lists a year's in-between equipment, so you can check your choices before you file.

You can change it until you file that year's taxes: **Edit** the purchase in **Financials → Purchases**. Whether you elect the de minimis safe harbor is decided when you file, so GigWrangler never forces it.

Per-item cost is the item's cost after tax and shipping (see [Cost allocation](/financials/cost-allocation/)).

Goods you buy to resell are expensed: choose **Expense** and an expense category on line 4, cost of goods sold. See [Goods you buy to resell](/settings/categories/#goods-you-buy-to-resell).

## How the two fit together

| | Expense | Depreciate |
|---|---|---|
| Track as equipment | Optional | Always |
| Count it as a cost of a gig | Optional | Never |
| Category | An expense heading (and an equipment category if it's equipment) | An equipment category |
| Recovery period (5, 7 or 15 years) | — | Yes, set on the equipment record (see [Recovery period](#recovery-period)) |

A cable bought for one show can be that gig's cost **and** go in a kit. Depreciated gear belongs to the business, not to one gig.

- Choosing **Depreciate** turns on **Equipment** for you, and it stays on.
- A line that's already a gig's cost can't be switched to **Depreciate**. Remove it from the gig first.
- To start tracking something you bought earlier, open its line in **Financials → Purchases** and click **Track as equipment**.

Your gig costs and your tax figures never double-count. A purchase linked to a gig shows in the gig's money out so you can see the gig's profit, but for tax it's counted once, from the purchase.

## Recovery period

Depreciated equipment also needs a recovery period: **5-year** (computers and office machines), **7-year** (most production gear) or **15-year** (building out a leased shop or studio). Your tax program uses it to work out the depreciation, and the [Assets report](/financials/reporting/#the-assets-report) under **Financials → Reporting** lists it for each item.

Choose it in the equipment details on the purchase line, or in the equipment's own form, in **Recovery period**.

- **From the category:** if the equipment category has a default (set in **Settings → Categories**), you'll see "The default for" that category. Change it for an item if you need to.
- **No default:** the field turns amber and you'll see a note to choose one. The field shows **Choose a recovery period…**, and **Done** in the equipment details (and saving the equipment form) waits until you pick one.
- **Filed year:** once the year is filed, the period stays as it is.

## Filed years are locked

Once you've filed a year's taxes, an Admin locks that year under **Financials → Reporting → Filed tax years**: enter the year and the date you filed, then click **Lock year**.

- **Locked:** you can't change that year's purchases' costs, dates, categories or tax treatment, or add or delete purchases dated in it.
- **Gig money is locked too:** a gig's income, and its expenses that didn't come from a purchase (quick expenses, mileage, staff pay), dated in that year. Their amounts, dates, categories and status can't change, and you can't add or remove them. Their notes and descriptions still can. A gig expense that came from a purchase stays editable on the gig, because the purchase is what counts for tax.
- **Write-offs follow the year too:** you can't write off missing equipment in a locked year, and a write-off made in a locked year can't be undone.
- A change that a locked year refuses shows a message naming the year.
- **Still allowed:** tracking an item as equipment (and choosing its equipment category), putting it in kits, editing descriptions, and editing its equipment details: serials, tags, replacement value, insurance, and a recovery period that hasn't been set. Quantities and lines are locked, so units can't be added or removed.

Editing a purchase from a locked year shows a note saying so: "The {year} tax year is filed, so this purchase's costs, dates, categories and tax treatment can't change. You can still edit descriptions and track items as equipment."

If you need to amend a return, an Admin can **Unlock** the year. Managers can see which years are locked.
