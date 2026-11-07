# Access-Request System — Pre-Merge Manual Test Checklist

**PR**: #48 (`claude/zealous-allen-f50osq` → `main`)
**Covers**: issues #33 (org-claiming access requests), #24 (claimed-aware org edit/delete
gating), #30 (Create Organization copy), #46 (domain-matched self-join), #47 (email on
outcome), plus the follow-up fix for `platform_moderator`/`claimed` never reaching the
client, and the Approve/Reject button UI change.

This touches access control (who can edit an org, who can promote whom) — please run
this checklist against a hosted dev backend before merging, not just review the diff.

---

## Prerequisites

- [ ] Migrations applied to the dev Supabase project (in order):
      `20260908000000_access_requests_and_claimed_orgs.sql`,
      `20260908010000_fix_get_complete_user_data_missing_fields.sql`.
- [ ] `RESEND_API_KEY` secret set on the dev project (done — domain `gigwrangler.com`
      verified). Confirm `RESEND_FROM_EMAIL` is set to an address on that domain,
      otherwise email only delivers to your own Resend account address.
- [ ] At least two test user accounts: **Requester** (will self-join/request access) and
      **Moderator** (will approve/reject as a platform moderator).
- [ ] Flag the Moderator account directly via SQL (no UI for this yet):
      `UPDATE users SET platform_moderator = true WHERE email = '<moderator email>';`
- [ ] Have (or create) one organization with `allowed_domains` set to a domain that
      matches the Requester's email, for the self-join test in §2.

---

## 1. Org Creation & Claiming (#30, #24)

- [ ] Create Organization → **Create without Joining**: explanatory text is visible
      near the button (partner-org / stays unclaimed until claimed).
- [ ] That org saves as **unclaimed** — shows an amber **"Unclaimed"** badge next to its
      name on the Admin org list (Browse All Organizations).
- [ ] Create Organization → **Create and Join**: you become Admin immediately; the org
      does **not** show the Unclaimed badge.
- [ ] Open the unclaimed org's edit form as its creator (or any other org's Admin): amber
      banner reads roughly *"hasn't been claimed yet, so any organization's Admin —
      including you — can edit it."* Edit and save succeeds.
- [ ] Open a **claimed** org's edit form as an Admin of a *different* org (not this one):
      red banner reads *"already has its own Admin — only that Admin can edit its
      details."* Edit/Delete buttons are hidden on the Admin org list for this org/user
      combination, and saving via a direct URL should fail server-side if attempted.
- [ ] Open a claimed org's edit form as *that org's own* Admin: no banner, edit/save
      works normally.

## 2. Joining an organization (#46; requests to join from migration 20261107060000)

- [ ] As the Requester, find an org whose `allowed_domains` does **not** match their
      email: a single **"Request to join"** button. Clicking it shows a toast and the
      button becomes **"Request pending"** (also after a reload).
- [ ] As that org's Admin **or Manager**, the Team screen lists the request under
      **Pending Access Requests** as **"Join as Viewer"**. Approving it adds the Requester
      as a Viewer; the Requester gets the "Your request to join … was approved" notice.
- [ ] Find the org whose `allowed_domains` **does** match (with a confirmed email): two
      buttons appear (**Join as Staff** / **Request to join**). **Join as Staff** lands the
      Requester as Staff straight away (check their role on the Team screen).

## 3. Access Requests — Unclaimed Org (needs the Moderator flag from Prerequisites)

- [ ] As a Viewer/Staff member of an **unclaimed** org, Team screen shows a
      **"Request Access"** button (in place of "Add Team Member"). Submit a request for
      **Manager** or **Admin**, with an optional message.
- [ ] As the Moderator, open the header avatar dropdown → **"Access Requests"** (only
      visible to a platform moderator) → lands on `/admin/access-requests`. The pending
      request appears, showing organization, requester, requested role, message, date.
- [ ] Approve it: requester's role actually updates (check Team screen); the org's
      "Unclaimed" badge disappears (claimed flipped to true, since this was an Admin
      approval); the row disappears from the moderator queue.
- [ ] Submit a second request from another Viewer/Staff member of a (still, or newly)
      unclaimed org; **Reject** it: role unchanged, row disappears, no claim-flip.
- [ ] Directly visiting `/admin/access-requests` as a **non-moderator** redirects away
      (does not show the queue).

## 4. Access Requests — Claimed Org

- [ ] As Viewer/Staff on an already-**claimed** org, submit another access request.
- [ ] As *that org's* Admin (not a moderator), Team screen's **"Pending Access
      Requests"** card shows it. Approve/Reject via the inline green check / red X
      buttons (not a "..." menu) — confirm both actually update state as in §3.
- [ ] As a **different** org's Admin (not a moderator, not this org's Admin), confirm
      you do **not** see this request anywhere (Team screen for their own org, nor the
      moderator queue).

## 5. Notifications

- [ ] While a request is pending, the Moderator's/Admin's header bell shows a badge
      count including it.
- [ ] After decision, the Requester's own bell badge shows the outcome; clicking it
      shows "Your request for _role_ on _org_ was approved/rejected" (+ message if any)
      and dismisses on click (badge count drops).
- [ ] Requester receives the **email** for both an approval and a rejection (check
      spam). Confirms `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are working end-to-end.

## 6. Regression check

- [ ] Existing Team screen flows (Add Team Member, invite, edit member, remove member,
      cancel invitation) still work unchanged.
- [ ] `npm run typecheck`, `npm run lint` (0 errors), `npm run test:run`, `npm run build`
      all pass on the branch (already green in CI as of PR #48 — re-confirm only if you
      pull the branch locally).

---

## Notes

- No UI exists yet to grant `platform_moderator` — must be set via SQL per Prerequisites.
- The Resend "From" address defaults to `onboarding@resend.dev` sandbox sender if
  `RESEND_FROM_EMAIL` isn't set — that only delivers to your own Resend account email,
  not the actual requester, so §5's email step will look like it's failing unless
  `RESEND_FROM_EMAIL` is set to a `gigwrangler.com` address.
- Email send failures are logged server-side but never block the approve/reject action
  itself (best-effort) — if §5's in-app notice works but email doesn't arrive, that's
  an email-config issue, not a broken decision.
