---
title: Phone notifications
description: "Alerts on your phone for invites, replies, gig changes, requests and payment reminders. Each one can be switched off in Settings."
draft: true
sidebar:
  order: 6
---

<!-- Written from the approved plan (WORK_PLAN §3e item 2), ahead of the feature. Kept draft: true until
     the prod deploy that ships it; then check the wording on dev and prod, add the screenshots, and
     remove draft. -->

GigWrangler can send alerts to your phone, or to a computer's browser, when something needs you: an invitation to work a gig, a reply to one you sent, a change to a gig you're on, a request to join, or a payment that's due. Everything that sends an alert also appears in the bell (top right), as before.

## Turning notifications on

Notifications are turned on for each device separately.

1. Open **Settings → Notifications**. On a computer it's under the avatar menu → **Settings**. On a phone, tap **Settings** in the bottom bar.
2. Tap **Turn on notifications on this device**.
3. Your browser or phone then asks whether to allow notifications. Allow them.

GigWrangler only asks for permission after you tap the button.

**On an iPhone**, notifications only work in the app added to the Home Screen (iOS 16.4 or later), not in a Safari tab. In a Safari tab, the section shows a hint to **Add to Home Screen** first. In Safari, tap the Share button, then **Add to Home Screen**, then open GigWrangler from the Home Screen icon and turn notifications on there.

The section shows where this device stands:

| State | Meaning |
|---|---|
| **On** | This device gets alerts. |
| **Off** | This device doesn't get alerts. |
| **Blocked** | You told the browser or phone not to allow notifications. The section explains how to allow them again in the browser's or phone's settings. |
| **Not supported** | This browser can't receive notifications. On an iPhone, use the Home Screen app. |

**Turn off on this device** stops alerts on the device you're using. Below it is a list of your other devices with notifications on, each with **Remove**. You can have up to 10.

## The alerts

All of them are on to start with. Each has its own switch in **Settings → Notifications**. A switch only turns off the phone alert: the bell still shows everything.

| Alert | Who gets it |
|---|---|
| **Assignment invites**: you're invited to work a gig. | The person invited. |
| **Replies**: someone accepts or declines an invitation. | Admins and Managers of the organization that invited them. |
| **Gig changes**: a gig's date, time or venue changes, or it's cancelled. | The gig's assigned staff. Several changes made close together send one alert. |
| **Join and access requests**: someone asks to join, or asks for a role. | Admins and Managers. |
| **Payments due and overdue**: money owed to you, and bills you owe. | Admins only. |

Payment reminders come as one summary a day, in the morning (US time): one alert on the due date, and another once a payment is overdue. They never show amounts or names, only a count, such as "2 payments are due today. Open GigWrangler for details."

## On the lock screen

Alerts can show gig titles and people's names. They never show amounts, rates, email addresses or phone numbers.

To keep even titles and names off the lock screen, turn on **Hide details on the lock screen** in **Settings → Notifications**. It's off to start with.

## Tapping an alert

Tapping an alert opens the screen it's about: the gig, the requests on **Team**, or **Financials**. It also marks the matching notification in the bell as read.

## Signing out

Signing out stops alerts on that device. If someone else signs in on the same phone, it gets their alerts, not yours.

## Related

- [Settings & integrations](/settings/overview/)
- [Access requests & moderation](/reference/access-requests-and-moderation/)
- [Invitations](/team/invitations/)
