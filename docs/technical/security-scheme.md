# Security Scheme Analysis - GigWrangler

## 1. Core Principles
- **Multi-Tenancy**: Data is isolated between organizations.
- **Intersection-Based Gig Access**: Access to a Gig is granted only to members of organizations that are participants in that Gig.
- **Refined Role-Based Access Control (RBAC)**: Access levels within an organization are defined by roles: Admin, Manager, Staff, and Viewer.
- **Row-Level Security (RLS)**: Security is enforced at the database level using PostgreSQL policies.

## 2. Organization Membership & Roles
Users belong to organizations via the `organization_members` table.

| Role | Description |
|------|-------------|
| **Admin** | Full control over the tenancy. Can manage organization settings, members, and all data (CRUD). |
| **Manager** | CRUD all application data (Gigs, Assets, Kits, Financials, Staffing). Can view and edit team member profiles. Cannot manage organization members or roles. |
| **Staff** | Read-only access to organization data. Can edit their own profile. Can view all participating gigs (EXCEPT Financials). Can accept/decline their own staff assignments. Can view equipment and the team. |
| **Viewer** | Read-only access to basic gig information for participating gigs. Can edit their own profile. |

## 3. Gig Access Logic (The Intersection)
Access to a record in the `gigs` table is determined by the `gig_participants` junction table.

**Logic**: `User -> Organization Membership -> Organization Participation -> Gig`

A user `U` can access Gig `G` if:
1. `U` is a member of Organization `O`.
2. `O` is a participant in Gig `G` (entry exists in `gig_participants` for `O.id` and `G.id`).

### Implications for RLS Policies:
- **`gigs` table**: SELECT requires `auth.uid()` to belong to a participant org. **Creation** is **Admin/Manager only**: it goes through the `create_gig_complex` SECURITY DEFINER RPC, which requires a `primary_organization_id` and Admin/Manager membership of it (migration `20260613000000`). The direct-insert RLS policy was removed so the authenticated role cannot bypass the RPC.
- **`gig_financials` table**: Only accessible to **Admin** and **Manager** roles of the owning organization.
- **`purchases` table** (org-level Financials): reads and writes are **Admin/Manager only** — Staff/Viewer cannot see Financials (migration `20260613000000` removed the prior member-level read).
- **`gig_participants`**: Members can see the participant list.

### Shared vs. org-private gig data
Several orgs can participate in one gig. **Shared by design:** the gig itself, `gig_participants` and
`gig_schedule_entries`, which every participating org can see. **Org-private:** everything an org attaches to a
gig is private to that org, even though other orgs are on the same gig. That covers financials, staffing, kit
assignments and scans. Each org-private row has a `NOT NULL organization_id`: members of that org can read it,
and Admins/Managers of that org can write it. No policy grants access through gig participation alone.
Migration `20260925000000_org_private_gig_data.sql` (#61) applied this to the tables below, and
`supabase/tests/rls/` tests it.

| Table | Read | Write |
|---|---|---|
| `gig_financials` | Admin/Manager of owning org | Admin/Manager of owning org |
| `gig_staff_slots` | members of owning org; anyone booked into the slot | Admin/Manager of owning org, which must be on the gig |
| `gig_staff_assignments` | members of the slot's org; the assignee (own row only) | Admin/Manager of the slot's org. The **assignee** may change only `status`/`confirmed_at` (confirm or decline), enforced by trigger `restrict_assignee_self_update` |
| `gig_kit_assignments` | members of owning org | Admin/Manager of owning org, which must be on the gig |
| `inventory_tracking` | members of owning org | members of owning org (crew scan on mobile), which must be on the gig |
| `activity_log` (gig entries) | gig/participant/schedule events: every participant. Staffing and kit events: members of the entry's org. Financial events: Admin/Manager of the entry's org | only via `log_activity`, which attributes an entry only to an org the actor belongs to |

A person can be booked into another participating org's staff slot. They see that slot and their own assignment,
but not the slot org's other assignments, rates or fees.

## 4. Broader Access Requirements
- **Organization Discovery**: Any authenticated user can read the `organizations` table to find partners/venues.
- **User Discovery**: Users can search for other users within their organization or shared gigs.
- **Public Reference Data**: `staff_roles` are readable by all authenticated users.

## 5. RLS Implementation Strategy

### Helper Functions (SECURITY DEFINER)
- `user_is_member_of_org(org_id, user_id)`
- `user_is_admin_of_org(org_id, user_id)`
- `user_is_admin_or_manager_of_org(org_id, user_id)`
- `user_has_access_to_gig(gig_id, user_id)`
- `get_user_role_in_org(org_id, user_id)`: Returns the `user_role` enum. Service role only.

## 6. Storage (Attachments Bucket)

Files (invoices, receipts, photos) live in the private `attachments` storage bucket and are served exclusively via short-lived signed URLs (1-hour expiry, created in `attachment.service.ts`). The bucket accepts only PDFs, images, Word/Excel/PowerPoint documents and CSV (no HTML, SVG or macro-enabled Office files), up to 25 MB each.

### Path Convention
Every object is stored as `{organization_id}/{filename}`. The org-id prefix is the unit of isolation: storage policies derive the owning organization from the first path segment with `(storage.foldername(name))[1]::uuid`. Uploads that do not carry a valid org-id prefix are rejected by policy.

### Policies on `storage.objects` (bucket_id = 'attachments')
| Operation | Requirement |
|-----------|-------------|
| SELECT (incl. signed-URL creation) | `user_is_member_of_org(prefix_org, auth.uid())` |
| INSERT | `user_is_admin_or_manager_of_org(prefix_org, auth.uid())` |
| UPDATE | `user_is_admin_or_manager_of_org(prefix_org, auth.uid())` |
| DELETE | `user_is_admin_or_manager_of_org(prefix_org, auth.uid())` |

This mirrors the table-level RBAC: any member of the org can view its files; only Admin/Manager can write. Cross-organization access is impossible regardless of client behavior, because the policy — not the client-supplied `organization_id` — is the enforcement point. Defined in migration `20260612000000_scope_attachment_storage_policies.sql`, which also gates on all existing objects/`attachments.file_path` rows conforming to the path convention before applying.

## 7. Edge Function: ai-scan

The `ai-scan` function makes paid Anthropic API calls, so it enforces its own gate chain (it cannot rely on RLS — the file never touches the database):

1. **Authentication**: requires a valid Bearer token (`auth.getUser()`); no unauthenticated code path exists. The pre-auth `x-diagnostic` mode (which made a live Anthropic call and disclosed the API key prefix) was removed in June 2026.
2. **Org role**: the caller must be an **Admin or Manager** of the organization, on both paths: the `organization_id` form field for a direct upload, or the queued invoice's organization (`queue_item_id`). Checked against `organization_members` (service-role client); otherwise 403. `canScanInvoices` in `ai-scan/scanLimits.ts`.
3. **File limits**: 10 MB max (413) and a media-type allowlist — PDF, JPEG, PNG, WebP, GIF (415).
4. **Rate limits**: 60 scans per user in any trailing hour, and 200 per organization in any trailing 24 hours, tracked in the service-role-only `ai_scan_usage` table; exceeded → 429 ("Scan limit reached (60/hour)…" or "Daily scan limit reached for this organization…"). Usage is recorded *before* the Anthropic call so failed/aborted calls still count toward the quota. `scanLimitError` in `ai-scan/scanLimits.ts`.
5. **Errors**: an unexpected failure returns a generic "The scan failed. Reference: <id>" (500); the details go to the function log and Sentry under that reference. Anthropic's own error text is never returned.
6. **CORS**: pinned origin allowlist (production domains + `localhost:3000`); unknown origins receive no `Access-Control-Allow-Origin` header.

## 8. Edge Function: server (Hono)

The `server` function runs with the service-role key (RLS bypassed), so it authorizes every request explicitly. As of the June 2026 refactor it uses **Hono with declarative middleware** instead of ~30 hand-copied inline checks; the per-endpoint authorization is the spec in `docs/technical/server-endpoint-inventory.md`.

Middleware:
- **CORS** — pinned-origin allowlist (shared `_shared/cors.ts` with `ai-scan`); no `Access-Control-Allow-Credentials` reflection.
- **`requireUser`** — validates the Bearer token once; 401 otherwise.
- **`requireOrgRole({ roles, allowPlatformModerator, allowUnclaimedOrgManagers })`** — org membership + optional role allow-list; optionally lets a platform moderator through (the member list), or, while the org is unclaimed, a moderator or an Admin/Manager of an org sharing a gig with it (`user_can_manage_unclaimed_org`; org edit and delete).
- **`requireGigAccess(roles?)`** — the intersection model (caller's orgs ∩ the gig's participant orgs), with an optional role filter for mutations.

Two authorization gaps the refactor closed (both had failing tests written first):
- **Gig creation** now always requires Admin/Manager of a **required** `primary_organization_id` (previously the check was skipped entirely when the field was omitted).
- **Calendar `sync-gig-all-users`** now requires the caller to be a member of a participant org of the target gig (previously any authenticated user could trigger it).

WebAuthn `authenticate/*` endpoints remain intentionally public (the unlock flow) and gate only the cosmetic mobile lock, not data access. Top-level errors are captured to Sentry and returned as clean 500s with no internal detail. Route-level failures in `organizations.ts` and `accessRequests.ts` go through `fail()` (`lib/fail.ts`): the details are logged under a reference and the caller gets "Something went wrong. Reference: <id>". The exception is a message raised by our own database functions (`RAISE EXCEPTION` without an error code, SQLSTATE P0001), which is written for people and passed on. Email bodies built by the server escape every value people type (`lib/pure/accessRequestEmail.ts`).
