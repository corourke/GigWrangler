---
title: Access requests & moderation
description: Ask to join an organization or for a higher role in it, and how Admins, Managers and platform moderators approve or reject the request.
sidebar:
  order: 2
---

There are two kinds of access request:

- A **request to join**, from someone who isn't a member yet. They send it with **Request to join** on the organization's card, as described in [Getting into an organization](/getting-started/organizations/#2-ask-to-join-an-existing-organization). The organization's Admins or Managers decide it.
- A **role request**, where a Viewer or Staff member asks for the Manager or Admin role in an organization they already belong to. The organization's Admins decide it.

If the organization has no Admin yet, a platform moderator decides both kinds.

## Requesting a higher role

Only Viewers and Staff see the button; Admins and Managers don't.

1. Open **Team**.
2. Select **Request Access** (top right).
3. Under **Requested role**, choose **Manager** or **Admin**.
4. Optionally, enter a **Message (optional)** saying why you need it.
5. Select **Submit Request**.

You see "Access request submitted". You can have one pending request per organization at a time; if you try to send a second, GigWrangler tells you that you already have one. Your role doesn't change until someone approves the request.

## Reviewing requests as an Admin or Manager

When someone asks to join, every Admin and Manager of the organization gets a notification in the bell (top right): "*Name* asked to join *Organization* as Viewer." When a member asks for a role, every Admin gets one: "*Name* requested *Role* on *Organization*." Select the notification to open **Team**.

Pending requests are in the **Pending Access Requests** card on **Team**, shown only while a request is waiting. Admins see every request; Managers see only requests to join. Each row shows the **Requester** (with email), the **Requested Role** (**Join as Viewer** for a request to join), the **Message** and the date **Requested**.

- Select **Approve** to accept. You see "Access request approved". Someone asking to join becomes a member with the role they asked for, Viewer; you can't pick a different one, but you can change their role afterwards like any member's. A member asking for a role gets it right away.
- Select **Reject** to decline. You see "Access request rejected", and their role stays as it was.

Either way the request leaves the list. You can't add a reply to the requester.

:::note
Admins can change a member's role directly, without a request, from **Team**. See [Roles & access](/reference/roles-and-access/).
:::

## What the requester sees

When the request is decided, the requester gets a notification in the bell: "Your request to join *Organization* was approved." for a request to join, or "Your request for *Role* on *Organization* was approved." for a role request ("…was rejected." if it wasn't). Select the notification to dismiss it. They also get an email with the same news, with the subject "Your request to join *Organization* was approved" or "Your *Role* request for *Organization* was approved" (or "rejected"). The email can fail to send without affecting the decision, so the bell is the reliable notice.

## Platform moderators

A **platform moderator** is an account that GigWrangler marks with extra rights across all organizations. There's no setting for this in the app. Moderators do two things:

- **Decide access requests for unclaimed organizations.** An organization is unclaimed until it has an Admin, for example a venue someone registered with **Create without Joining**. Nobody there can let people in or give them a role, so requests to join it and role requests both go to the moderators. To take one over, ask to join it, then, once you're in, request **Admin**.
- **Maintain the starter category lists.** These are the expense and equipment categories an organization is given the first time it needs a list.

A moderator has no say once an organization has an Admin, and has no access to its gigs or data.

### The moderator queue

Moderators have two extra items in the avatar menu (top right):

- **Access Requests** opens a queue of pending requests, to join and for a role, across every unclaimed organization. It has the same columns as the Admin's card, plus **Organization**, and the same **Approve** and **Reject** buttons. When it's empty you see "No Pending Requests". Select **Back to Select Organization** to leave.
- **Starter categories** opens the **Starter sets** that new organizations copy. Changing them doesn't change organizations that already have their own lists. See [Expense and equipment categories](/settings/categories/).

Moderators get a notification in the bell for each new request, and selecting it opens the queue.

### When a moderator approves an Admin request

If the request was for **Admin** on an unclaimed organization, approving it makes the person the organization's first Admin, and the organization becomes **claimed**. From then on its own Admins decide requests. Approving **Manager** on an unclaimed organization changes the person's role but leaves the organization unclaimed.

![The Pending Access Requests card on Team: a Staff member asking for Manager, with their message, the date, and Approve and Reject buttons](../../../assets/screenshots/reference/access-requests-pending-card.png)

![The platform moderator's Access Requests page: a venue contact asking to become Admin of an organization with no Admin yet, with Approve and Reject](../../../assets/screenshots/reference/access-requests-moderator-queue.png)

## Related

- [Getting into an organization](/getting-started/organizations/)
- [Roles & access](/reference/roles-and-access/)
- [Expense and equipment categories](/settings/categories/)
