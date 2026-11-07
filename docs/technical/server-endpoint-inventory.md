# `server` Edge Function — Endpoint Inventory & Authorization

**Purpose**: The per-endpoint authorization reference for the `server` edge function. It began as the spec for the
June 2026 Phase 6 Hono refactor; the refactor has landed, and this page now records what the code enforces. When
you add or change a route, update the matching row.

Source: `supabase/functions/server/index.ts` (Hono app, CORS, error handler, path-prefix stripping) and one file
per area under `supabase/functions/server/routes/`. Every route runs with the service-role key (RLS bypassed), so
authorization is the middleware named in each row: `requireUser` (`lib/auth.ts`), `requireOrgRole`
(`lib/orgRole.ts`) and `requireGigAccess` (`lib/gigAccess.ts`). Pure decision helpers live in
`lib/pure/authz.ts`, tested by Vitest in `lib/pure/authz.test.ts` (part of `npm run test:run`). All paths are relative to the `/server` (or
legacy `/make-server-de012ad4`) prefix. The function keeps the default `verify_jwt = true`, so the Supabase gateway
also requires a JWT (the anon key is enough) before any route runs, `/health` included.

Legend — **Auth**: 🔓 public · 🔑 any authenticated user · 👤 self only · 🏢 org member · 🛡️ org Admin/Manager · 👑 org Admin.

## Users

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 1 | GET | `/health` | 🔓 | `index.ts` | Liveness only. The dependency health check is the separate `health-check` function. |
| 2 | POST | `/users` | 👤 | `requireUser` | Creates the caller's profile row. |
| 3 | GET | `/users/:id` | 👤 | `requireUser` + `users_share_org_or_gig` | Yourself, or someone sharing an organization or a gig with you (orgs on the gig, or staffed on it); 404 otherwise. |
| 4 | PUT | `/users/:id` | 👤 | `requireUser` + inline `user.id === :id` (403) | |
| 5 | — | ~~`/users?search=`~~ | — | — | Removed (11-07); the app searches people with `search_people`. |
| 6 | — | ~~`/users/:id/organizations`~~ | — | — | Removed (11-07); unused. |

## Organizations & Members

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 7 | GET | `/organizations` | 🔑 | `requireUser` | World-readable to authed users by design (org discovery, security-scheme §4). |
| 8 | POST | `/organizations` | 🔑 | `requireUser` | Any authed user can create an org and becomes its Admin (Q-B). |
| 9 | PUT | `/organizations/:id` | 👑 | `requireOrgRole({ roles: ['Admin'], allowUnclaimedOrgManagers })` | While the org is unclaimed, also a platform moderator or an Admin/Manager of an org sharing a gig with it (`user_can_manage_unclaimed_org`); after that only the org's own Admin. |
| 10 | DELETE | `/organizations/:id` | 👑 | Same as #9 | |
| 11 | POST | `/organizations/:id/members` | 🛡️ to add others (👑 to add an Admin); 🔑 to self-join | `requireUser` + inline `verifyOrgMembership` | Self-join only as Viewer, or as Staff when the email domain is in the org's `allowed_domains`. |
| 12 | GET | `/organizations/:id/members` | 🏢 (or platform moderator) | `requireOrgRole({ allowPlatformModerator: true })` | Lists members. |
| 13 | GET | `/organizations/:id/members/:memberId` | 🏢 | `requireOrgRole()` | Single member detail. |
| 14 | PUT | `/organizations/:id/members/:memberId` | 🛡️; 👑 to change to/from Admin | `requireOrgRole({ roles: ['Admin', 'Manager'] })` + inline check | Role/profile update. |
| 15 | DELETE | `/organizations/:id/members/:memberId` | 🛡️; 👑 to remove an Admin | `requireOrgRole({ roles: ['Admin', 'Manager'] })` + inline check | Remove member. |
| 16 | DELETE | `/invitations/:invitationId` | 🛡️ of the invitation's org | `requireUser` + inline `verifyOrgMembership` | Cancel an invite. |
| 17 | POST | `/organizations/:id/invitations` | 🛡️ | `requireOrgRole({ roles: ['Admin', 'Manager'] })` + `canAssignRole` | Create invite. Only an Admin may invite an Admin (09-29). |
| 18 | POST | `/organizations/:id/members/create` | 🛡️ | `requireOrgRole({ roles: ['Admin', 'Manager'] })` + `canAssignRole` | Create-and-add member. Only an Admin may add an Admin (09-29). |

## Gigs

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 19 | GET | `/gigs?organization_id=` | 🏢 of the query org | `requireOrgRole({ getOrgId: query })` | |
| 20 | GET | `/gigs/:id` | 🏢 of any participant org | `requireGigAccess()` | Intersection model. |
| 21 | POST | `/gigs` | — | — | **Removed 09-29 (PR #95).** Unused: the app creates gigs with the `create_gig_complex` RPC. |
| 22 | PUT | `/gigs/:id` | — | — | **Removed 09-29 (PR #95).** Unused: the app edits gigs through RLS-guarded table writes. |
| 23 | DELETE | `/gigs/:id` | — | — | **Removed 10-12 (#175).** Unused: the app deletes gigs through the RLS delete rule (an Admin of the owner organization). |
| 24 | GET | `/organizations/:id/dashboard` | 🏢 except Viewer | `requireOrgRole({ roles: ['Admin', 'Manager', 'Staff'] })` | Staff allowed (read-only dashboard). |

## Integrations — Google Places (API-key proxy)

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 25 | GET | `/integrations/google-places/search` | 🔑 | `requireUser` | Proxies the Places API; auth gates key abuse. No org concept. |
| 26 | GET | `/integrations/google-places/:placeId{.+}` | 🔑 | `requireUser` | Place details proxy. |

## Integrations — Google Calendar (per-user OAuth)

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 27 | POST | `/integrations/google-calendar/exchange-token` | 👤 | `requireUser` | Operates on the caller's own tokens. |
| 28 | POST | `/integrations/google-calendar/refresh-token` | 👤 | `requireUser` | |
| 29 | POST | `/integrations/google-calendar/calendars` | 👤 | `requireUser` | Lists the caller's calendars. |
| 30 | POST | `/integrations/google-calendar/events` | 👤 | `requireUser` | Creates an event on the caller's calendar. |
| 31 | DELETE | `/integrations/google-calendar/events` | 👤 | `requireUser` | |
| 32 | POST | `/integrations/google-calendar/sync-gig-all-users` | 🏢 of a participant org of body `gig_id` | `requireGigAccess(undefined, body.gig_id)` | Q-D fix. The sync itself runs fire-and-forget after the response. Every gig goes out as an all-day event in its local dates, with times and venue in the description (#117, `lib/pure/calendarEvent.ts`, shared with the browser's per-user sync). |

## WebAuthn (mobile device lock)

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|---------------------|----------|-------|
| 33 | POST | `/webauthn/register/options` | 👤 | `requireUser` | Enrolls a device for the caller. |
| 34 | POST | `/webauthn/register/verify` | 👤 | `requireUser` | |
| 35 | POST | `/webauthn/authenticate/options` | 🔓 (identifies by email) | none | Unlock flow, public by design (Q-E). |
| 36 | POST | `/webauthn/authenticate/verify` | 🔓 (identifies by email) | none | Unlock flow, public by design (Q-E). |

## Access requests (issue #33)

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|----------|------|-------|
| 37 | POST | `/organizations/:id/access-requests` | Viewer or Staff of the org | `requireOrgRole({ roles: ['Viewer', 'Staff'] })` | Ask for a higher role. Non-members self-join first (#11). |
| 38 | GET | `/organizations/:id/access-requests` | 👑 | `requireOrgRole({ roles: ['Admin'] })` | Pending requests for the org. |
| 39 | PUT | `/organizations/:id/access-requests/:requestId` | Platform moderator while the org is unclaimed, else 👑 | `requireUser` + `canDecideAccessRequest` (`lib/pure/authz.ts`) | Approve or reject. |
| 40 | GET | `/moderator/access-requests` | Platform moderator | `requireUser` + inline `isPlatformModerator` | Pending requests across all unclaimed orgs. |

## Notifications

| # | Method | Path | Enforced | Code | Notes |
|---|--------|------|----------|------|-------|
| 41 | GET | `/me/notifications` | 👤 | `requireUser`, filtered on `recipient_id` | Unread notifications for the bell. |
| 42 | PUT | `/notifications/:id/read` | 👤 | `requireUser`, update filtered on `recipient_id` | 404 when the row is not the caller's. |

---

## Authorization decisions (resolved 2026-06-12)

Decisions made for the refactor. The two fixes (Q-C, Q-D) shipped with it.

- **Q-A — User directory exposure (#3, #5, #6).** ✅ **Decision: keep open for now.** Behavior was preserved through the refactor. Tightening to shared-org/gig is tracked in Future Considerations below.
- **Q-B — Open org creation (#8).** ✅ **Decision: keep open** — self-serve onboarding. Revisit with rate-limiting/abuse controls before public launch.
- **Q-C — Gig creation check bypass (#21).** ✅ **Fixed** — `primary_organization_id` is required and Admin/Manager membership of it is always enforced. **Note (smoke test, June 2026):** the frontend actually creates gigs via the `create_gig_complex` SECURITY DEFINER RPC, **not** this server endpoint, so the same Admin/Manager check was also added inside the RPC and the permissive `gigs` INSERT policy dropped (migration `20260613000000`). The unused server endpoint was removed on 09-29 (PR #95), so the RPC check is now the only one.
- **Q-D — Calendar sync access check (#32).** ✅ **Fixed** — the caller must be a member of a participant org of `gig_id` (`requireGigAccess`).
- **Q-E — WebAuthn unlock endpoints (#35, #36).** ✅ **Decision: keep public** — unlock flow, gates only the cosmetic UI lock (the Supabase session in localStorage stays valid regardless), not data access.

## Future Considerations (deferred)

- **User-directory scoping (from Q-A): done 11-07.** `/users/:id` returns only yourself or someone sharing an organization or a gig with you; `/users?search=` and `/users/:id/organizations` are removed.
- **Org-creation abuse controls (from Q-B).** Pair open org creation with rate-limiting and an abuse plan before any public launch.

---

## Refactor notes (all landed)

- **CORS**: the old handler reflected any `Origin` with `Access-Control-Allow-Credentials: true`. `index.ts` now uses
  the pinned-origin allowlist in `_shared/cors.ts`, shared with `ai-scan`, including on `onError` responses.
- **`RP_NAME`**: read from the `RP_NAME` env var, defaulting to `GigWrangler` (`lib/webauthnConfig.ts`).
- **`kv_store` / `kv_store_de012ad4`**: still used by the WebAuthn challenge flow (`routes/webauthn.ts`), unchanged.
- **500 responses**: `app.onError` sends the error to Sentry and returns `{ "error": "Internal server error" }`. The
  WebAuthn `details: error.message` leaks are gone.
