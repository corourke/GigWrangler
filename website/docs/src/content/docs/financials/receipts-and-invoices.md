---
title: Receipts and invoices
description: The three places to scan an invoice, the review screen, and attaching files without scanning.
sidebar:
  order: 2
---

A **purchase** is one invoice or receipt. GigWrangler stores the invoice total and one line per item, and keeps the file with it.

## Scanning: three places

Scanning reads a PDF or photo and fills in the vendor, date, total and line items for you. Nothing is saved until you've checked it.

Admins and Managers can scan; Staff and Viewers don't see the scan buttons. Each file can be a PDF or a JPEG, PNG, WebP or GIF image, up to 10 MB.

Scanning has limits: 200 files per organization in any 24 hours, and 60 per person in any hour. Past them, a scan fails with "Scan limit reached for this organization (200 scans in the last 24 hours). Try again later." or "Scan limit reached (60/hour). Try again later." Both limits count back from the moment you scan, so capacity frees up gradually rather than at midnight. In the scan queue the file shows as **Failed**, and you can **Retry** it later.

### 1. Financials → Purchases → Scan invoices

Use this for a stack of invoices.

1. Click **Add invoices**, or drag files onto the page. You can add several at once.
2. They're read in the background. Each takes 10 to 30 seconds, and you can go back to the report or another page meanwhile. The **Scan queue** shows each file as **Waiting**, **Scanning…**, **Ready to review** or **Failed**.
3. The first invoice that's ready opens for review. Check it, then click **Save Purchase**. The next one opens.

**Discard** deletes the file and saves nothing. **Retry** tries a failed file again.

The queue belongs to your organization, so another Admin or Manager can pick up where you left off. The **Scan invoices** button on Purchases shows how many invoices are waiting for review.

### 2. A gig → Financials → Upload Receipt

Use this for a receipt that belongs to one gig, such as a van rental for that show.

1. Open the gig, go to its **Financials** tab and click **Edit Financials**.
2. Click **Upload Receipt** and choose one file.
3. Check the purchase and save it.

Saving creates the purchase and makes each **expensed** item a cost of the gig: it's linked to the gig and added to the gig's **money out**, one row per item, in the same save as the purchase. Equipment you **depreciate** isn't a gig's cost, so it's saved as a purchase only.

### 3. Equipment → Upload Invoice

Use this when you've bought equipment. It works like Scan invoices, for one file.

If the file can't be scanned, you're taken to manual entry.

## The review screen

The same screen appears for every scan, for **Add purchase**, and when you edit a saved purchase.

- **Purchase Summary:**
  - **Vendor**, **Date**, **Description / Notes**.
  - **Invoice Total**, which is the total you actually paid, including tax and shipping.
- **Line Items:** one row per item, with **Description**, **Item Price**, **Qty**, **Line Amt** and **Unit Cost**.
  - **Unit Cost** is calculated: the invoice total is spread across the lines (see [Cost allocation](/financials/cost-allocation/)).
  - **Add Item** adds a line; the trash icon removes one.
- **Two questions on every line** (see [Tax treatment and equipment](/financials/tax-treatment/)):
  - **Expense | Depreciate:** how the item counts for tax. It's set for you from the item's cost: **Expense** under $200, **Depreciate** over $2,500. Between those you choose; the **(?)** explains. **Save Purchase** waits until every line has one.
  - **Equipment:** the switch at the end of the line's second row, after the expense category. Turn it on for gear you look after. Saving creates its equipment: one record for each unit, or one record for a lot. A lot is the default until you choose otherwise in the Equipment details. Once it's on, the word **Equipment** gives way to the item's details: Category › Type, the recovery period if it's depreciated, and how many units it has (or **lot of** that many). Click the details to change them; see below.
  - The details turn amber when something is missing: **Choose an equipment category**, **Choose a recovery period** for a depreciated item, or **Serials or tags needed** when a unit has neither.
- **Categories**, picked from your organization's lists (an Admin edits them under **Settings → Categories**; see [Expense and equipment categories](/settings/categories/)):
  - **Expense:** for an expensed item, the heading it goes under at tax time (Small audio parts, Supplies, Software subscriptions, Insurance, …).
  - **Equipment category:** for anything tracked as equipment, chosen in the Equipment details pop-up (Audio, Lighting, Cases/Bags, …). **Save Purchase** waits until every new piece of equipment has one.
  - A depreciated item has only the equipment category. An expensed item tracked as equipment has both.
- **Equipment details** pop-up (click the details next to a line's Equipment switch):
  - **What it is:** pick **An item we already have**, or describe **A new item**: **Manufacturer and Model**, **Category** (from your organization's equipment categories; **Add new category…** lets you type a new one), **Type**, **Insurance Class** and **Description**. **Type** goes from general to specific, separated by commas (Cable, XLR or Microphone, Vocal, Dynamic); the list offers the types already used in that category, with how many items use each. If a new item looks like one you already have, GigWrangler suggests it.
  - **Unit or lot:** **Unit** gives each piece its own row for a **Serial Number** or **Inventory Tag ID**, and every unit needs one of the two. **Number tags**, **Paste serials** and **Scan** fill the rows quickly. **Lot** counts identical pieces together, with no serial or tag. The quantity comes from the line; change it there.
  - **Insurance:** **Replacement Value** (it starts at the item price, and is copied to each unit) and whether it's been added to an insurance policy.
  - **Recovery period:** for a depreciated item only. See [Recovery period](/financials/tax-treatment/#recovery-period).
  - **Done** keeps the changes; they're saved with the purchase. It waits until every unit has a serial or tag and no tag is used twice.
  - Kits aren't set here. Once the purchase is saved, add the equipment to a kit from the kit.
  - Once a line's equipment is saved, its item and whether it's units or a lot can't be changed here. You can still edit serials, tags, value and insurance.
- **Saving** (**Save Purchase**, or **Save Changes** when you edit) also waits until every depreciated item has a recovery period and every unit has a serial number or tag. A note under the lines says which items still need one.
- **Reconciled / Mismatch:** at the bottom, GigWrangler compares the lines with the invoice total. **Mismatch** means they differ by more than 5¢. Fix the total or the lines before saving.

The scan suggests which lines are equipment and suggests categories; for expensed items it picks the matching heading (a scanned "Audio" becomes **Small audio parts**). Change anything that's wrong.

When you **edit** a saved purchase and the change also affects linked equipment or a gig's money out, GigWrangler lists those changes in **Confirm linked record updates** and asks you to **Confirm & Save**.

An edit is saved all at once: the purchase, its lines, its equipment and the gig's money out. If any part is refused, for example because its year is filed, nothing changes.

If you change a saved line's quantity, it also asks what to do with that line's equipment:

- **Update the equipment:** for a lot, the lot becomes the line's new quantity. For units, when the quantity goes down, tick which units come off, then choose **Delete them** (their kits and scan history go with them) or **Mark Inactive** (kept, with their kits and scans, but no longer on this purchase).
- **Leave the equipment as it is:** only the line changes.

**Confirm & Save** waits until you've decided for each line. Raising the quantity of a line with units adds rows in its Equipment details for the new units' serials or tags.

## Attaching a file without scanning

| Where | Button | The file goes with |
|---|---|---|
| Purchases report, on an invoice | **Attach Doc** (then **View Doc**) | The purchase |
| A gig → Financials, on a money row | Paperclip → **Receipts & documents** → **Upload** | That money row |
| A gig → **Expense / Mileage** → **Simple Expense** | **Receipt (optional)** | The new expense |
| Phone: a gig's transaction → **Receipts & Documents** | **Upload** | That money row |
| An asset's page or edit form | **Asset Attachments** → **Upload** | The equipment (manuals, photos) |

Each file can be up to 25 MB, and can be a PDF, an image (JPEG, PNG, WebP, GIF or HEIC), a Word, Excel or PowerPoint document (.docx, .xlsx, .pptx) or a CSV file. The scan buttons offer only what scanning reads: a PDF or a JPEG, PNG, WebP or GIF image. Any other file is refused with "Attach a PDF, an image, an Office document or a CSV (Word, Excel, PowerPoint)", and a larger one with "Files can be up to 25 MB".

:::tip
**Add purchase** has no file upload. Save the purchase, then use **Attach Doc** on it in the Purchases report.
:::

## Importing a spreadsheet

On **Equipment → Items**, choose **Import**: the **CSV Import** page opens with **Assets** selected, and its **Back** arrow returns to Items. It creates purchases and equipment from a spreadsheet of past purchases. Imported purchases aren't linked to gigs and have no files attached; link and attach them afterwards from the Purchases report.
