---
title: A gig's money
description: Bookings, payments, expenses, mileage and staff pay on a gig's Financials tab.
sidebar:
  order: 5
---

Every gig has a **Financials** tab (Admins and Managers). It shows the gig's **money in** (bookings and payments) and **money out** (expenses, sub-contractors, staff pay), and whether the gig makes money.

## The summary

| | Means |
|---|---|
| **Expected** | Money in that's agreed (accepted or later) |
| **Received** | Money in that has arrived |
| **Owed to you** | Agreed but not paid yet; shows what's **due now** |
| **Costs** | Money out: paid, owed, and staff booked but not yet finalized |
| **Net** | Expected minus costs, with your margin |

The badge next to the title sums up money in: **Paid**, **Payment due**, **Overdue**, or the stage of what's still open.

## Stages

Each booking and each cost sits at a stage. You can skip stages, so a handshake deal can go straight from **Accepted** to **Paid**.

| Money in | Money out |
|---|---|
| Quoted | Bid requested · Bid received |
| Accepted (incl. verbal / informal) | Accepted |
| Contract sent · Contracted | Contract sent · Contracted |
| Invoiced | Owed |
| Paid | Paid |
| Declined · Cancelled | Declined · Cancelled |

**Expected** counts everything from **Accepted** on. Something unpaid is **due** on its due date or, with no due date, once the gig is over.

## Adding money

Click **Edit Financials** to show the buttons.

| Button | Records |
|---|---|
| **Booking** | Income you've agreed: the stage, date, amount and description (e.g. "Performance fee"). An **Invoiced** booking also takes a due date. |
| **Payment received** | Money that has already arrived. If the gig has an open booking, you can apply the payment to it (see [Getting paid](#getting-paid)). |
| **Expense / Mileage** | Choose **Simple Expense** or **Mileage** (below). |
| **Other** | Any row, with every field: direction, stage, amounts, dates, category, reference, the other party, notes. Desktop only. |
| **Upload Receipt** | Scans a receipt and records it as a purchase and as this gig's cost. See [Receipts and invoices](/financials/receipts-and-invoices/). |

**Simple Expense:**
- **Date**, **Amount**, **Category** and **Description**.
- **Already paid**: leave it off if you still owe the money.
- **Receipt (optional)**: attach the receipt now.

**Mileage:**
- Enter odometer **Start** and **End**, or the **Miles Driven**.
- GigWrangler multiplies by the IRS standard mileage rate for that date and records it as a paid car and truck expense.

## Getting paid

**Record Payment** on a booking opens **Record payment received**, which asks for the amount, the date and a reference (check number, transaction id). Select **Save payment**.

**Payment received** does the same when the gig has an open booking (from **Quoted** to **Invoiced**). It shows **Apply to**, with the earliest open booking chosen and its amount filled in, so the booking is paid off rather than counted twice. To record money that isn't for a booking, choose **Separate payment (no booking)**.

If less than the agreed amount arrived, you choose what the rest is:
- **Still owed:** the rest becomes its own row, named after the booking with "(remainder)" added, at the same stage and due date. You see "Payment recorded; {amount} still owed".
- **Not coming:** the booking is settled for what you received. History keeps the change.

The payment and the remainder are saved together, so a refused payment leaves nothing behind. In a [filed tax year](/financials/tax-treatment/#filed-years-are-locked), a payment is refused with "The {year} tax year is locked (filed): …".

On a cost, **Mark paid** does the same for money you paid out.

The **…** menu on any row offers **Edit**, **Set stage** and **Remove**.

## Staff pay

Staff booked on the gig show under **Projected staff costs** until you finalize them in the gig's staffing section (**Finalize Assignment** or **Finalize All**). A fee shows in full. A rate shows an estimate from the gig's times, such as "est. 9.5 hr × $35.00 / hr = $332.50": hours from start to end for an hourly rate, the gig's days for a day rate, and one per gig day for a half-day rate. The same estimate is in **staff booked** at the top of the tab, on the printed sheet and in [Gig Accounting](/financials/gig-accounting/).

- **Finalizing** adds the pay to money out as **Owed**, labelled "Labor: {role}" and marked **Staff**. It's dated the gig's start date, in the gig's time zone, not the day you finalize. For a gig in a filed tax year, finalizing is refused with "The {year} tax year is locked (filed), so no gig income or expenses can be added to it."
- **A fee** is paid as entered, even $0.
- **A rate** asks how many of its unit were worked (hours, days or half days), and the amount is the rate times that number.
- **Undo Finalize** takes the row back out, with any receipt attached to it, and History records it. If the row can't be removed (for example, its year is filed), the assignment stays finalized.

## Where a cost came from

Money-out rows carry a source badge: **Receipt** (from a purchase), **Staff**, or **Manual**.

On a **Receipt** row, the link icon opens that purchase in **Financials → Purchases**.

## Receipts and documents

The paperclip on a row opens **Receipts & documents**. Upload as many files as you like; they stay with that row.

## On a phone

The gig's Financials card shows **Revenue**, **Costs** and **Profit**. In edit mode, the same buttons appear, except **Other** and **Upload Receipt**.

**View N Transactions** lists every row, named as on a computer: its description, or **Booking** or **Expense** if it has none. Under the name are the stage and the date, such as "Accepted, payment due · Oct 10, 2026". Tap a row for its details and its **Receipts & Documents**.
