# Work Plan

**What is current, and nothing else.** The board of record for open issues, decisions waiting on Cameron, work released to build, and the rules the agents follow. When something ships or is settled, take it out of here and add a line to [WORK_LOG.md](./WORK_LOG.md). Keep this file short.

**Who writes what.**
- The triage routine keeps §1 current and may add entries to §3b.
- Only the coordinator writes §2 and §3c, and only the coordinator asks Cameron questions, one at a time.
- The Docs Lead writes §3d and the user-docs table in §4.

This file lives on `main`. Land updates there promptly: a run that starts from `main` won't see edits parked on a feature branch.

- **Last updated:** 2026-10-29 (coordinator: **#322 in prod** (Cameron's deploy 10-29; verified read-only: `20261027000000` applied, line 4 present, build 2026-10-29T20:58Z). **Merged 10-29 with Cameron's OK:** #323 (guide for #322), #324 (Kits list shot), #326 (#325 cleanup; migration `20261029000000` on dev, **due in Cameron's next deploy**). **Engineering Lead:** #327 PR A (Location box click fix); PR B (manifest rework) waits on Cameron's Q1–Q4. **Cameron's #135 steps left:** run `apply.sql` (preview still passes, 194 changes), then the cost-of-goods category; item 10 later)

---

- **Cameron 10-18: finish and close #162, #183, #186. All three are closed:** #183 on 10-18, and #186 and #162 on 10-23. #186 Maintenance shipped in 4 steps: #296 (database, migration `20261022000000`, in prod 10-22), #298 (web list, in prod 10-22), #299 (phone) and #303 (desktop override, the Locations/Item page/packing-list lines, #300). **#299 and #303 are in prod (10-23).** The guide for all of #186 is published (#301, #302). The Equipment Lead is standing by for its next item (Cameron to choose). **#20 is done (closed 10-25):** batches 1–9 and PRs A–F merged; prod deploy pending.

## 1. Open issues

| # | Item | State | Next / owner |
|---|---|---|---|
| ~~[#162](https://github.com/corourke/GigManager/issues/162)~~ (closed 10-23) | Equipment items and units (serials, tags, quantities, kits); parent of #179–#186 | Mockups approved and merged 10-08 (PR #165, `docs/design/mockups/equipment-units/`); split into sub-issues | See the rows below |
| [#135](https://github.com/corourke/GigManager/issues/135) | Audit and fix 2026 purchase data | **Worksheet released to the Equipment Lead (Cameron 10-25)**, after the v1-drop PR: read-only SQL per scope item in `scripts/audit/2026-purchases/`, tested on dev; plan on #135 first. The coordinator runs it read-only on prod and gives Cameron the results privately (no prod data in public text). Fixes come later as a guarded dry run | Equipment Lead (worksheet); coordinator with Cameron (prod) |

- **Phone update notice (Cameron 10-14, approved):** the installed phone app doesn't announce new versions. Causes found: prod serves `/sw.js` with a 4-hour browser cache (Cloudflare zone setting), and iOS often skips the `controllerchange` event. **PR #291 merged 10-14 (b78067b, Cameron's OK):** a no-cache `/version.json` check on foreground and every 30 min, the same Reload banner, and `public/_headers`. Cameron may need a Cloudflare Cache Rule to bypass cache for `/sw.js`, `/registerSW.js` and `/version.json`.

- **#186 Maintenance and tracking override released to the Equipment Lead (Cameron, 10-14).** It starts after the phone list status-gate fix. The plan and migration design go on #186 for review first. The #135 audit remains unreleased.

- **Next prod deploy (Cameron 10-14: "let me know when"):** the coordinator tells Cameron when to run `./deploy_prod.sh`. Plan: deploy once the phone list status-gate fix merges, together with #291 and #289; if that fix stalls, deploy #291 and #289 without it. No migrations pending.

## 2. Waiting on Cameron

1. *(none blocking; bundle size is being handled in §3c)*
2. **Sentry (optional):** `VITE_SENTRY_DSN` is live in the prod web app (10-09). Still optional: `SENTRY_API_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG` on prod for the health check's Sentry check.

**Decided 10-08, recorded here until done:**
- The Docs Lead's corrected membership report (private; reported to Cameron directly): no path lets a Manager make anyone an Admin. The remaining backstop gaps are **parked** (Cameron: later). Partner organizations on a shared gig may keep adding, editing and removing each other's no-login contacts (intended). Person-search privacy is fixed by #178 (in prod 10-08).
- An organization's own Admin still can't delete a claimed organization from the app (kept as is; no change).

## 3. Ready work and agent lanes

### 3a. Pull requests

- **Open a PR only when the work is ready to merge.** Work under review (mockups, drafts awaiting a decision) is shown through an artifact or issue comments, or kept as a **draft** PR, and marked ready only when Cameron has approved it. A PR's CI and review should be the last step, not the review channel.
- The coordinator reviews and merges once CI is green and Cameron has OK'd it.
- Every PR body ends with **"User-visible changes"**: what a user now sees or does differently, with exact labels, or "None".

### 3b. Raised by triage, for the coordinator

*Triage adds entries here instead of asking Cameron. The coordinator resolves each one and deletes it.*

(none)

**Open PRs, 10-10 16:50 UTC:**
- **#246 (#185 PR 2, phone) on hold.** Cameron 10-10: no "swap" (removed by the Lead); interchangeable gear goes in kits as "any N" lines; for kits that list specific tags the operator decides each step (Maintenance via the note popup's checkbox, add the replacement ad hoc, a human updates the kit later). No new scanner menu, no kit review flag. **Note rule (Cameron, 10-10):** saving a note always appends a new tracking row that carries the item's last status (and lot quantity, location) forward, never counting it as packed; ticking Send to Maintenance (renamed from "Maintenance Req'd") appends "Sent to Maintenance." to the note; the popup shows the person's name, never a UUID. No database procedure did this (checked); it goes in the app service. Sent to the Equipment Lead 10-10 17:10. **Cameron 10-10 18:50:** a note on a unit last recorded at another gig is still recorded at this gig (carrying that status); Send to Maintenance is never blocked. Review of adea8b3 (10-10 19:00): needs changes (kit-level note rows read as checked, duplicate adds); sent to the Lead. Cameron 10-10 19:15: un-check after a note is not a bug; the note popup adds lines for last status / location, gig name, and last notes (if any); its buttons go in one row: Cancel, Clear note, Save. #246 must merge main (conflict with #253 in inventoryManagement.service.ts). **Kit notes (Cameron, 10-10 19:35):** a note on a kit writes one kit row with the note and nothing else (prod bug on main: a note on "Stage Snakes" at 19:26:30Z cascaded into two Checked Out unit rows and lost the note); a kit note must never make unscanned items read as checked. Sent to the Lead; fix ships with #246. **Re-review at a47064d (10-10 20:45):** Cameron's items all pass (kit note = one kit row, lines never inherit a kit row, popup lines and one-row buttons, duplicate adds); two small fixes sent (carry location from another gig's record; "+ Add" on a lot opens the counter). After that: Cameron tests claude/185-phone against dev before merge (dev already has 20261019000000). **10-11 04:30: ready for Cameron's branch test at 08939c8** (includes #257); the Lead's 11-step test list is in its session. **Cameron 10-11: leave it** — a note on a never-scanned item or case saves it as In Warehouse and may read as checked at Unload (it is in the warehouse); no note-marker column. Cameron tests the final phone changes on a branch before deploy. Mockup: https://claude.ai/artifact/JCVPy7Eid54tiLwZnteohd
- #250 merged 10-10 (equipment user-guide pages).
- **In prod 10-11:** #246, #251–#254, #257 and migration 20261019000000 (verified). The Docs Lead is publishing the #246 guide pages. **After the deploy (Cameron, 10-11):** SndEng Case and Stage Snakes still showed in two places on Locations (untagged one-piece items are lots; stale per-gig places). #258 (merged 10-11 05:51) fixes one-piece lots; #260 (open) selects each record's quantity so multi-piece lots work too; the Docs Lead's test of b07b728 found it dropped a T58 still On Site at a festival (pieces that came home in the Mic Case and went back out were counted twice), so cd98ef8 counts an untagged item inside a container as one place per case (newest across gigs); loose lots keep per-gig places and the lot-size rule. **#260 passed the Docs Lead's re-check @ cd98ef8 and merged 10-11 06:42. Main is ready for Cameron's prod deploy (#258, #260; no migrations).** #259 (Docs Lead, #246 guide pages) merged 10-11 after review fixes. Docs Lead next: the screenshot script's dashboard date problem and the Last Login gap. Both need a prod deploy. Stage Snakes' newest records are the 10-10 note-bug Checked Out rows; Cameron can Unload or Override them. Follow-up noted: no "still out at …" warning when packing a container that's still out at another gig. **Equipment Lead next (Cameron, 10-11): the packing-list fixes #245 and #249** (§3c). **#262 (merged 10-11 18:45):** Cameron's report: on mobile, Payment received on a Booked gig with an open booking added a second paid row and counted the revenue twice (Blue Valley @ Las Positas 10/9/2026, $250 booking + $250 paid row). Payment received now shows "Apply to" with the open booking selected and pays it off. Frontend only. The duplicate prod row (paid, ref "Venmo"): Cameron will clean it up in the app after the deploy (delete it, then Record Payment on the booking). **After the 10-11 evening deploy (Cameron):** his phone kept the old build (the PWA only checks on a full load), so Payment received added another duplicate (19:52, Venmo); he cleans it up in the app. **#263 (merged 10-11 20:16, not yet in prod):** mobile transactions name rows Booking / Expense and show desktop's stage text ("Accepted, payment due"). **#264 (open):** the app checks for a new version on return to the foreground and every 30 min, and shows "A new version of GigWrangler is ready." with Reload (never reloads by itself; Cameron's choice 10-11). Merge on Cameron's OK. Docs Lead's pre-deploy test of main @ 248994e (on #250): #251 and #252 pass; #253/#254 improve on prod, but lots in a case showed once per gig (#255). **Cameron (10-10 ~23:00): wait for the #255 fix (PR #257), then deploy.** Docs Lead's test of #257 @ 093edc0: the per-gig duplicates and gig filter are fixed, but when a case-only record moves the case away from its contents, LocationExplorer promoted the first item to a second case heading and dropped it from the list. Fixed in e659aa6 (contents list in full under a "Contents" heading), test first; the Docs Lead's re-check passed and **#257 merged 10-11 02:40. Main is ready for Cameron's prod deploy** (#251–#254, #257; no migrations). Also found: #256 (desktop Track a gig: the scanner's manual tag entry is blocked by the dialog; old bug, not yet released). Prod still has #248's two bugs and the Locations bug until then.

### 3c. Ready to build, nothing blocking

*Coordinator only.* An item here counts as approved in shape (AGENTS.md rule 1): post the plan on the issue, then build. Anything not here needs approval first.

**[#226](https://github.com/corourke/GigManager/issues/226) items 3, 5, 6 and 8: released to triage (Cameron, 10-09).** One PR per item, one per run, in this order; failing test first; no migrations. Post a short plan comment on #226 before each. Leave #226 open (other items stay parked). Avoid `src/services/conflictDetection*` and the kit files (the Equipment Lead is working there).
1. ~~**Item 8, URL guards.**~~ **Done: PR #233, merged 10-09.** Staff and Viewer opening `/assets/new`, `/assets/:id/edit` or `/financials` by URL are redirected to their landing page (same rule the menus use, `src/utils/permissions.ts`), with no flash of the form. Route-level, in `src/routes/` (guards or a small role-gate wrapper). Tests: each route × role.
2. ~~**Item 3, clearing a money field on the unit edit page saves.**~~ **Done: PR #237, merged 10-09.** In `AssetScreen.tsx` edit mode, clearing item price, item cost, replacement value or sale proceeds must save `null`, not drop the field as `undefined`. Test: clear each field, save, assert the update payload has `null`.
3. ~~**Item 5, $0 invoice total.**~~ **Done: PR #248 (in prod 10-10), follow-up fix PR #251.** In the purchase review (`ReviewScannedDataDialog.tsx`), when the invoice total is $0 (or empty) and the lines add up to more than $0, Save is blocked with "Enter the invoice total, or set it to match the lines ($X)." and a one-click "Use $X" fix. A total that matches its lines, including all-$0, still saves. Test both.
4. ~~**Item 6, tracked expensed line needs a category.**~~ **Done: PR #252, merged 10-10.** A purchase line that is tracked as equipment and expensed can't be saved without an expense category: the line shows "Choose an expense category" and Save is blocked until it has one. Untracked lines keep today's rule. Test both.


**Status 10-12 21:15 UTC:**
- **#281 (#175 PR 1, database):** CI green; an independent review says fix first (the details went to Cameron privately). **10-12: re-reviewed clean at d95dcdd (CI green). Applied to dev 10-12: migration `20261020000000` (17/17 dev gigs owned) and all three edge functions. **Merged 10-12 (13a78ce, Cameron's OK).** Prod needs the migration and a `server` deploy. Prod backfill dry run (read-only): 99/99 resolve, no child gigs.** Also folded into this PR: the participant-change path in the app (delete + insert with error checks), removal of the legacy delete route (needs an edge-function deploy), the demo-seed owner, and more RLS 62 cases. **Cameron 10-12:** an Inactive organization is also read-only on the gig schedule and on other organizations' contacts. The migration goes to dev only after re-review.

**Status 10-12 18:45 UTC:**
- **#280 merged** (docs: Kits page). The Docs Lead filed #278 (kit list Tracking Status count) and #279 (kit editor's Kit Contents table overflows its card). Fixed by a coordinator helper and merged 10-12 with Cameron's OK: #282 (Tracking Status reads the badge plus "N of M" at the active gig) and #283 (Kit Contents fits its card). Not yet in prod.
- **#175 PR 1 design approved (Cameron, 10-12; answers on #175):** RESTRICT on owner delete; any participating Admin/Manager may remove an unclaimed venue or act; the owner can't Leave or go Inactive; **an Inactive organization is read-only on the shared gig details**; the backfill fails loudly. Coordinator prod check (read-only): 99/99 gigs resolve, 0 unresolved, no children. The Equipment Lead is building the migration and PR 1; the coordinator applies it to dev after review.

**Status 10-12 15:00 UTC:**
- **Merged (not yet in prod):** #268 (#186 Locations step: Item filter, piece counts, "2 of 10", the where-is-it card, Move N of a lot with the case-split warning; fixes #160). No migration. The Docs Lead is drafting the Locations update and holding it for the deploy.
- **Docs:** #277 merged (pages for the 10-12 deploy). #280 (Kits page) is approved but conflicts with #277; the Docs Lead is merging main.
- **Equipment Lead next (Cameron 10-12): #175 full plan** (owner organization; delete, cancel, leave, Inactive), 3 PRs, migration first via a design comment on #175. **Not released:** the rest of #186 (Maintenance), #183 D2. #20 stays paused.

**Status 10-12 05:15 UTC:**
- **#274 merged** (docs: Locations page, live behaviour).
- **#268 (#186 Locations step, fixes #160):** the third independent check passed. Move N reads back correctly (the target row is written 1 ms after the closing return); there's one stale rule (an out place is stale when other places later held more pieces at once than the lot leaves; returns hold none); a lot home in two cases splits correctly; a move from home with none home is refused. **Cameron 10-12: moving part of a lot in a case to another gig is allowed, with a warning** ("These N leave <case>. The case stays at <gig>."). The Equipment Lead is adding it; then the merge waits on Cameron's OK.
- **In prod (Cameron's deploy 10-12; verified read-only: new build /static/index-CxUwJsRY.js serves the Reload banner, CSV Download Example, Undo write-off, the still-out warning, Separate payment, the Pieces wording; migrations unchanged at 20261019000000):** #263, #264, #267, #269, #270, #271, #272, #273, #276. Blue Valley @ Las Positas 10/9/2026 is clean (one Paid $250 booking, Venmo). The Docs Lead is publishing the held pages.

**Status 10-12 03:00 UTC:**
- **Merged since (not yet in prod):** #276 (#183 D: CSV import makes units, lots and kit lines through the v2 save; kit column kept; no status / retired_on / liquidation_amt; template regrouped; Download Example mic-kit file; held purchases; Retry failed; the app no longer calls v1), #269 (#265: container still out at another gig), #275 (docs: Payment received → Apply to). No migrations.
- **In review:** #268 (#186 Locations step): Equipment Lead pushed fixes for every finding; an independent re-check is running. #274 (docs: Locations page): two sentences contradict the 10-10 rule (contents keep their own records); the Docs Lead is fixing them.
- **#183 D2:** the cards and column guide shipped (#295, in prod 10-19). The v1 drop (PR #318, plan #317) is done: in prod 10-27.

**Status 10-12 22:45 UTC:**
- **In prod (Cameron's deploy 10-12):** #263, #264, #267, #269, #270, #271, #272, #273, #276.
- **In prod (Cameron's deploy 10-13, verified read-only):** #268, #282, #283, #281, #284. Migration `20261020000000` (99/99 gigs owned, all owners active participants); build `index-Oni_LDm_.js`; `server` v35 deployed 17:26 UTC. **In prod 10-14 (verified read-only):** #286 with migration `20261021000000` (helpers not executable by signed-in users; 0 ownerless gigs), build `index-CGoXgCqZ.js`. **In prod (Cameron's deploy by 10-18, build `index-Dvoy84DF.js`):** #291, #289, #293. `/version.json` is served. **In prod 10-19 (verified read-only):** #295 (#183 D2), build `index-N2lH3tA9.js`, version.json build 2026-10-19T19:43:35Z. **Merged, not yet in prod:** nothing. **Cloudflare:** `/sw.js` is still served with `max-age=14400` (the `_headers` no-cache is overridden by a zone setting), **Cameron added the Cache Rule 10-18; verified: `/sw.js`, `/registerSW.js` and `/version.json` all serve `cache-control: no-cache` (cf-cache-status DYNAMIC).**
- **#281 (#175 PR 1):** merged 10-12 with Cameron's OK (dev has it). **PR 2 is #284, merged 10-13 (58e0974, Cameron's OK)** (services): independent review found no blockers; review fixes in at 5ce0e26 (CI green); `server` deployed to dev 10-13. **Cameron 10-13:** duplicate is owner-only (the owner's Admins and Managers; clear message for others; PR 3 hides the button); a duplicate leaves Inactive participants off; leaving a gig is logged through a small migration in PR 3 (design on #175 first). Items 1–2 landed in #284 (828e8b1). **Cameron 10-13, Inactive redefined:** Inactive means the organization is being removed from the gig. It keeps and maintains its own financials and notes, but its staff and equipment are released, and it can't change anything else. Mark Inactive is refused until the org has released its own staff slots and kit assignments (release first, then Inactive). Gig History logs Inactive/Reactivated. In Participants, Remove runs right away behind a confirmation. Leave and Inactive are web-only this round. **Delete vs Cancel (Cameron 10-13):** Cancelled stays a status (no Cancel menu item). Delete Gig stays in the menu, disabled with a popover when other claimed organizations participate: "Delete gig is disabled as there are other claimed organizations participating -- you can Cancel the gig instead." Other refusals get their own reason. **PR 3 migration design approved by the coordinator 10-13** (one migration `20261021000000_gig_participant_inactive_rules.sql`: removal log, Inactive/Reactivated history, release-first rule, no new staff/kits while Inactive, own contacts read-only while Inactive — Cameron's "only financials and notes"); RLS tests 63 and 64. **#286 re-reviewed clean at 357d043 (CI green); migration `20261021000000` applied to dev 10-14. **Merged 10-14 (4ab55b4, Cameron's OK).** Follow-up PR with the Lead: stale-baseline participant save; mobile pack-out "+ Add" for an Inactive org. Earlier: **#286 (PR 3) review 10-13: fix first** — the migration's DB rules are enforced and tested; back to the Lead for an Inactive org's own-notes save, read-only staff/kit sections while Inactive, refusal copy, history-trigger edge cases and log once per leave (details to the Lead privately). Not yet on dev. **PR 3 (UI) started 10-13:** the leave-log design comes first on #175, then the UI, plus the mobile participant-save bug. The Docs Lead is drafting the #175 rules, held until prod.
- Open question for Cameron later: should #265's warning also cover a case *added* at pack-out?

**Released by Cameron 10-11 (answers recorded on each issue):**
- **Equipment Lead, in order, one PR each:** (1) #245 + #249: ticks don't print (blank boxes); the Columns choice is remembered per browser; print header "N kits · M pieces". (2) #186 next Locations step: home pieces show "Not checked out"; gig ↔ home moves only; desktop Mark for Maintenance waits; Item filter, piece counts, "2 of 10", where-is-it card, Move N of a lot (fixes #160), Item page "Where they are". (3) #265 container still out warning. (4) #242 items 5 (Undo write-off on the equipment page) and 7 (amber "asks for 6, lot has 4"); item 6 is kept as is and documented.
- **Coordinator's helper agents:** #175 stopgap (Delete gig shown to Admins only); #256 desktop scanner manual entry; #266 items 1–4 (item 5: "4 × any + a specific unit" = 5, kept, document it); #183 D CSV import (plan first, questions to Cameron).
- Merges still need Cameron's OK.

**[#245](https://github.com/corourke/GigManager/issues/245) and [#249](https://github.com/corourke/GigManager/issues/249): packing-list fixes, released to the Equipment Lead (Cameron, 10-11).** #245: partly packed lots show no count; a unit's status can disagree with its packed count; print ignores the Columns choice; the print header's counts; container contents aren't indented. #249: the Name column (~1,190px) pushes the other columns out of view. Plan comment on each issue first; failing test first; no migrations expected (stop and ask if one is needed); "Ready for coordinator re-review: <sha>" on the PR. Not yet released: #256 (desktop scanner in dialog), the "still out at …" container warning, the next #186 PR.

**Equipment Lead's, not triage's (Cameron, 10-23: finish all of #20 ASAP while there's capacity through 11-10).** **Merge authority (Cameron, 10-23): the coordinator merges #20 batch PRs on its own review**: pure refactor, no migration, no behaviour change, CI green. It tells Cameron after each merge. Anything outside that (a behaviour change, a migration, an RLS or API-shape change) goes back to Cameron. Pipelined: the next batch may be built while the previous one is in review, and opened at once when its files don't overlap. Characterization tests go in first where coverage is thin. Each branch starts from current main. Batch 8 (new) covers the services added since 10-07: `equipmentItem`, `equipmentNeeds`, `writeOff`, `maintenance`, `gigService.shared`.

**[#20](https://github.com/corourke/GigManager/issues/20): move the remaining services onto `src/services/base/dataAccess.ts`** (released 10-07, Cameron: "do it now"). Follow the pilots (`user.service.ts`, `attachment.service.ts`): small helpers, no domain logic, RLS stays the security boundary, no behaviour change. One PR per batch, the next only after the previous merges:
1. `notification`, `taxYear`, `accessRequest`, `purchaseScanQueue`, `purchaseCategory` (also update the services section of `docs/technical/` once)
2. ~~`activityLog`, `gigKit`, `gigParticipant`, `gigParticipantContacts`, `gigSchedule`~~ done (PR #204)
3. ~~`gigStaff`, `asset`, `kit` (one shared `computeFieldChanges` path)~~ done 10-23
4. ~~`organization`, `conflictDetection`, `googleCalendar`~~ done 10-23
5. ~~`inventoryManagement`, `gigFinancial`, `taxReport`~~ done 10-23
6. ~~`gig` (#92 is fixed, PR #200)~~ done 10-24 (#309, with `staffDashboard` and `gigService.shared`)
7. ~~`purchase`~~ done 10-23
8. ~~`equipmentItem`, `equipmentNeeds`, `writeOff`, `maintenance`~~ done 10-23 (#308); `gigService.shared` goes with batch 6

Pure refactor: no migrations, no edge-function or UI changes. Tests, typecheck, lint and build pass per PR.

**Code-splitting (approved by Cameron 10-09; coordinator, by sub-agents).** Prod main chunk 2,043,982 B vs the 2,097,152 B PWA precache limit. (1) **PR 1, merged (PR #228, 10-09):** lazy-load the remaining screens in `src/routes/screens.tsx`, a reload boundary for chunk-load failures, landing-screen prefetch, and `scripts/check-bundle-size.mjs` + CI step (entry chunk ≤ 1.2 MB, CI builds with a dummy Sentry DSN). Measured: main ~0.84 MB prod-shaped. (2) **PR 2, later:** lazy calendar view, Markdown, `ReviewScannedDataDialog` at its other import sites, and CSV export; touches files in the Equipment Lead's area, so schedule it between their merges. Skipped: lazy Sentry. Future considerations: `pdf.worker.min.mjs` isn't precached (offline PDF preview); `CalendarScreen.tsx` looks unused.

**[#175](https://github.com/corourke/GigManager/issues/175): gig owner organization; delete, cancel, leave and Inactive** (approved by Cameron 10-08; start only after #186 merges). Coordinator only, by sub-agents, 3 PRs in order: (1) migration `gigs.owner_organization_id` + `gig_participants.inactive`, delete/status/participant rules, RLS test 62 (migration to dev by the coordinator; prod rides the next prod deploy); (2) services: calendar cleanup after a successful delete (test first), duplicate uses the owner, remove/inactivate calls, Inactive left out of conflict checks and calendar sync, unused `DELETE /gigs/:id` removed; (3) UI: Delete Gig / Cancel Gig / Leave Gig / Mark Inactive, participant Remove / Mark Inactive / Reactivate, Inactive banner, status read-only for non-owners. The detailed plan is with the coordinator.

Not released: #174's UI half shipped in PR #199; its remaining item (the already-active error names the tab "Add Existing User") is in a database function and waits for the next membership migration.

**Never pre-approved:** migrations or any RLS/policy change (Cameron applies migrations), edge-function API shape, production config or `deploy_prod.sh`.

### 3d. Raised by the Docs Lead, for the coordinator

*The Docs Lead adds app problems and decisions it needs; it files app bugs as issues itself and links them here. The coordinator settles each entry and deletes it.*

(none open: the 10-07 entries are filed as #157–#160, #168–#171, #173–#176 and #178, and their decisions are in §1 and §2)

- **#257 re-tested @ e659aa6 (Docs Lead, 10-11 00:45 UTC): pass.** The Mic Case has one Container heading (at Shelf D), and its contents list in full under Contents, PDI-1 included. The Cedar Hall gig filter is empty and the T58 split is right. The earlier result follows.
- **#257 (the fix for #255) tested on dev @ 093edc0 (Docs Lead, 10-10 23:15 UTC):** the full result is on #257.
  - Pass: no per-gig duplicates; the Cedar Hall gig filter is empty; the T58 split shows at both places; the status and location filters work.
  - Fail: a container still gets two headings after a case-only override moves it away from its contents, and one of its items (PDI-1) is hidden. The cause is `LocationExplorer.tsx:289-291`, which turns the first content row into the heading. Prod has this today. Whether it holds the deploy is Cameron's call.
- **Docs Lead status, 10-12 05:35 UTC (after Cameron's 10-12 deploy):**
  - **PR #277 (merged 10-12 15:23 UTC):** publishes the held drafts: packing list (#267), Undo write-off and the lot note (#270), Delete for Admins only (#271), desktop scanning (#272), phone rows (#263), the update notice (#264), CSV import (#276), and the #269 case warning. Columns persistence and desktop scanning were checked on dev.
  - **PR #280:** publishes Kits (#273 and #270), audited against main, with 2 screenshots. Main merged in after #277 (taken.json); head c1c83b3, builds clean.
  - **Filed:**
    - **#278:** the kit list's Tracking Status count reads "6/0" and "7/5".
    - **#279:** the kit editor's Kit Contents table overflows its card (Total Value and the remove X are cut off).
- **Docs Lead status, 10-12 15:35 UTC:**
  - **PR #280 merged 10-12 18:46 UTC:** Kits is published.
- **Docs Lead status, 10-12 20:40 UTC:** Kits update for #282/#283 is held on `claude/docs-kits-282-283` (0d36506), checked on dev @ 1be842f.
  - Full Band at Harvest Gala reads Checked Out · "6 of 29", with the tooltip "Pieces at Harvest Gala Dinner & Dance: Checked Out 6 · Not packed 23". That matches the kit page's Pieces to check off (29; its Mic Case and XLR Cable Box count as one each).
  - Other kits show the badge only.
  - The editor shot now includes Kit Contents, and Total Value and the remove X fit.
  - No PR until prod has #282/#283. The Locations draft for #268 is still held as well.
  - **#268 Locations draft (held):** on `claude/docs-locations-268` (fd0d10d), checked on dev. It covers the Item filter and card, the "2 of 10" lot lines, pieces counts, Move N with its After line, the Move N button and the leave-the-case warning. A save split the T58s 2 and 2 as expected. No PR until prod has #268.
  - **Small wording issue (not filed):** a place with one piece reads "1 pieces" in Locations' place headings (the old "1 items" note).
  - **Locations** is untouched until #268.
- **Docs Lead status, 10-12 22:40 UTC:** #175 PR 1 (#281) draft held on PR #290. No PR until #281 is in prod.
  - **`participating-organizations.md`:** new sections The gig's owner, Taking an organization off a gig, and Inactive organizations.
  - **`overview.md` and `the-gig-list.md`:** delete and status are now owner-only.
  - **Rules only:** the draft names no Inactive or owner controls, since that UI is #175 PR 3, and screenshots wait for PR 3.
  - **For the coordinator:**
    - If #281 ships before PR 3, the guide will describe Inactive with no way to set it. Hold the Inactive section until PR 3, or publish it with a "coming soon" note?
    - Parent gigs have no UI, so the draft mentions them in one clause only.
    - The gig menu still offers **Delete Gig** to any Admin until PR 3. Per #281's dev check, a delete that isn't allowed "does nothing", so users get no feedback until PR 3.
- **Docs Lead status, 10-13 15:45 UTC:** the #175 draft is updated for Cameron's 10-13 Inactive rule (8abdd07), still held until PR 3.
  - **What Inactive means**, a new plain section:
    - the organization is leaving the gig;
    - it releases its staff and kits first;
    - while Inactive it updates only its own financials and notes;
    - it can be reactivated or leave;
    - History records both.
  - The "remove or mark Inactive" text follows the new rule. The earlier "hold Inactive until PR 3" question is moot now that it ships with PR 3.
  - **For the coordinator:** can the owner's Admins and Managers still mark another organization Inactive (#281 allowed it), or only the organization itself, now that it must release its own staff and kits first? The draft avoids saying who until you confirm.
- **Docs Lead status, 10-13 17:50 UTC (after Cameron's 10-13 deploy):**
  - **PR #287 (merged 10-13 18:38 UTC):** Locations for #268, re-checked and with the overview shot retaken.
  - **PR #288 (merged 10-13 18:38 UTC):** Kits for #282/#283.
  - Both are green-pending, with "Ready for coordinator re-review" posted.
  - The #175 owner/Inactive draft stays held for PR 3.
- **Docs Lead status, 10-13 23:05 UTC:** the #175 draft is checked against #286 on dev @ 380748b, with screenshots. Still held until prod has #286 (and migration 20261021000000).
  - **Text:**
    - "Owned by …" in the header and the Owner badge;
    - Duplicate is owner-only;
    - Delete Gig grayed out, with its reason shown when selected (page menu and gig list);
    - Leave Gig;
    - Remove participant, which offers Mark Inactive when financials block removal;
    - Mark Inactive / Reactivate from the row menu or the gig ⋮ menu;
    - the Inactive banner (Reactivate for Admins and Managers) and the gig list's Inactive tag;
    - History lines.
  - **Answered by #286:** the owner's Admins and Managers, or the organization's own, mark it Inactive.
  - **Dropped:** "change owner" and "parent gig", since the app has no screen for either.
  - **Shots:**
    - New: `gigs/participating-organizations-delete-blocked` (Manager) and `-inactive-banner` (Cedar Hall's Viewer, vera.holm, added to the harness as `venue`; its prepare marks Cedar Hall Inactive on the Songwriter Showcase through the UI and runs last among the gig shots).
    - Retaken for the header and the new menu item: overview-gig-page, participating-organizations-add and -contacts, conflict-detection-gig-page.
    - Dev is reseeded.
  - **For the coordinator (UX, not filed):** the read-only Participants card doesn't show which organizations are Inactive; only edit mode has the badge. Viewers and Staff can't tell.
- **Docs Lead status, 10-14 01:30 UTC:** PR #290 publishes the #175 guide pages (prod has #286), with "Ready for coordinator re-review: 79e0744" posted. The text holds with #289 unmerged: notes can be updated and nothing can be added, and the PR says so.
- **Docs Lead status, 10-14 21:00 UTC:** PR #290 is merged (ef7795d).
  - **PR #292** has the review nits: Remove is immediate; only Mark Inactive confirms; Leave and Inactive are web only; the phone pack-out line for an Inactive organization (true before and after #289); and the removal History line.
  - "Ready for coordinator re-review: 3d88231" is posted.
  - **PR #292 merged 10-17 06:08 UTC.** No docs PRs are open, and no drafts are held.
- **Docs Lead status, 10-23 02:50 UTC (#186 Maintenance, steps 1–2 in prod):** PR #301 is open, with "Ready for coordinator re-review: 854c3eb" posted.
  - **Pages:** a new Maintenance section in `inventory-reports.md`, plus fixes in overview, kits, conflict-detection, Locations and field-inventory. `adding-at-pack-out.md` needed no change.
  - **Filed #300:** the Maintenance table (1278 px) is wider than its card (1214 px max), so Return to service is past the edge at every desktop width. The shot is cropped before the actions until it's fixed.
  - **Found on dev (known, #186 step 4):** the Locations override's **Mark for Maintenance** writes a tracking status only. The item stays Active, drops out of Locations (none of the four status groups) and never reaches the Maintenance list. The guide now says to leave it unticked and use Status → Maintenance.
  - **Held:** the phone Send to Maintenance text for #299 (location, expected back, How many, To maintenance marks, Add more, untick, "any" lines skip Maintenance and Inactive lots), on `claude/docs-maintenance-phone` (26e5b51), built on #301. No PR until #299 is in prod.
- **Docs Lead status, 10-23 17:30 UTC:** PR #301 is merged. **PR #302** has the phone Send to Maintenance pages (#299): ready, with "Ready for coordinator re-review: 3c7752a" posted; **merge after #299 deploys**.
  - Checked on dev with #299: To maintenance, To maintenance · 2, the web Flagged section ("2 of the lot of 10"), and Unload moving the console to In maintenance.
- **Docs Lead status, 10-23 21:40 UTC (repo renamed to GigWrangler):** this session's GitHub access covers only `corourke/gigmanager`, so re-subscribing to #302 under the new name was refused. I've asked Cameron whether to add `corourke/GigWrangler`. Until then I get no #302 events: send me a message when #299 is in prod or #302 is merged. #302 stays ready (CI green, mergeable).
- **Docs Lead status, 10-23 21:45 UTC:** PR #302 now also covers #186 step 4 (#303) and has been retitled; "Ready for coordinator re-review: af8d7e4" is posted.
  - **Covers:**
    - Locations' Mark for Maintenance as a real send (Send N of M, location, expected back);
    - the In maintenance and Flagged to maintenance tags;
    - the card text;
    - the packing-list tag and "· 2 in maintenance";
    - the full-width Maintenance shot.
  - Checked on dev at main f1f3d08.
  - **Merge after #299 and #303 deploy.**
  - Comments and edits on #302 still work under the old repo name, but events don't reach me: message me when it's time to merge.
- **Docs Lead status, 10-29 20:45 UTC:** PR #324 (Kits list screenshot) merged 10-29 (71e794b). Print manifest TODO is left alone, pending Cameron's call on rework.
- **Docs Lead status, 10-29 20:40 UTC:** New Docs Lead session is up. PR #323 drafts #322 (cost of goods sold, line 4): categories, reporting and tax-treatment, plus the Schedule C shot. Checked on dev as admin and manager; head dd78718. **Merge after #322 deploys.**
- **Docs Lead status, 10-24 05:15 UTC:** #302 is merged (2271003), and the guide matches prod for all of #186. No docs PRs are open and nothing is held.
- **Docs Lead status, 10-12 01:40 UTC.**
  - **Published (PRs, ready for review):**
    - **PR #274:** Equipment → Locations (prod since 10-11), with a screenshot.
    - **PR #275:** Payment received → Apply to an open booking (#262, prod).
  - **Held for the next deploy:**
    - **Branch `claude/docs-held-10-12` (0a5931e):**
      - #267 packing list: Columns remembered per browser and used in print; "N kits · M pieces"; partly packed lots "4 of 6"; contents indented and wrapped; the packing-list screenshot is no longer held.
      - #270: Undo write-off on the equipment's page, and the "asks for 6, lot has 4" note in Equipment needed.
      - #271: removed the Managers-see-Delete TODOs.
      - #272: desktop Track a gig scanning.
      - #263: mobile transaction rows.
      - #264: the "new version is ready" notice (in Onboarding).
    - **Branch `claude/docs-kits-draft` (2c3e6b0):** #273 kit page labels, Duplicate opening the copy, lots counting pieces, the #270 kit-editor note, and "4 × any + a specific unit = 5".
  - **For the coordinator:** #267 doesn't change tick printing; the agent found no such change in the code. The printout's ✓ column has always printed empty boxes, as the published page says, so I didn't document a change.
  - **#276 (CSV import, 10-12 03:00):** the draft page `equipment/csv-asset-import.md` (Importing equipment from a spreadsheet) is on `claude/docs-held-10-12`. It covers the example, the file's three column groups, units and lots by `;` lists, kits, and held purchases with Retry. Held until the deploy.
  - **PR #275 merged.** PR #274 (Locations) merged 10-12 05:04.
- **Locations guide draft (Docs Lead, 10-11 10:40 UTC):** on branch `claude/docs-locations-draft` (402905d), not a PR. Held until #258/#260 are in prod.
  - **What it covers:** reading the page, cases and Contents, untagged items (in a case vs loose), the three filters, and Override for Admins and Managers. The Equipment overview links to it.
  - **App notes, not filed:**
    - Items not in any kit are listed under an "Unknown Kit" heading, for example gear added at pack-out on its own and the Wash Bars on the Repair Bench. A heading like "Not in a kit" or "Added at pack-out" would read better.
    - The Override (pencil) buttons have no label or tooltip.
- **#260 re-tested @ cd98ef8 (Docs Lead, 10-11 06:45 UTC): pass.** T58 shows at Halloween Bash and the festival. There are no Cedar Hall entries and no stale Warehouse entry. K91 and the other lots show once each, under one Mic Case heading. The earlier result follows.
- **#260 (the #258 follow-up) tested on dev @ b07b728 (Docs Lead, 10-11 06:05 UTC): regression.** Cedar Hall's stale places are gone and K91 shows once. But the festival T58 (1 piece, On Site, Not returned) now disappears from Locations, because the Paper Lanterns return (the same 4 pieces that went back out) fills the lot. Suggested a different key: a container's contents per (lot, container) across gigs. Details on #260.
- **#258 tested on dev @ 978b83a (Docs Lead, 10-11 05:45 UTC): partial.** The full result is on #258.
  - Pass: one-piece lots (K91, standing in for the SndEng Case and Stage Snakes) show once, in both orders. The T58 split shows. The Mic Case has one Container heading plus Contents.
  - Fail: lots of more than one piece keep stale places (T58 in 4 places, 13 pieces from a lot of 6). `getItemsByLocation` doesn't select `quantity` (`inventoryManagement.service.ts:435`), so every place counts as 1 piece. The fix is to add `quantity` to that select.
  - Also seen: packing out a container that's still out at another gig gives no "Before you pack" warning.
- **PR #259 (Docs Lead, 10-11 05:35 UTC): publishes the phone pages, live in prod 10-11.** Covers Scanning equipment on your phone and Adding equipment at pack-out, with 2 phone screenshots. **Merged 10-11 08:35 after review fixes.**
  - **Post-release check:** I retook every shot. Nothing changed except rendering noise and Last Login.
  - **Known gap:** the dashboard overview shot can't be retaken now. The dashboard's upcoming-gigs list uses the server's real date, and Harvest Gala (10-10) has dropped off it. The published image is still accurate. It needs a script or seed-date fix at the next full refresh.
  - **Seed note:** Harvest Gala's seeded scans sit under the top kit, so on the phone the nested FOH Console Package reads "0 / 6" beside checked lines. I'll check whether a real phone scan records the nested kit; if it does, it's seed-only.
- **#246 guide drafts (Docs Lead; updated 10-11 04:55 UTC to match #246 as merged, c1bbe38):** held until prod has the deploy, then a "publish what's live" PR. Note 1 below is fixed in the merge (a lot's tag opens the counter). on branch `claude/docs-246-draft` (67642f1), not a PR. Held until #246 merges; I'll update them after Cameron's test.
  - **Pages:** `mobile/field-inventory.md` (Scanning equipment on your phone) and the new `mobile/adding-at-pack-out.md`, plus cross-references from the gig Equipment and packing-list pages.
  - **Written from claude/185-phone at 7fa117b,** with labels checked on dev. Nothing saved: I only opened the + Add search, the note popup, the counter and Finish unload.
  - **Noticed in #246 while drafting, for the Equipment Lead** (not filed; the branch is still changing):
    1. Scanning a listed lot's tag records 1 piece without opening the counter. "+ Add" on the same lot does open it.
    2. A note on a line with no record anywhere writes In Warehouse, so in Unload that line reads as checked.
    3. "Select a gig from the dashboard…" is shown to Admins, Managers and Viewers, whose bottom bar says Gigs, not Dashboard.
    4. "Before you pack" and "Pack anyway" also appear in Load Truck. Fine, but the guide says "in Pack-Out" for planned gear.
    5. Wording differs between screens for "any" lines: the phone shows "Any · 2 / 4"; the web packing list shows "2 of 4" or "7 counted · 3 short".
    6. Only the person who added a kit can Remove it; Admins can't.
    7. Additions and "any" lines have no note button.
- **Pre-deploy test of main @ 248994e (Docs Lead, 10-10 22:30 UTC).** The full report is on PR #250.
  - **#251 and #252: pass** for Admin and Manager, filed-year cases included. Staff and Viewer have no Financials.
  - **#253 and #254: partial.**
    - Pass: a case and tagged units show once, at their newest record; a newer case-only record doesn't move the case's contents; the status and location filters use where things are now; lot splits show at each gig.
    - Fail, filed as **#255**: untagged items in a case are listed once per gig they've been to; they bring back a stale copy of the case; the gig filter still lists them.
    - **Not a regression:** prod already keys everything per gig. Whether #255 holds the deploy is Cameron's call.
  - **Also filed: #256.** On desktop, Track a gig → Scan: manual entry can't be typed into or submitted. Pre-existing; the phone layout works.
  - **Dev data:** the test tracking rows are left for repro. Harbor Truck has a $0 total and an edited line description until `./scripts/seed-demo.sh` is re-run.
- **Docs Lead status, 10-09 20:45 UTC.**
  - **Post-release screenshot check (prod 10-09):** I retook all 41 shots from main. None needs replacing: #235 had already retaken the changed screens, and 3 of the 4 diffs are invisible anti-aliasing.
  - **Known gap: the team members table's Last Login** shows the screenshot runs' real sign-in times (Oct 8–9), later than the pinned date (Oct 7), and they change each run. Signing in is what updates it.
    - Fix options: the screenshot script resets last sign-in after it signs in (it needs dev SQL access, which the script doesn't have); or the shot leaves out that column.
    - Low priority; I'll take it up at the next full refresh unless Cameron prefers otherwise.
  - **#239 (merged 10-09, not in prod):**
    - The how-to is drafted in the held Equipment pages (`claude/docs-kits-draft`).
    - Published-page changes are in **PR #243, to merge after the deploy that carries #239** (stacked on #241).
    - App follow-ups are filed as **#242**: raw event names in History, Write off has no confirmation, a Missing record's Retired On is still editable, the locked-year message, Undo is reachable only from the gig, and kits after a partial write-off.
  - **PR #241 (merge now):** two pages already wrong for prod. The Equipment overview still said Assets instead of Items, units and lots, and the gig Equipment tab didn't list Equipment needed.
  - **Ready for the next deploy (10-10):**
    - PR #243 now covers History's **Equipment Written Off** and **Write-off Undone** too.
    - The held Equipment drafts match #244: the write-off confirmation, the locked fields, the filed-year message and #242 items 5–7 as the app works now. They also cover the packing list (#240) and the gig Equipment table's **Status** and **Location** columns.
    - Packing-list app problems are filed as **#245**: partly packed lots show no count; a unit's status can disagree with the packed count; print ignores the Columns choice; the print header's counts; container contents aren't indented.
    - The demo seed has no counted "any" line (every "any" item is tagged), so that case can't be screenshotted yet.
  - **Still to draft, once it merges:** #185 PR 2 (ad-hoc pack-out; scan or search to add kits and items, in Pack-Out and Load Truck only).
- **Equipment conflicts, two questions from checking #230 on dev (Docs Lead, 10-09):**
  1. **The shared-unit message also lists lots.** On the Oct 17 gigs it reads "Equipment conflict with kits: Main PA … (Speaker Stand, Tripod, Speakon Speaker Cable, 50 ft, Voltline PD-20 … (#DSL-0211))". The stands and cables are lots, already counted in the per-item shortage, and a lot in two kits isn't "the same unit booked twice". So a lot with plenty spare would still be flagged.
  2. **The card's "This gig: 4 (Full Band Sound Package × 4)"** reads as four packages. It means 4 speakers from that kit. Wording like "4 via Full Band Sound Package" would be clearer.
- **Kit editor and kit page notes for #184/#185 (Docs Lead, 10-09, from drafting the Kits page; can follow):**
  - **Duplicate:** on the kit page it returns to the list rather than the copy (`KitDetailScreen.tsx:182`), and it drops the Tag Number.
  - **"Items" means three different things:** the Equipment tab, Tracking Type **Items**, and the kit page's "Total Items" vs "Inventory Items". The kit page also still says **Total Assets**, **Assets in Kit** and "Asset".
  - **"N units owned"** is shown for lots too (`KitScreen.tsx:630`).
  - **Kit Structure doesn't identify which specific unit a line is:** there's no tag.
  - **Old "assets or kits" wording remains:** "No assets or kits found", "At least one asset or sub-kit".
  - **Icon-only buttons have no labels:** add tag (+) and remove line (X).
  - **Tracking Type descriptions promise packing and scanning behaviour** from #185/#186.
  - **A kit can hold both "4 × any HX-12P" and a specific HX-12P,** which totals 5. Intended?

## 4. Agents and documentation

**Secrets and access tokens (setup notes for Cameron; checked 10-08).**
- **Where:** in a session's title bar, open the cloud environment menu → **Edit**. Secrets go in as **environment variables** or **Network secrets** (shown as *API credentials* in older app versions). Never paste a token into a chat.
- **When they apply:** only to sessions started **after** you save. A running session (and its sub-agents) keeps the environment it started with; start a new session to pick up a change.
- **What works today (keep it this way):** one Supabase personal access token per project, each as an environment variable:
  - `SUPABASE_DEV_ACCESS_TOKEN`: a token whose account can reach **only the dev project** (`qcrzwsazasaojqoqxwnr`). Agents use it for dev deploys and migrations: `SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN ./deploy_dev.sh`.
  - `SUPABASE_ACCESS_TOKEN`: reaches **only prod** (`hqnnhtxcxedisasvtbqv`). Agents use it read-only (queries), never to write or deploy; prod deploys stay with you.
  - To check a new or rotated token without exposing it, ask the coordinator for a read-only access test in a fresh session (GET requests only, status codes only).
- **Network secrets (optional, not needed now):** the proxy attaches a network secret only to requests whose host **and path prefix** match. The 10-08 one was set for `/api/v1/qcrzwsazasaojqoqxwnr`, which matches nothing, because the Management API paths are `/v1/projects/<ref>/…`. If you use one for dev, set host `api.supabase.com`, path prefix `/v1/projects/qcrzwsazasaojqoqxwnr`, header `Authorization: Bearer <dev token>`. Don't add one for prod, and don't use a host-wide prefix: it would attach to every Supabase call, including prod's. Otherwise delete the unused one.
- **Rotating:** create the new token in the Supabase dashboard (Account → Access Tokens), replace the variable's value, start a new session, run the access test, then revoke the old token.
- Dev Auth sends email through a Mailtrap sandbox (custom SMTP set by Cameron 10-08). The SMTP password lives only in the Supabase dashboard, not in the environment or the repo.

**Questions for Cameron (Cameron, 10-24): the coordinator asks him in its chat as plain text, numbered, each with a recommended answer; never question cards (AskUserQuestion), which worker restarts close.** **Pace through 11-10 (Cameron, 10-08; extended from 10-17 on 10-10):** keep triage and the leads busy. Cameron (10-08 evening): sub-agents do the coordinator's builds; the coordinator reviews, merges and may deploy to **dev** with `./deploy_dev.sh` (never prod). The coordinator checks in every 2 hours (Routine `trig_013iEPNzrK1NR8j2Qih9jzJy`, bound to coordinator session `session_01XTmXKhviMSkyy5PqcRAfUn` in the Supabase Prod environment; it disables itself after 11-10) to queue work, review ready PRs and ask Cameron about blockers.

**Engineering Lead** (`session_01LwY4oDQF3d4ov6DJYAeUHR`, nested under the coordinator since 10-29, Supabase Dev environment, no prod access) does general engineering across the app, assigned by the coordinator; it replaced the Equipment Lead (archived 10-29). Plans go on the issue first; every merge needs Cameron's OK. Candidate follow-ups it noted (not filed): drop `track_purchase_line_as_equipment`; regenerate `database.types.ts` (`purchase_scan_queue` missing); run the audit SQL suites in CI; #43.

**Docs Lead** ("GigWrangler Docs Lead", `session_01LwY4oEmi9cZB9ezMTCQp9a`, nested under the coordinator since 10-29, Supabase Dev environment, no prod access) owns the user guide (`website/docs/`) and its screenshots, from the demo organization in dev. It may create GitHub issues. Its decisions so far: visual style A (app match); the demo data and seed (`scripts/seed-demo.sql`, logins in `scripts/README.md`; dev holds only demo data since 10-07); screenshots from `scripts/screenshots/` at a pinned date, refreshed at each production release.

*Docs Lead, next (queued by the coordinator, 10-09 05:40 UTC; PR #229 merged):*
1. `gigs/conflict-detection.md` for PR #230 (per-item counts, peak demand, new wording, Equipment needed table; back-to-back gigs overlap).
2. `financials/reporting.md` for PR #232 (Schedule C and Needs attention tabs, with screenshots).
3. `reference/roles-and-access.md` for PR #233 (manage-only URLs redirect Staff and Viewer).
4. Draft only: `equipment/kits.md` "N × any" lines (#225), ready for when #185/#186 land.
All three merges are on main, not in prod yet; time the PR per STYLE.md.

**Triage routine** (daily, ~09:00 UTC). Each run:
1. Check CI and mergeability on its own open PRs; fix a red or conflicted one by merging `main` in, never by rebasing.
2. Build what §3c releases that has no PR yet: plan comment on the issue, failing test first.
3. On a quiet run, do one `docs/` pass (technical and development docs; next candidate: `docs/technical/tenant-isolation-architecture.md`; archiving both dry-run records needs a PR). Leave `website/docs/` to the Docs Lead.
4. Don't manufacture activity: if nothing changed, commit nothing and post nothing.

**Who updates which docs** (Cameron, 10-07):
- Code PRs keep the technical docs in `docs/` in step with the code, in the same PR.
- Code PRs don't touch the user guide or screenshots; they end with "User-visible changes" (§3a).
- The Docs Lead reads that section on merged PRs and updates the guide in its own PRs.
- Publishing: drafts keep `draft: true` until complete and verified; the coordinator publishes with Cameron.
- PRs touching `website/docs/` must pass `cd website/docs && npm ci && npm run build`.

**User-docs table** (the Docs Lead keeps it current):

| Page (`website/docs/src/content/docs/`) | Status | Last verified | Still wrong / next |
|---|---|---|---|
| `equipment/assets.md` | draft | — | held: equipment rework (#162/#180) |
| `equipment/assigning-to-a-gig.md` | published (PRs #250, #259, #277) | 2026-10-12 (Docs Lead; matches prod 10-12) | kit assignment, equipment table, Not returned, write-offs, Undo write-off on the equipment page (#270), Added at pack-out label |
| `equipment/barcode-scanning.md` | draft | — | held: equipment rework (#162/#180) |
| `equipment/csv-asset-import.md` | published (PR #277) | 2026-10-12 (Docs Lead; matches prod 10-12) | Importing equipment from a spreadsheet (#276): example/template, invoice rows, units vs lots, kits by name, fix and retry |
| `equipment/inventory-reports.md` | published (PRs #250, #259, #277), packing list only | 2026-10-12 (Docs Lead; matches prod 10-12) | Columns remembered and printed, "N kits · M pieces", "4 of 6" lots (#267); packing-list shot; manifest and maintenance queue to come; Maintenance section (#186 steps 1–2) published in PR #301 (merged 10-23); shot cropped before actions until #300; phone step 3 and desktop step 4 published in PR #302 (merged 10-24); full-width shot retaken (#300 fixed); Manifest section held: Cameron chose to rework Print manifest (10-29), document after it ships |
| `equipment/kits.md` | published (PRs #280, #288) | 2026-10-13 (Docs Lead; matches prod 10-13) | kit page (#273), editor, any lines, nesting, containers; Tracking Status "6 of 29" and tooltip (#282); full editor shot with Kit Contents (#283); Kits list shot published in PR #324 (merged 10-29) |
| `equipment/location-explorer.md` | published (PRs #274, #287) | 2026-10-13 (Docs Lead; matches prod 10-13) | Locations: status/place groups, cases and Contents, untagged items, filters, Override; #268 update (Item filter and card, N of M, pieces, Move N, leave-the-case) published in PR #287 (merged 10-13), overview shot retaken; Mark for Maintenance → Sending to maintenance, In maintenance / Flagged tags, card text (#303), published in PR #302 |
| `equipment/overview.md` | published | 2026-10-10 (Docs Lead, PRs #241/#250) | links the two published equipment pages; Maintenance tab row (PR #301) |
| `financials/cost-allocation.md` | published | 2026-10-06 (coordinator, PR #136) | — |
| `financials/gig-accounting.md` | published | 2026-10-08 (Docs Lead, PR #207) | Owed to you: Completed or Settled; held: money-type rework (was #125) |
| `financials/gig-expenses.md` | published | 2026-10-12 (Docs Lead, PRs #275, #277; matches prod) | projected staff estimate; Payment received → Apply to an open booking (#262); phone row names (#263) |
| `financials/overview.md` | published | 2026-10-09 (Docs Lead, PR #227) | Upload Invoice is on the Items tab |
| `financials/purchases.md` | published | 2026-10-09 (Docs Lead, PR #227) | Track as equipment makes a lot |
| `financials/reporting.md` | published | 2026-10-09 (Docs Lead, PR #235; matches prod 10-09) | Schedule C and Needs attention documented; line 4 cost of goods sold and Gross profit (#322) in PR #323; #322 in prod 10-29, awaiting merge OK |
| `financials/receipts-and-invoices.md` | published | 2026-10-09 (Docs Lead, PR #227) | purchase form updated for #216/#221 (units/lots, Equipment details, quantity changes) |
| `financials/tax-treatment.md` | published | 2026-10-09 (Docs Lead, PR #227) | equipment records and filed-year wording updated for #221; resale goods line (#322) in PR #323; #322 in prod 10-29, awaiting merge OK |
| `getting-started/onboarding.md` | published | 2026-10-12 (Docs Lead, PR #277); screenshots PR #163 | Keeping up to date: the new-version notice (#264) |
| `getting-started/organizations.md` | published | 2026-10-08 (Docs Lead, PR #191, merged) | fixes and screenshots in |
| `getting-started/the-dashboard.md` | published | 2026-10-08 (Docs Lead, PR #207) | dashboard and Staff cards shots in; overview shot retakeable again (PR #261, merged 10-11); its list uses the server's real date, so move the seed anchor at the next full refresh |
| `getting-started/what-is-gigwrangler.md` | published | 2026-10-07 (Docs Lead, PR #164) | — |
| `gigs/calendar-view.md` | published (PR #222) | 2026-10-07 (Docs Lead) | — |
| `gigs/change-history.md` | published | 2026-10-07 (triage, PR #151); screenshots PR #166 | — |
| `gigs/conflict-detection.md` | published | 2026-10-12 (Docs Lead, PRs #235, #277; matches prod 10-12) | per-item conflicts, Equipment needed table, same-unit rule after #238, lot short/missing notes (#270); Inactive venue/act left out of conflicts (#175, technical doc #285) goes in the held `claude/docs-175-owner` draft |
| `gigs/creating-a-gig.md` | published | 2026-10-07 (triage, PR #151); screenshots PR #166 | — |
| `gigs/documents-and-notes.md` | published (PR #222) | 2026-10-08 (Docs Lead) | — |
| `gigs/overview.md` | published | 2026-10-12 (Docs Lead, PR #277) | Delete is Admin-only (#271); #175 PR 1 (#281) owner rules published in PR #290 (merged 10-14); review nits in PR #292 (merged 10-17) |
| `gigs/participating-organizations.md` | published (PR #222) | 2026-10-07 (Docs Lead) | The gig's owner, Taking an organization off a gig, Inactive organizations: #175 PR 1 (#281) owner rules published in PR #290 (merged 10-14); review nits in PR #292 (merged 10-17) |
| `gigs/schedule.md` | published (PR #222) | 2026-10-07 (Docs Lead) | — |
| `gigs/staffing-and-participants.md` | published (PR #222) | 2026-10-09 (Docs Lead, PR #224) | — |
| `gigs/the-gig-list.md` | published (PRs #222, #277) | 2026-10-12 (Docs Lead) | Delete is Admin-only (#271); #175 PR 1 (#281) owner rules published in PR #290 (merged 10-14); review nits in PR #292 (merged 10-17) |
| `index.mdx` | published | 2026-10-08 (Docs Lead, PR #191, merged) | fixes in |
| `mobile/biometric-unlock.md` | draft | — | held |
| `mobile/adding-at-pack-out.md` | published (PR #259) | 2026-10-11 (Docs Lead; matches prod 10-11) | scan or + Add, conflict check, Added at pack-out, offline; 1 phone shot |
| `mobile/field-inventory.md` | published (PRs #259, #277) | 2026-10-12 (Docs Lead; matches prod 10-12) | Scanning equipment on your phone: steps, scanning, counting, any lines, Unload, notes; desktop Track a gig (#272); case-still-out warning (#269); 1 phone shot; Send to Maintenance → Maintenance list link (PR #301); step 3 Sending to maintenance (PR #302, merged 10-24) |
| `mobile/offline-access.md` | draft | — | held |
| `mobile/overview.md` | draft | — | held |
| `reference/access-requests-and-moderation.md` | published (PR #222) | 2026-10-07 (Docs Lead); screenshots PR #191 | — |
| `reference/glossary.md` | published (PR #222) | 2026-10-07 (Docs Lead) | equipment terms (Asset, Kit, Container, Packing list) to revise with the Equipment pages |
| `reference/roles-and-access.md` | published | 2026-10-09 (Docs Lead, PR #235; matches prod 10-09) | manager-only addresses redirect (#233) |
| `settings/categories.md` | published | 2026-10-08 (Docs Lead, PR #189, merged) | corrections in; Goods you buy to resell (line 4, #322) in PR #323; #322 in prod 10-29, awaiting merge OK |
| `settings/google-calendar.md` | published | 2026-10-08 (Docs Lead, overnight rule checked) | connected-state shot needs a Google account |
| `settings/overview.md` | published | 2026-10-08 (Docs Lead, Edit Organization button checked) | — |
| `team/invitations.md` | published (PR #222) | 2026-10-08 (Docs Lead, PR #207) | — |
| `team/member-profiles.md` | published (PR #222) | 2026-10-08 (Docs Lead, PR #217) | #206 workaround removed |
| `team/overview.md` | published | 2026-10-07 (Docs Lead, PR #177, merged) | — |
| `team/people-without-logins.md` | published (PR #222) | 2026-10-07 (Docs Lead) | — |
| `team/team-and-roles.md` | published (PR #222) | 2026-10-08 (Docs Lead, PR #217) | members-table shot retaken with stable Last Login (PR #261, merged 10-11) |

**Project rules that bite** ([AGENTS.md](./AGENTS.md)): approval before going from plan to code (rule 1); a failing test before a bug fix (rule 3); never edit a committed migration, and Cameron applies new ones (rule 4); list manual deploy and verification steps (rule 7). Prod is read-only for agents unless Cameron approves a specific change.

## 5. Future considerations (not open work)

- *From #183 (closed 10-18):* drop the v1 purchase RPCs in a later migration; one server-side RPC for a whole purchase edit, which would make lowering quantities on several lines atomic (#221 notes A–C).
- *From the #281 re-review (10-12):* saving a gig's edit on mobile resets every participant's notes and client flag (MobileGigDetail sends only id, organization and role; `updateGigParticipants` writes `notes || null` and `is_client ?? false`). Prod today: 0 participant notes and 1 client flag, so little is at risk yet. Raised with Cameron; a fit for #175 PR 3 (UI).
- *From the #268 checks:* Locations' stale rule assumes a consistent history; a raw lot scan that sends out more than is home (#185 lot scans) can make an older place read stale and over-report home. Rows written by the pre-fix Move N on dev can tie on time. The stale check is O(rows × history) per lot (fine now, slow for very long histories). `getItemsByLocation` reads tracking rows unpaged (1000-row cap) and doesn't batch `.in('id')`.
- *From #266 / the #225 review:* concurrent kit edits can leave partial writes; nested-container availability isn't shown; the kit editor's item query isn't paged.
- *From the #183 D1 review:* Track as equipment can double-track across two sessions (client-side check); the import's item/kit lookups load full records and are subject to the ~1000-row PostgREST cap.
- *Parked from #226 (Cameron 10-09; #226 closed 10-11):* 1 multi-step purchase save isn't atomic (needs an RPC migration); 2 Mark Inactive takes two requests; 4 removing a purchase line unlinks its units silently; 7 no duplicate tag/serial warning; 9 Purchase column on hand-added units; 10 differences from mockups 3 and 4; 11 `kit-null` duplicate-key warning (unverified still present); 12 Track as equipment still uses the v1 RPC (with #183 D).
- *Docs Lead's #246 phone notes 3–7 (from #185, closed 10-11):* Gigs vs Dashboard wording; Pack-Out wording in Load Truck; "any" line wording; Admins can't Remove a kit someone else added; no Note button on additions and "any" lines.
- *#186 docs notes (Docs Lead):* "Unknown Kit" heading for loose items; Override pencil buttons have no labels.
- **`deploy_prod.sh` env preflight** (Cameron 10-08: track here; not released, since `deploy_prod.sh` is never pre-approved). The prod bundle's `VITE_*` values come only from the deploying machine's git-ignored `.env.production.local`, and nothing checks them. Before `npm run build`, fail if that file is missing, if `VITE_SUPABASE_URL` doesn't contain `$PROD_REF`, or if `VITE_SUPABASE_ANON_KEY` / `VITE_GOOGLE_CLIENT_ID` is empty.
- *Noticed by tonight's sub-agents (10-08), not built:*
  - The Vitest suite runs close to the 5 s per-test timeout; under load (several runs in parallel) purchases, scan-review and staff tests time out. CI is fine today; a higher global `testTimeout` or faster tests would make it robust.
  - `src/components/CalendarScreen.tsx` looks unused (the calendar is `GigListScreen` in calendar mode).
  - `GigListScreen` still fetches the money aggregates for Staff and Viewers, though nothing shows them now (#168).
  - With the money cards hidden, the Staff dashboard's card row leaves empty slots on wide screens.
  - `TeamScreen` has an outdated invitations-migration banner (mentions `APPLY_INVITATIONS_TABLE.md`).
  - The asset page's Notes render Markdown without the shared `MarkdownContent` styling (#169).
  - Editing an existing mileage row's miles or date doesn't re-price it; only **Record Mileage** prices.
  - Mobile Settings has no **Edit Organization** entry (#176 added it on desktop Settings).
  - The already-active error names the tab "Add Existing User" (#174); it lives in a database function, so fix it in the next membership migration.
- Gig attachments are invisible to the other organizations on a gig (needs a sharing flag and a storage-policy change).
- Prod has a `fin_category` value `'Production'` that no migration creates.
- Staff and Viewers can read their own org's staff `rate` / `fee`.
- `createOrganization`'s parameter type lists `email` and `place_id`, which aren't columns; no caller sends them.
- After a first Google sign-in, profile completion requires **Set Password** and doesn't prefill the Google name.
- Supabase CLI warns that `[inbucket]` in `supabase/config.toml` is deprecated in favour of `[local_smtp]` (local config only).
- The main JS bundle is about 30 KB under the 2 MiB PWA precache limit; split more routes before it trips `npm run build` again.
- Stray branches `claude/triage-90-org-delete-references` and `claude/triage-userguide-gigs` duplicate merged work and are safe to delete.
