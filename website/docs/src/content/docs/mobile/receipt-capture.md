---
title: Capturing receipts on your phone
description: "Photograph a receipt or pick a file on the phone and add it to the purchase scan queue for review on desktop."
draft: true
sidebar:
  order: 5
---

<!-- DRAFT (Docs Lead): written ahead of the feature (WORK_PLAN §3e item 1). Every label, message and
     limit below is a placeholder until the PR's UI is on dev and checked as each role. Publish after
     the prod deploy that ships it. -->

## Cover

- Who can capture (roles), and where the entry point is on the phone.
- Taking a photo, or picking a file / image from the phone; accepted types and size limit
  (match [Receipts & invoices](/financials/receipts-and-invoices/): 25 MB, scan limits).
- What happens next: the receipt joins the **scan queue**. There's **no review on the phone**:
  scanning and review happen on desktop, as today. Link to the desktop review steps.
- Capturing offline, if supported: does it queue and send on reconnect?
- Messages: success, a file that's too big or the wrong type, the scan limit reached.

## Screenshots

- 📸 The capture entry point on the phone.
- 📸 The confirmation after adding a receipt.
- 📸 The capture in the desktop scan queue.

## Source

WORK_PLAN §3e item 1; the feature's PR body. Table: `purchase_scan_queue`.
