# Database Specification

**Purpose**: This document provides the complete database schema, Supabase integration details, and data access patterns for the GigWrangler application.

**Last Updated**: 2026-09-25

---

## Table of Contents

1. [Overview](#overview)
2. [Supabase Integration](#supabase-integration)
3. [High-Level Entity Diagram](#high-level-entity-diagram)
4. [Enum Types](#enum-types)
5. [Core Tables](#core-tables)
6. [Gig Management Tables](#gig-management-tables)
7. [Financial Management](#financial-management)
8. [Purchases & Attachments](#purchases--attachments)
9. [Staff Management Tables](#staff-management-tables)
10. [Equipment Tables](#equipment-tables)
11. [Google Calendar Integration Tables](#google-calendar-integration-tables)
12. [Operational Tables](#operational-tables)
13. [Helper Functions & Triggers](#helper-functions--triggers)
14. [Indexes](#indexes)
15. [Row-Level Security (RLS)](#row-level-security-rls)
16. [Authentication](#authentication)
17. [Real-Time Features](#real-time-features)

---

## Overview

The database uses **PostgreSQL 17** hosted on **Supabase** with Row-Level Security (RLS) for multi-tenant data isolation. All enum types are defined in the SQL migration (`supabase/migrations/20260209000000_initial_schema.sql`) and mirrored in `src/utils/supabase/constants.ts`.

**Technology Stack:**
- PostgreSQL 17 database
- Supabase backend (auth, realtime, storage)
- Direct Supabase client integration (no Prisma ORM in production)
- TypeScript types generated from schema

**Key Features:**
- Multi-tenant architecture with RLS
- Real-time subscriptions via Postgres CDC
- Unified activity log (`activity_log`) and automatic timestamps
- Hierarchical data structures (nested gigs, nested kits)
- Flexible participant/role management

---

## Supabase Integration

### What's Implemented

**Database:**
- Complete schema with 28 application tables
- Row-Level Security (RLS) policies for data isolation
- Automatic triggers for timestamp updates, kit-hierarchy integrity/caching, and attachment cleanup
- Scheduled jobs via `pg_cron` / `pg_net` (daily health check)
- Seed data for common staff roles

**Authentication:**
- Email/Password authentication (ready to use)
- Google OAuth integration via Supabase Auth
- Multiple providers supported (GitHub, Microsoft, etc.)
- Session management with automatic token refresh
- User profile creation on first login

**Real-Time:**
- Live updates when data changes
- Multi-user sync via Postgres CDC
- Automatic subscriptions for gigs, assets, kits

**API Layer:**
- Direct Supabase client calls from frontend
- Authentication middleware via RLS
- Permission checks (Admin/Manager/Staff/Viewer roles)

### File Structure

```
/
├── src/
│   ├── services/
│   │   └── *.service.ts                 # API service functions (gig, asset, kit, etc.)
│   └── utils/
│       ├── api-error-utils.ts           # Shared API error handling
│       └── supabase/
│           ├── client.tsx               # Supabase client singleton
│           └── types.tsx                # TypeScript types matching schema
└── supabase/
    └── migrations/
        └── *.sql                        # Database migrations (source of truth for schema)
```

---

## High-Level Entity Diagram

```mermaid
erDiagram
  %% Core organizational structure
  USERS ||--o{ ORGANIZATION_MEMBERS : belongs
  ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
  ORGANIZATIONS ||--o{ INVITATIONS : has
  USERS ||--o{ INVITATIONS : invited_by
  ORGANIZATIONS ||--o{ ACCESS_REQUESTS : receives
  USERS ||--o{ ACCESS_REQUESTS : requests
  USERS ||--o{ NOTIFICATIONS : receives

  %% Gig management and participation
  GIGS ||--o{ GIG_PARTICIPANTS : links
  ORGANIZATIONS ||--o{ GIG_PARTICIPANTS : participates
  GIGS ||--o{ GIG_PARTICIPANT_CONTACTS : has
  USERS ||--o{ GIG_PARTICIPANT_CONTACTS : "is contact"
  GIGS ||--o{ GIG_SCHEDULE_ENTRIES : has
  GIG_PARTICIPANTS ||--o{ GIG_SCHEDULE_ENTRIES : "act for"

  %% Activity log
  GIGS ||--o{ ACTIVITY_LOG : "logged on"
  ORGANIZATIONS ||--o{ ACTIVITY_LOG : scopes

  %% Financial management
  GIGS ||--o{ GIG_FINANCIALS : has
  ORGANIZATIONS ||--o{ GIG_FINANCIALS : owns

  %% Purchases & attachments
  ORGANIZATIONS ||--o{ PURCHASES : owns
  GIGS ||--o{ PURCHASES : "has expenses"
  PURCHASES ||--o{ PURCHASES : "header to items"
  PURCHASES ||--o{ ASSETS : "acquisition source"
  ATTACHMENTS ||--o{ ENTITY_ATTACHMENTS : "linked to"

  %% Staff management
  STAFF_ROLES ||--o{ GIG_STAFF_SLOTS : defines
  GIGS ||--o{ GIG_STAFF_SLOTS : has
  GIG_STAFF_SLOTS ||--o{ GIG_STAFF_ASSIGNMENTS : assigned
  USERS ||--o{ GIG_STAFF_ASSIGNMENTS : assigned_to

  %% Equipment management
  ORGANIZATIONS ||--o{ ASSETS : owns
  ORGANIZATIONS ||--o{ KITS : owns
  KITS ||--o{ KIT_COMPONENTS : contains
  ASSETS ||--o{ KIT_COMPONENTS : included_in
  KITS ||--o{ KIT_COMPONENTS : "nested as child_kit"
  KITS ||--o{ KIT_FLATTENED_CACHE : "flattens to"
  GIGS ||--o{ GIG_KIT_ASSIGNMENTS : assigned
  KITS ||--o{ GIG_KIT_ASSIGNMENTS : assigned_to

  %% Inventory tracking
  GIGS ||--o{ INVENTORY_TRACKING : tracks
```

---

## Enum Types

The following custom enumeration types are defined in the database:

### organization_role
Used for categorization of organizations (`organizations.roles`, an array) and their role in a gig (`gig_participants.role`). Renamed to this name in migration 20260522000000.
- `Production`
- `Sound`
- `Lighting`
- `Staging`
- `Rentals`
- `Venue`
- `Act`
- `Agency`

### user_role
Defines access levels within an organization.
- `Admin`
- `Manager`
- `Staff`
- `Viewer`

### gig_status
Tracks the lifecycle of a gig.
- `DateHold`
- `Proposed`
- `Booked`
- `Completed`
- `Cancelled`
- `Settled`

### fin_direction
Whether a `gig_financials` row is money coming to the organization (`in`) or money it pays (`out`). Added in migration 20261005000000.

### fin_stage
Where a `gig_financials` row stands (migration 20261005000000). Every stage except `paid` is optional; see [financials.md](financials.md) §2.3 for labels and what each counts toward.
- `requested`, `quoted`, `accepted`, `contract_sent`, `contracted`, `invoiced` (shown as "Owed" for money out), `paid`, `declined`, `cancelled`

### fin_type
**Legacy.** The pre-2026-10 record type, now only in `gig_financials.legacy_type` on converted rows. Not used by the app; to be dropped.
- `Bid Submitted`
- `Bid Accepted`
- `Bid Rejected`
- `Contract Submitted`
- `Contract Revised`
- `Contract Signed`
- `Contract Rejected`
- `Contract Cancelled`
- `Contract Settled`
- `Sub-Contract Submitted`
- `Sub-Contract Revised`
- `Sub-Contract Signed`
- `Sub-Contract Rejected`
- `Sub-Contract Cancelled`
- `Sub-Contract Settled`
- `Deposit Received`
- `Deposit Sent`
- `Deposit Refunded`
- `Payment Sent`
- `Payment Received` *(originally misspelled `Payment Recieved`; renamed in migrations 20260322000000 / 20260328000000)*
- `Expense Incurred`
- `Expense Reimbursed`
- `Invoice Issued`
- `Invoice Settled`
- `Informal Terms` *(added in migration 20260520000001)*

### fin_category
IRS Schedule C expense categories (replaced the original `Labor / Equipment / …` set in migration 20260512000000). Only applies to expense-type records; nullable on `gig_financials`.
- `Advertising`
- `Car and truck expenses`
- `Commissions and fees`
- `Contract labor`
- `Depreciation`
- `Insurance`
- `Legal and professional services`
- `Office expense`
- `Rent or lease`
- `Repairs and maintenance`
- `Supplies`
- `Taxes and licenses`
- `Travel`
- `Meals`
- `Utilities`
- `Wages`
- `Other expenses`

### schedule_activity_type (dropped)
Was the enum for `gig_schedule_entries.activity_type` (migration 20260616000000). Dropped by
20260926000000: the column is now free `text` (non-blank), and the UI suggests the defaults Load-In, Act Arrival,
Soundcheck, Doors, Set, Load-Out and Return (`SCHEDULE_DEFAULT_ITEMS` in `src/utils/supabase/constants.ts`).

### sync_status
Tracks Google Calendar sync state for gigs.
- `pending`
- `synced`
- `failed`
- `updated`
- `removed`

---

## Core Tables

### ER Diagram: Core Tables

```mermaid
erDiagram
    USERS {
        uuid id PK
        text email
        text first_name
        text last_name
        boolean platform_moderator
    }
    ORGANIZATIONS {
        uuid id PK
        text name
        organization_role_array roles
        boolean claimed
    }
    ORGANIZATION_MEMBERS {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        user_role role
        boolean is_primary_contact
    }
    INVITATIONS {
        uuid id PK
        uuid organization_id FK
        text email
        text role
        text status
    }

    USERS ||--o{ ORGANIZATION_MEMBERS : belongs
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
    ORGANIZATIONS ||--o{ INVITATIONS : has
    USERS ||--o{ INVITATIONS : invited_by
    STAFF_ROLES ||--o{ ORGANIZATION_MEMBERS : default_role
```

### users

User profiles (extends Supabase auth.users)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key, references auth.users(id) |
| email | TEXT | User's email address (unique, **nullable** since migration 20260906180000 so login-less contacts can have no email) |
| first_name | TEXT | User's first name (NOT NULL) |
| last_name | TEXT | User's last name (NOT NULL) |
| phone | TEXT | User's phone number (nullable) |
| avatar_url | TEXT | URL to user's avatar image (nullable) |
| address_line1 | TEXT | Street address (nullable) |
| address_line2 | TEXT | Apartment, suite, etc. (nullable) |
| city | TEXT | City (nullable) |
| state | TEXT | State or province (nullable) |
| postal_code | TEXT | ZIP/postal code (nullable) |
| country | TEXT | Country (nullable) |
| timezone | VARCHAR | IANA timezone (e.g., "America/New_York"). Default for CSV imports. (nullable) |
| role_hint | TEXT | Default staffing role hint (e.g., "FOH", "Lighting") (nullable) |
| user_status | TEXT | User account status: `active`, `pending`, `inactive`, `contact` (CHECK constraint; default 'active'). `contact` added in migration 20260825180000 |
| platform_moderator | BOOLEAN | Platform-level moderator flag, distinct from org Admin; routes access requests for unclaimed orgs (default false, NOT NULL; migration 20260908000000) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Address fields structured to support both US and international addresses
- `created_by` and `updated_by` fields in other models reference User.id but don't maintain reverse relations
- `user_status = 'contact'` marks a rolodex-only person who will never log in (no `auth.users` row); created via `add_organization_contact` / `create_contact_person`.
- `platform_moderator` has no granting UI; it is set directly via SQL.
- RLS is **ENABLED** on this table. Users can view their own profile and profiles of users in the same organizations, plus users of organizations they can manage contacts for (`user_can_manage_org_contacts`) and users linked as `gig_participant_contacts` on gigs they can access.

---

### organizations

Companies, venues, acts, and other entities

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Organization name (NOT NULL) |
| roles | organization_role[] | Array of organization roles (NOT NULL). Renamed from scalar `type` and converted to an array in migration 20260522000000 |
| url | TEXT | Organization website URL (nullable) |
| phone_number | TEXT | Organization phone number (nullable) |
| address_line1 | TEXT | Street address (nullable) |
| address_line2 | TEXT | Apartment, suite, etc. (nullable) |
| city | TEXT | City (nullable) |
| state | TEXT | State or province (nullable) |
| postal_code | TEXT | ZIP/postal code (nullable) |
| country | TEXT | Country (nullable) |
| description | TEXT | Organization description (nullable), long text, markdown |
| allowed_domains | TEXT | Comma separated list of automatically allowable user email domains. |
| claimed | BOOLEAN | Whether the organization has an Admin yet (default true, NOT NULL; migration 20260908000000 backfilled `false` for orgs with no Admin member) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**

- All authenticated users may read organizations (for participant selection).
- UPDATE policy "Admins can update per claimed status" (migration 20260908000000): an Admin of **this** org can always edit it; an Admin of **any** org (`user_is_admin`) can edit it only while `claimed = false`.
- `claimed` also drives access-request routing (see `access_requests`).
- The `description` field is a long text in markdown format.
- RLS is **ENABLED** on this table.

---

### organization_members

User memberships in organizations with roles

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL) |
| user_id | UUID | Reference to users.id (NOT NULL) |
| role | UserRole | RBAC role within organization: Admin, Manager, Staff, Viewer (NOT NULL) |
| default_staff_role_id | UUID | Reference to staff_roles.id for default gig assignments (nullable) |
| is_primary_contact | BOOLEAN | This member is the org's default point of contact (default false, NOT NULL; migration 20260825180000) |
| contact_title | TEXT | Free-text title at this org, e.g. "Venue Manager" — distinct from `role` (nullable; migration 20260825180000) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Unique constraint on (organization_id, user_id) ensures a user can only be a member of an organization once
- Partial unique index `organization_members_one_primary_contact_per_org` on (organization_id) WHERE `is_primary_contact` — at most one primary contact per org
- `default_staff_role_id` allows pre-filling staff assignments for this member
- Contact rows are written via SECURITY DEFINER RPCs (`add_organization_contact`, `link_existing_person_to_organization`, `update_organization_contact`, `set_organization_primary_contact`, `unset_organization_primary_contact`, `remove_organization_contact`), gated by `user_can_manage_org_contacts`.
- RLS is **ENABLED** on this table. Users can view members of their own organizations and members of any org they can manage contacts for ("Users can view members of organizations they can manage contacts for", migration 20260907000000); Admins can manage membership.

---

### invitations

Tracks pending and completed invitations to join organizations

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL) |
| email | TEXT | Email address of the invited user (NOT NULL) |
| role | TEXT | Role assigned to user: Admin, Manager, Staff, Viewer (NOT NULL) |
| invited_by | UUID | Reference to users.id (NOT NULL) |
| status | TEXT | Invitation status: `pending`, `accepted`, `expired`, `cancelled` (NOT NULL) |
| token | TEXT | Unique invitation token (unique, NOT NULL) |
| expires_at | TIMESTAMPTZ | Token expiration timestamp (NOT NULL) |
| accepted_at | TIMESTAMPTZ | When the invitation was accepted (nullable) |
| accepted_by | UUID | Reference to users.id (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp |
| updated_at | TIMESTAMPTZ | Record last update timestamp |

**Notes:**
- RLS is **ENABLED** on this table. Users can view invitations for their organizations.
- Composite unique constraint on (organization_id, email, status) prevents duplicate pending invitations.

---

### user_devices

WebAuthn/passkey device registrations for users

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Reference to auth.users(id) (NOT NULL, CASCADE delete) |
| credential_id | TEXT | WebAuthn credential ID (unique, NOT NULL) |
| public_key | TEXT | WebAuthn public key (NOT NULL) |
| device_name | TEXT | Human-readable device name (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| last_used_at | TIMESTAMPTZ | Last authentication timestamp (NOT NULL) |

**Notes:**
- RLS is **ENABLED** on this table. Users can only manage their own devices.

---

## Gig Management Tables

### ER Diagram: Gig Management

```mermaid
erDiagram
    GIGS {
        uuid id PK
        text title
        gig_status status
        timestamptz start
        timestamptz end
    }
    GIG_PARTICIPANTS {
        uuid id PK
        uuid gig_id FK
        uuid organization_id FK
        organization_role role
        boolean is_client
    }
    GIG_PARTICIPANT_CONTACTS {
        uuid id PK
        uuid gig_id FK
        uuid organization_id FK
        uuid user_id FK
        boolean is_primary_contact
    }
    GIG_SCHEDULE_ENTRIES {
        uuid id PK
        uuid gig_id FK
        text activity_type
        timestamptz start_time
        uuid act_participant_id FK "NULLABLE"
    }

    GIGS ||--o{ GIG_PARTICIPANTS : links
    GIGS ||--o{ GIGS : "parent/child"
    ORGANIZATIONS ||--o{ GIG_PARTICIPANTS : participates
    GIGS ||--o{ GIG_PARTICIPANT_CONTACTS : has
    ORGANIZATIONS ||--o{ GIG_PARTICIPANT_CONTACTS : "contact for"
    USERS ||--o{ GIG_PARTICIPANT_CONTACTS : "is contact"
    GIGS ||--o{ GIG_SCHEDULE_ENTRIES : has
    GIG_PARTICIPANTS ||--o{ GIG_SCHEDULE_ENTRIES : "act for"
```

### gigs

Main gig records with status, dates, and details

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| parent_gig_id | UUID | Reference to gigs.id for hierarchical relationships (nullable) |
| hierarchy_depth | INTEGER | Depth level in gig hierarchy (default 0, NOT NULL) |
| owner_organization_id | UUID | Reference to organizations.id: the organization the gig was created in (NOT NULL, ON DELETE RESTRICT; migration 20261020000000, #175) |
| title | TEXT | Gig title/name (NOT NULL) |
| start | TIMESTAMPTZ | Start date and time of the gig (NOT NULL) |
| end | TIMESTAMPTZ | End date and time of the gig (NOT NULL) |
| timezone | TEXT | IANA timezone identifier (e.g., "America/New_York") (NOT NULL) |
| status | GigStatus | Gig status enum: DateHold, Proposed, Booked, Completed, Cancelled, Settled (NOT NULL) |
| tags | TEXT[] | Array of tags for categorization (default '{}') |
| notes | TEXT | Long text field for freeform notes (Markdown-formatted, nullable) |
| created_by | UUID | Reference to users.id (informational, NOT NULL) |
| updated_by | UUID | Reference to users.id (informational, NOT NULL) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Gigs are shared (participated in) by multiple organizations, and each has one **owner organization** (#175, migration 20261020000000): the organization it was created in. Existing gigs were backfilled from the `gig.created` activity entry, else the creator's organization among the participants, else the only participant; the migration fails if any gig can't be resolved.
  - The owner is always an active participant: it has a participation on the gig and none of its rows is Inactive. Constraint triggers check this at commit (`gig_owner_is_active_participant`), so a gig and its participants can be written in either order. An organization that owns gigs can't be deleted.
  - A child gig always has its parent's owner (trigger `gigs_a_owner_rules`): a gig only goes under a parent its owner owns, a child's owner can't be set apart from its parent's, and a new owner on a parent passes down to its children (which must have that owner on them).
  - **Delete:** only an Admin of the owner, and only when no other *claimed* organization is on the gig (Inactive ones count; unclaimed venue and act records don't) and the gig has no child gigs (`user_can_delete_gig`). Otherwise the owner's Admins and Managers cancel it.
  - **Status, owner and parent gig** (and `hierarchy_depth`): only the owner's Admins and Managers. A new owner must be an active participant.
  - **Other fields** (title, times, timezone, notes, tags): Admins and Managers of any *active* participant. An Inactive organization is read-only on them until it's reactivated.
- Gigs link to organizations via `gig_participants` with a `role` using `organization_role` enum values
- Gig status transitions are recorded in `activity_log` (`event_type = 'gig.status_changed'`) by the application via the `log_activity` RPC — there is no longer a database trigger for this (migration 20260615000000)
- Any status can transition to any other status (no restrictions)
- Gigs can span midnight, so we use full DateTime for both start and end
- The "gig date" shown in UI is derived from the start DateTime
- `parent_gig_id` enables hierarchical relationships between gigs (e.g., main event with sub-events)
- `hierarchy_depth` tracks the depth level in the hierarchy for performance and validation
- Deleting a gig fires `trg_cleanup_attachments` (migration 20260831000100).
- RLS is **ENABLED** on this table. Users can view gigs their organization participates in; Admins/Managers of an active participant can update (with the owner-only fields above); an Admin of the owner can delete under the rule above. There is **no INSERT policy** (dropped in migration 20260613000000): gigs are created only through the SECURITY DEFINER `create_gig_complex` RPC, which requires `primary_organization_id` and that the caller is Admin/Manager of it. It stores that organization as the owner (for a child gig, the parent's owner, which must be the primary organization) and requires the owner among the participants.

---

### gig_participants

Organizations participating in a gig (venue, act, production, etc.)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (the participating organization) (NOT NULL) |
| gig_id | UUID | Reference to gigs.id (NOT NULL) |
| role | organization_role | Participant role (single value, NOT NULL) |
| notes | TEXT | Long text field for freeform notes (Markdown-formatted, nullable) |
| is_client | BOOLEAN | This participating org is (one of) the paying client(s) for the gig (default false, NOT NULL; migration 20260825180000) |
| inactive | BOOLEAN | The organization is Inactive on this gig (default false, NOT NULL; migration 20261020000000, #175) |

**Notes:**
- `role` uses the `organization_role` enum values: Production, Sound, Lighting, Staging, Rentals, Venue, Act, Agency
- Composite unique constraint on (gig_id, organization_id, role)
- `is_client` is orthogonal to `role` and deliberately has no uniqueness constraint (split billing / co-promotion)
- RLS is **ENABLED** on this table. Users can view participants for accessible gigs. Admins/Managers of an active participant can add participants and change role, notes and `is_client`. A participation's gig and organization never change (remove it and add another).
- **Inactive** (#175; redefined by Cameron 10-13, migration 20261021000000): the organization is being removed from the gig. In Cameron's words: "some of its records (such as financial) can be maintained in case there are sunk costs and agreements to unravel or notes to preserve, but otherwise staff and equipment should be released and the organization should have no interest or ability to change other aspects of the gig."
  - **Release first:** marking it Inactive is refused (`23514`) while it has `gig_staff_slots` (and so staff) or `gig_kit_assignments` on the gig.
  - **While Inactive** it keeps its own `gig_financials` and its own participant `notes`, and can reactivate itself or leave. It can't add staff slots or kit assignments on the gig, or move one onto it (`gig_inactive_no_staff_or_kits`, `42501`); can't change its role or client flag; and every contact on the gig, its own included, is read-only (`gig_participant_contacts_inactive_rule`). The shared details and schedule are read-only as before.
  - Nothing of an Inactive organization counts in conflict checks: it has no staff or kits on the gig, and participant conflicts skip Inactive rows.
  - The owner's Admins and Managers, or the organization's own, mark it Inactive or reactivate it. The owner is never Inactive, and a participation can't be added already Inactive. While it's Inactive, it isn't given another role on the gig (`gig_participants_inactive_no_new_role`, `23514`).
  - **Gig History:** a statement-level trigger (`gig_participants_log_inactive`) writes one `participant.inactivated` or `participant.reactivated` entry when an organization's state on the gig changes (Inactive while any of its roles is), attributed like removals (below). Changing one of two roles while the other stays Inactive logs nothing; role or notes edits log nothing.
  - Inactive is per organization: if any of its roles on the gig is Inactive, it's Inactive on the gig (`user_can_manage_gig_active`). The app marks and reactivates all of an organization's rows together.
- The helper functions behind these rules (`user_can_manage_gig_active`, `user_manages_gig_owner`, `org_is_claimed`, `user_can_delete_gig`) can be called only by signed-in users; `gig_activity_actor_org` and `log_participant_event` only by the triggers.
- **Removing an organization** (#175): by the owner's Admins and Managers or the organization's own; an unclaimed record (a venue or act nobody has claimed) by any active participant's Admin or Manager. Dropping one of an organization's roles is always allowed; when its last role goes (`gig_participants_after_remove`):
  - the owner's can't be removed;
  - an organization with kit assignments or staff slots on the gig can't be removed: the message says to release its staff and equipment, then mark it Inactive;
  - one with financials only can't be removed either: the message says to mark it Inactive, or, already Inactive, that it stays Inactive to keep them;
  - otherwise its `inventory_tracking` and `gig_participant_contacts` rows for the gig are deleted and its purchases' `gig_id` is set to null.
  Rows removed because the gig or the organization is being deleted skip these checks.
- **Removals are logged by the database** (#175, migration 20261021000000): a statement-level trigger (`gig_participants_log_removed`) writes, through `log_participant_event`, one `participant.removed` entry to `activity_log` per organization the statement removed roles of; a refused removal rolls it back. The context has `actor_display_name` (from `users`), `actor_org_name`, `gig_title`, `organization_name`, `role` (the roles removed, comma-separated) and `left`. An entry is attributed to the owner when the user is one of its Admins or Managers; otherwise to the organization removed when the user belongs to it; otherwise to the user's Admin/Manager organization among the gig's participants (`gig_activity_actor_org`). `left` is true when the organization has no role left on the gig and the entry is attributed to it (its own Admin or Manager, not acting as the owner). Cascades and writes with no signed-in user log nothing. The app doesn't log removals itself.

---

### gig_participant_contacts

Who to contact at a participating organization, for one specific gig (migration 20260906200000). Independent of `organization_members` — a person listed here need not be a member of that organization.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| gig_id | UUID | Reference to gigs.id (NOT NULL, CASCADE delete) |
| organization_id | UUID | Reference to organizations.id (NOT NULL, CASCADE delete) |
| user_id | UUID | Reference to users.id (NOT NULL, CASCADE delete) |
| is_primary_contact | BOOLEAN | Primary contact for this org on this gig (default false, NOT NULL) |
| title | TEXT | Free-text role/title on this gig, e.g. "Day-of contact" (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Unique constraint on (gig_id, organization_id, user_id); partial unique index `gig_participant_contacts_one_primary_per_gig_org` on (gig_id, organization_id) WHERE `is_primary_contact` — at most one primary per gig/org.
- `is_primary_contact` defaults from `organization_members.is_primary_contact` only when the person is first added.
- RLS is **ENABLED**. SELECT for anyone with gig access (`user_has_access_to_gig`). There are **no** INSERT/UPDATE/DELETE policies — all writes go through SECURITY DEFINER RPCs (`add_gig_participant_contact`, `set_gig_participant_contact_primary`, `remove_gig_participant_contact`, plus `create_contact_person` for brand-new people), gated by `user_can_manage_org_contacts`.

---

### gig_schedule_entries

Run-of-show / multi-act schedule entries for a gig (migrations 20260616000000, 20260617000000).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| gig_id | UUID | Reference to gigs.id (NOT NULL, CASCADE delete) |
| activity_type | text | Schedule item name: a UI default or any custom text (NOT NULL, not blank; free text since 20260926000000) |
| label | TEXT | Optional display label (nullable) |
| start_time | TIMESTAMPTZ | Start time (NOT NULL) |
| end_time | TIMESTAMPTZ | End time (**nullable** since 20260617000000) |
| act_participant_id | UUID | Reference to gig_participants.id — the act this entry belongs to (nullable, SET NULL on delete) |
| sort_order | INTEGER | Display ordering (default 0, NOT NULL) |
| notes | TEXT | Notes (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- The original `end_time > start_time` check (`schedule_entry_time_order`) was dropped in 20260617000000; an entry may have only a start time.
- No `update_updated_at_column` trigger is attached; `updated_at` must be set by the writer.
- RLS is **ENABLED**. SELECT for any member of a participating org; INSERT/UPDATE/DELETE for Admin/Manager of an *active* participating org (`user_can_manage_gig_active`, #175).

---

## Financial Management

### ER Diagram: Gig Financials

```mermaid
erDiagram
    GIGS {
        uuid id PK
        text title
    }
    ORGANIZATIONS {
        uuid id PK
        text name
    }
    GIG_FINANCIALS {
        uuid id PK
        uuid gig_id FK
        uuid organization_id FK
        fin_direction direction
        fin_stage stage
        fin_category category
        decimal amount
        decimal amount_settled
        date date
        uuid purchase_id FK "NULLABLE"
        uuid staff_assignment_id FK "NULLABLE"
    }

    GIGS ||--o{ GIG_FINANCIALS : has
    ORGANIZATIONS ||--o{ GIG_FINANCIALS : owns
    ORGANIZATIONS ||--o{ GIG_FINANCIALS : counterparty
```

For how `purchase_id` / `staff_assignment_id` feed the single ledger, and the
full ER diagram, see [financials.md](financials.md).

### gig_financials

Every amount of money a gig brings in or costs, one row each, with its stage.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| gig_id | UUID | Reference to gigs.id (NOT NULL) |
| organization_id | UUID | Reference to organizations.id (the owning organization) (nullable) |
| direction | fin_direction | `in` or `out` (NOT NULL; migration 20261005000000) |
| stage | fin_stage | Where the row stands (NOT NULL; migration 20261005000000) |
| legacy_type | fin_type | The pre-2026-10 `type`, kept on converted rows for audit (nullable; renamed from `type` in migration 20261005000000) |
| category | fin_category | Category for reporting — IRS Schedule C categories, see below (**nullable**, no default) |
| amount | DECIMAL(10,2) | Agreed amount (nullable only when `stage = 'requested'`; CHECK `gig_financials_amount_present`) |
| amount_settled | DECIMAL(10,2) | Amount actually paid or received; required when `stage = 'paid'` (CHECK `gig_financials_paid_has_settlement`) |
| mileage | NUMERIC(10,2) | Miles travelled to/from the gig, for mileage-based expense rows (nullable; migration 20260601000000) |
| currency | TEXT | Currency code (default 'USD') (NOT NULL) |
| date | DATE | When the item started (NOT NULL) |
| due_date | DATE | Payment due date; NULL means due once the gig is over (nullable) |
| paid_at | TIMESTAMPTZ | When payment was made; required when `stage = 'paid'` |
| reference_number| TEXT | Invoice, PO, or check number (nullable) |
| counterparty_id | UUID | Reference to organizations.id for the other party in transaction (nullable) |
| external_entity_name | TEXT | Name of counterparty if not in organizations table (nullable) |
| purchase_id | UUID | Reference to purchases.id — the source receipt/invoice this ledger row records (nullable, ON DELETE SET NULL; migration 20260319213000) |
| staff_assignment_id | UUID | Reference to gig_staff_assignments.id — the completed assignment this labor cost came from (nullable, ON DELETE SET NULL; migration 20260319213000) |
| description | TEXT | Detailed description or notes (nullable, Markdown-formatted) |
| notes | TEXT | Internal notes (nullable) |
| created_by | UUID | Reference to users.id (informational, NOT NULL) |
| updated_by | UUID | Reference to users.id (informational, nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- `gig_financials` replaces the legacy `gig_bids` table and `gigs.amount_paid` column.
- Migration 20261005000000 converted the old typed rows (several per deal) into one row per amount with a stage, logging a `financial.converted` activity entry per surviving row. Index `idx_gig_financials_gig_direction_stage` covers (gig_id, direction, stage).
- `purchase_id` / `staff_assignment_id` are the two-way links to the source documents that feed the ledger — see [financials.md](financials.md) §2.3.
- **`fin_category`** was reworked (migrations 20260328000001 / 20260512000000) from the original `Labor / Equipment / Transportation / Venue / Production / Insurance / Rebillable / Other` set to IRS Schedule C names: `Advertising`, `Car and truck expenses`, `Commissions and fees`, `Contract labor`, `Depreciation`, `Insurance`, `Legal and professional services`, `Office expense`, `Rent or lease`, `Repairs and maintenance`, `Supplies`, `Taxes and licenses`, `Travel`, `Meals`, `Utilities`, `Wages`, `Other expenses`. It was also made nullable and lost its default (migrations 20260513000000 / 20260520000000). The authoritative list is `FIN_CATEGORY_CONFIG` in `src/utils/supabase/constants.ts`.
- RLS is **ENABLED**. Since migration 20260912000000 (cross-org leak fix, issue #61) there are exactly two policies, both scoped to the row's own `organization_id` via `user_is_admin_or_manager_of_org` — one FOR SELECT, one FOR ALL. Admins/Managers of *other* orgs participating in the same gig can no longer see or modify the row. Rows with a NULL `organization_id` are therefore invisible to all non-service-role clients.
- Deleting a row fires `trg_cleanup_attachments`, which removes its `entity_attachments` links and any solely-owned `attachments` rows (migration 20260831000100).
- `organization_id` represents the tenant who "owns" or is responsible for this financial record.
- `counterparty_id` or `external_entity_name` tracks who the money is coming from or going to.

---

## Purchases & Attachments

### ER Diagram: Purchases & Attachments

```mermaid
erDiagram
    PURCHASES {
        uuid id PK
        uuid organization_id FK
        uuid gig_id FK "NULLABLE"
        uuid parent_id FK "NULLABLE"
        text row_type "header | line"
        uuid asset_id FK "NULLABLE"
    }
    ASSETS {
        uuid id PK
        uuid purchase_id FK "NULLABLE"
        text manufacturer_model
        text status
    }
    ATTACHMENTS {
        uuid id PK
        uuid organization_id FK
        text file_name
    }
    ENTITY_ATTACHMENTS {
        uuid id PK
        uuid attachment_id FK
        text entity_type
        uuid entity_id
    }

    ORGANIZATIONS ||--o{ PURCHASES : owns
    GIGS ||--o{ PURCHASES : "has expenses"
    PURCHASES ||--o{ PURCHASES : "header to items"
    PURCHASES ||--o{ ASSETS : "acquisition source"

    ORGANIZATIONS ||--o{ ATTACHMENTS : owns
    ATTACHMENTS ||--o{ ENTITY_ATTACHMENTS : "linked to"
    ENTITY_ATTACHMENTS }o--|| ASSETS : "polymorphic"
    ENTITY_ATTACHMENTS }o--|| PURCHASES : "polymorphic"
    ENTITY_ATTACHMENTS }o--|| GIGS : "polymorphic"
```

### purchases

Handles acquisition headers and expense line items. Uses a self-referencing `parent_id` to link items to their header row.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL) |
| gig_id | UUID | Reference to gigs.id — links expenses to a gig (nullable) |
| parent_id | UUID | Self-reference to purchases.id — links items to their header (nullable) |
| asset_id | UUID | Reference to assets.id: marks a line as tracked as equipment, pointing at its lot or its first unit (nullable). The full set of a line's units is `assets.purchase_line_id` |
| row_type | TEXT | Discriminator: `'header'` or `'line'` (NOT NULL, CHECK constraint). Before migration 20261012000000 a line was `'item'` or `'asset'`; now whether it is tracked as equipment is `asset_id`, and its tax treatment is `tax_treatment`. |
| purchase_date | DATE | Date of purchase (nullable) |
| vendor | TEXT | Vendor name (nullable) |
| total_inv_amount | NUMERIC(10,2) | Total invoice amount — header only (nullable) |
| payment_method | TEXT | Payment method — header only (nullable) |
| line_amount | NUMERIC(10,2) | Line item subtotal — item only (nullable) |
| line_cost | NUMERIC(10,2) | Line item burdened cost (incl. pro-rata tax/shipping) — item only (nullable) |
| quantity | NUMERIC(12,4) | Quantity — item only (nullable) |
| item_price | NUMERIC(10,2) | Unit price — item only (nullable) |
| item_cost | NUMERIC(10,2) | Unit burdened cost — item only (nullable) |
| description | TEXT | Line item description — item only (nullable) |
| category | TEXT | Category — item only (nullable) |
| tax_treatment | TEXT | Lines only: `'expense'` or `'depreciate'`; NULL on headers (CHECK). Independent of `asset_id` except that depreciate requires one (deferred check). Migration 20261006000000. |
| created_by | UUID | Reference to users.id (default auth.uid()) |
| updated_by | UUID | Reference to users.id (default auth.uid()) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- A **header** row (`row_type = 'header'`) represents an overall purchase transaction (vendor, date, total, payment method).
- **Line** rows represent individual line items and reference their header via `parent_id`; a line tracked as equipment has `asset_id` set.
- Purchases are recorded by `create_purchase_transaction_v2` (#183): a line for each item, and for each tracked line its units (one per serial or tag) or one lot, each with `purchase_line_id`; the line's first unit or its lot sets `asset_id`. The scan and manual purchase screens and the CSV import (#183 D) all use it; the import then adds kit lines (`kit_components.asset_id`) for rows that name a kit. `create_purchase_transaction_v1` was dropped by 20261025000000 (#317); `track_purchase_line_as_equipment` was dropped by 20261029000000 (#325); a saved line is tracked with `add_purchase_line_units`. (`reclassify_expense_as_asset` was retired by 20261011000000.)
- `gig_id` links gig-specific expenses to the relevant gig, displayed alongside `gig_financials`. Lines only, and only expensed lines (constraints `purchases_header_no_gig`, `purchases_depreciate_no_gig`, migration 20261009000000). It is set per line on the Purchases tab, or for each expensed line when a receipt is scanned on a gig — see [financials.md](financials.md) §4.
- A gig-linked purchase does **not** automatically get a `gig_financials` ledger row: the on-gig receipt scan creates one, but CSV import and post-hoc line assignment only prompt/offer to. Without that ledger row the expense is invisible to gig profitability.
- Assets acquired in a purchase reference the header row via `assets.purchase_id`.
- Deleting a row fires `trg_cleanup_attachments` (migration 20260831000100), removing its `entity_attachments` links and any solely-owned `attachments` rows.
- **Tax treatment (#133, migration 20261006000000)** — a line written without a `tax_treatment` is an expense (an old `row_type` `asset` / `item` from an app before 10-07 still sets depreciate / expense). A depreciated line must keep its `asset_id` and can't be pointed at by a `gig_financials` row. Rows dated in a year locked in `tax_years` can't have their tax fields changed, added or deleted — see [financials.md](financials.md) §2.5 and §3.
- **Writers (#133 step 2, migration 20261007000000)** — the purchase function (`create_purchase_transaction_v2` since #183) stores each line's `tax_treatment` (the recovery period moved to `assets` in 20261013000000); `add_purchase_line_units(line, units)` (SECURITY DEFINER, Admins/Managers, 20261017000000) adds and links `assets` rows for a saved line without changing anything else, so it works in locked years. (`track_purchase_line_as_equipment`, which did this before #183 D, was dropped by 20261029000000.)
- RLS is **ENABLED** on this table. Only Admins/Managers of the owning org can view or manage purchases — the member-level SELECT policy was dropped in migration 20260613000000 (Staff/Viewer have no Financials access).

---

### attachments

Metadata for files stored in Supabase Storage.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL) |
| file_path | TEXT | Path to the file in Supabase Storage (NOT NULL) |
| file_name | TEXT | Original file name (NOT NULL) |
| created_by | UUID | Reference to users.id (default auth.uid(), nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Files are stored in Supabase Storage; this table tracks metadata only.
- Scoped to organization via `organization_id` for tenant isolation.
- RLS is **ENABLED** on this table. Users can view attachments for their organization; Admins/Managers can manage.
- `file_path` MUST follow the `{organization_id}/{filename}` convention: the storage policies on the `attachments` bucket derive the owning org from the first path segment (org members can read; Admins/Managers can write — see `docs/technical/security-scheme.md` §6 and migration `20260612000000_scope_attachment_storage_policies.sql`).

---

### entity_attachments

Polymorphic junction table linking attachments to any entity type.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| attachment_id | UUID | Reference to attachments.id (NOT NULL) |
| entity_type | TEXT | Discriminator: `'asset'`, `'purchase'`, `'gig'`, or `'gig_financial'` (NOT NULL, CHECK constraint). `'gig_financial'` added in migration 20260831000000. |
| entity_id | UUID | ID of the target entity record (NOT NULL) |
| created_by | UUID | Reference to users.id (default auth.uid(), nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Enables one attachment to be linked to multiple entities (e.g., a receipt linked to both a purchase and an asset).
- `entity_type` + `entity_id` form the polymorphic reference — there is no database-level FK constraint on `entity_id`. Instead, each host table (`assets`, `gigs`, `purchases`, `gig_financials`) has a `trg_cleanup_attachments` BEFORE DELETE trigger that removes the dangling join rows and any solely-owned `attachments` rows (migration 20260831000100). The underlying storage object is removed best-effort by the app on `deleteGigFinancial`; other delete paths rely on a storage lifecycle sweep.
- RLS is **ENABLED** on this table. Access controlled via the parent attachment's organization — Admin/Manager to manage, org member to view; the check is independent of `entity_type`.

---

## Staff Management Tables

### ER Diagram: Staff Management

```mermaid
erDiagram
    STAFF_ROLES {
        uuid id PK
        text name
    }
    GIG_STAFF_SLOTS {
        uuid id PK
        uuid gig_id FK
        uuid staff_role_id FK
        integer required_count
    }
    GIG_STAFF_ASSIGNMENTS {
        uuid id PK
        uuid slot_id FK
        uuid user_id FK
        text status
        uuid gig_financial_id FK "NULLABLE"
    }

    GIGS ||--o{ GIG_STAFF_SLOTS : has
    STAFF_ROLES ||--o{ GIG_STAFF_SLOTS : defines
    ORGANIZATIONS ||--o{ GIG_STAFF_SLOTS : owns
    GIG_STAFF_SLOTS ||--o{ GIG_STAFF_ASSIGNMENTS : assigned
    USERS ||--o{ GIG_STAFF_ASSIGNMENTS : assigned_to
```

### staff_roles

Global staff role choices (FOH, Lighting, etc.)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Staff role name (e.g., "FOH", "Lighting", "Stage", "CameraOp") (unique, NOT NULL) |
| description | TEXT | Description of the staff role and responsibilities (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Staff roles are enumerated in this table to support future staffing template functionality
- Templates can be created for different gig types based on gig tags
- RLS is **ENABLED** on this table. Anyone can view staff roles.

---

### gig_staff_slots

Staff positions needed for a gig

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (the owning organization) (nullable) |
| gig_id | UUID | Reference to gigs.id (NOT NULL) |
| staff_role_id | UUID | Reference to staff_roles.id (NOT NULL) |
| required_count | INTEGER | Number of people needed for this role (default 1, NOT NULL) |
| notes | TEXT | Notes about this staff need (nullable, Markdown-formatted) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Staff roles are enumerated via reference to staff_roles table
- This enables future staffing template functionality
- RLS is **ENABLED** on this table. Users can view slots for accessible gigs; Admins/Managers can manage.

---

### gig_staff_assignments

Actual staff assigned to positions

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| slot_id | UUID | Reference to gig_staff_slots.id (NOT NULL) |
| user_id | UUID | Reference to users.id (NOT NULL) |
| status | TEXT | Assignment status (e.g., "Confirmed", "Requested", "Declined") (NOT NULL) |
| rate | DECIMAL(10,2) | Hourly or daily rate for this assignment (nullable) |
| fee | DECIMAL(10,2) | Total fee for this assignment (nullable) |
| notes | TEXT | Notes about this assignment (nullable, Markdown-formatted) |
| assigned_at | TIMESTAMPTZ | Assignment timestamp (default NOW(), NOT NULL) |
| confirmed_at | TIMESTAMPTZ | Confirmation timestamp (nullable) |
| completed_at | TIMESTAMPTZ | When the assignment was marked complete (nullable; migration 20260319213000) |
| units_completed | NUMERIC(10,2) | Units (hours/days) actually worked, used to cost the labor (nullable; migration 20260319213000) |
| gig_financial_id | UUID | Reference to gig_financials.id — the ledger row recording this labor cost (nullable, ON DELETE SET NULL; migration 20260319213000) |

**Notes:**
- There is no direct relation between Gig and User, only through GigStaffSlots and GigStaffAssignments.
- There is no direct relation between Gig and GigStaffAssignments (only through GigStaffSlots)
- `gig_financial_id` is the back-link of `gig_financials.staff_assignment_id` — see [financials.md](financials.md).
- RLS is **ENABLED** on this table. Users can view assignments for accessible gigs; Admins/Managers can manage; Staff can update their own ("Staff can update their own assignments", recreated in 20260319213000 with a WITH CHECK intended to stop staff changing `completed_at` / `units_completed` / `gig_financial_id` — note that as written the check compares each column to itself, so it does not actually enforce this).

---

## Equipment Tables

### ER Diagram: Equipment & Inventory

```mermaid
erDiagram
    ASSETS {
        uuid id PK
        uuid organization_id FK
        uuid purchase_id FK "NULLABLE"
        text manufacturer_model
        text status
    }
    KITS {
        uuid id PK
        uuid organization_id FK
        text name
        boolean is_container
    }
    KIT_COMPONENTS {
        uuid id PK
        uuid kit_id FK
        uuid asset_id FK "NULLABLE"
        uuid child_kit_id FK "NULLABLE"
        integer quantity
    }
    KIT_FLATTENED_CACHE {
        uuid kit_id PK
        uuid asset_id PK
        integer total_quantity
    }
    GIG_KIT_ASSIGNMENTS {
        uuid id PK
        uuid gig_id FK
        uuid kit_id FK
    }
    INVENTORY_TRACKING {
        uuid id PK
        uuid gig_id FK
        uuid kit_id FK "NULLABLE"
        uuid asset_id FK "NULLABLE"
        text status
    }

    ORGANIZATIONS ||--o{ ASSETS : owns
    ORGANIZATIONS ||--o{ KITS : owns
    KITS ||--o{ KIT_COMPONENTS : contains
    ASSETS ||--o{ KIT_COMPONENTS : included_in
    KITS ||--o{ KIT_COMPONENTS : "nested as child_kit"
    KITS ||--o{ KIT_FLATTENED_CACHE : "flattens to"
    ASSETS ||--o{ KIT_FLATTENED_CACHE : counted_in
    GIGS ||--o{ GIG_KIT_ASSIGNMENTS : assigned
    KITS ||--o{ GIG_KIT_ASSIGNMENTS : assigned_to
    GIGS ||--o{ INVENTORY_TRACKING : tracks
```

### equipment_items

What a piece of equipment **is** (#162, migration 20261014000000): one row per organization per manufacturer & model + category. The units and lots that are owned are rows in `assets`, each pointing here.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Owning organization (NOT NULL, CASCADE delete) |
| category | TEXT | Equipment category name (NOT NULL) |
| manufacturer_model | TEXT | Manufacturer and model, whitespace tidied (NOT NULL) |
| type | TEXT | Comma path from general to specific (nullable) |
| description | TEXT | (nullable) |
| insurance_class | TEXT | (nullable) |
| created_by / updated_by | UUID | Reference to users.id (nullable) |
| created_at / updated_at | TIMESTAMPTZ | (NOT NULL) |

**Notes:**
- Unique index `equipment_items_org_model_category_key` on (organization_id, `equipment_match_key(manufacturer_model)`, `equipment_match_key(category)`): two records are the same item when model and category match, ignoring case and whitespace (Cameron, 10-08). Type doesn't count.
- `equipment_item_for(org, model, category, …)` (SECURITY DEFINER, not callable by clients) returns the matching item, creating it if needed.
- RLS: the organization's members read; its Admins and Managers write.
- The backfill created one item per model + category from the existing records, named after the earliest.

---

### assets

Equipment we own: a **unit** (one physical item, with a serial number or tag) or a **lot** (no serial or tag; any quantity). See `equipment_items` for what each one is.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (tenant that owns this asset) (NOT NULL) |
| purchase_id | UUID | Reference to purchases.id — links to acquisition header (nullable) |
| equipment_item_id | UUID | Reference to equipment_items.id: what this unit or lot is (NOT NULL, RESTRICT). Migration 20261014000000 |
| purchase_line_id | UUID | Reference to purchases.id: the purchase line it came from (nullable, SET NULL). Every unit on a line, or its lot, points here; the purchase screens write it through `create_purchase_transaction_v2` and `add_purchase_line_units` (#183), and depreciation and recovery periods are found through it |
| acquisition_date | DATE | Date asset was acquired (NOT NULL) |
| vendor | TEXT | Vendor from which asset was purchased (nullable) |
| item_price | NUMERIC(10,2) | Unit purchase price (nullable) |
| item_cost | NUMERIC(10,2) | Burdened unit cost incl. pro-rata tax/shipping (nullable) |
| category | TEXT | Asset category (e.g., "Audio", "Lighting", "Video") (NOT NULL) |
| insurance_policy_added | BOOLEAN | Whether asset has been added to insurance policy (default false, NOT NULL) |
| manufacturer_model | TEXT | Manufacturer and model information (NOT NULL) |
| type | TEXT | Asset type (nullable) |
| serial_number | TEXT | Asset serial number (nullable). With a serial number or tag, quantity must be 1 (trigger `assets_unit_quantity_rule`, checked when the serial, tag or quantity changes) |
| tag_number | TEXT | Physical tag number for identification (nullable) |
| description | TEXT | Long text description of asset (Markdown-formatted, nullable) |
| replacement_value | NUMERIC(10,2) | Replacement value for insurance purposes (nullable) |
| insurance_class | TEXT | Insurance classification (nullable) |
| quantity | NUMERIC(12,4) | Asset quantity (default 1) |
| status | TEXT | Asset status (default 'Active', NOT NULL): Active, Inactive, Maintenance, Disposed, Returned or Missing (CHECK `assets_status_known`, migration 20261022000000) |
| retired_on | DATE | Date asset was retired/disposed of (nullable) |
| liquidation_amt | NUMERIC(10,2) | Amount received on liquidation/disposal (nullable) |
| recovery_period | SMALLINT | Tax recovery period, 5, 7 or 15 years (CHECK); only on depreciated equipment (trigger `assets_recovery_period_rules`). Migration 20261013000000, which dropped `service_life` and `dep_method` |
| written_off_from | UUID | For a piece split off a lot by a write-off: the lot it came from (SET NULL). Migration 20261018000000 |
| status_before_write_off | TEXT | The status a written-off record had, which Undo restores |
| maintenance_notes | TEXT | Condition notes for the current maintenance stint (#186, migration 20261022000000) |
| maintenance_location | TEXT | Where it is while in maintenance, e.g. Repair Bench |
| maintenance_expected_back | DATE | When it's expected back in service |
| maintenance_since | TIMESTAMPTZ | When it was flagged for maintenance |
| maintenance_by | UUID | Who flagged it: reference to users.id (SET NULL) |
| maintenance_from | UUID | For a piece split off a lot by `send_to_maintenance`: the lot it came from (SET NULL), which Return to service merges it back into |
| status_before_maintenance | TEXT | Active or Inactive: the status Return to service restores |
| maintenance_pending | BOOLEAN | Flagged "to maintenance" while still out at a gig (default false, NOT NULL) |
| maintenance_pending_gig_id | UUID | The gig a pending record has to come home from: reference to gigs.id (SET NULL) |
| maintenance_pending_quantity | NUMERIC | For part of a lot: how many pieces are flagged (whole, ≥ 1). Null means the whole record |
| created_by | UUID | Reference to users.id (informational, NOT NULL) |
| updated_by | UUID | Reference to users.id (informational, NOT NULL) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- **Maintenance (#186, migration 20261022000000; Cameron 10-14 / 10-18):**
  - **Send to maintenance** (`send_to_maintenance(p_asset_id, p_quantity, p_notes, p_location, p_expected_back, p_gig_id)`): a unit or a whole lot becomes status Maintenance with the details above. Part of a lot (N < quantity) splits off into its own record of N with the lot's values (purchase line, per-piece `item_cost`, item, recovery period), status Maintenance and `maintenance_from` = the lot; the lot's quantity drops by N, so value and depreciation aren't counted twice. Refused for records that are retired, Disposed, Returned, Missing, already in Maintenance or already flagged (except adding to a lot's waiting flag, below).
  - **Pending ("to maintenance").** With `p_gig_id`, a record still out is only flagged: it keeps its status (available, placed at the gig), with the details and `maintenance_pending_gig_id`. Out follows the Locations rule (`src/utils/locations.ts`): a **unit** is where its newest row is, across gigs and kits (`unit_out_at`), so it's out unless that row is a return, and its pending gig is where it really is; a **lot** is out at that gig while any of its (gig, kit) buckets there has a newest row that isn't a return (`lot_pieces_out`, as `bucketsAt`). It goes into Maintenance, as above, when a return row (`In Warehouse`) brings it home (trigger `inventory_tracking_maintenance_on_return`: the phone's Unload, the web packing list, a manual move home, a write-off's closing row): a unit once its newest row is that return, wherever; a lot once no bucket of it at its flagged gig is open. Or when its pending gig is deleted (trigger `assets_maintenance_gig_gone`). A partial return of a lot, or one kit of two back, leaves the flag waiting. Flagged after the return already synced, it goes in at once.
  - **Adding to a lot's waiting flag** (Cameron, 10-22). More pieces of a flagged lot, flagged at the same gig, add to `maintenance_pending_quantity`, up to the whole lot (then the flag covers the whole record and the quantity goes back to null). Notes, location and expected back keep their values unless new non-empty ones are given. Logged as `asset.maintenance_flagged` with the pieces added and the gig. Any other send of a flagged record is refused: a lot from a different gig or without one, and any unit.
  - **Without a gig**, a unit must be home. A lot's count at home is the Locations rule's (`currentRows` also merges a lot's container places and drops stale ones), which the screens apply; the database only keeps a send within the lot.
  - **A flag leaves with the record.** A flagged record that becomes Disposed, Returned or Missing, or gets a retired date, loses its flag and details (cleared, not refused, so a disposal or write-off is never blocked); and a flag found on a record no longer in service when it comes home is just cleared.
  - **Edit** (`update_maintenance(p_asset_id, p_notes, p_location, p_expected_back)`): pending or in Maintenance; those three fields only.
  - **Return to service** (`return_to_service(p_asset_id)`): a pending record's flag is cancelled. In Maintenance, it goes back to `status_before_maintenance` (or Active) and the details are cleared; a retired record is refused. A split-off piece merges back into its lot when the lot is still in service (Active or Inactive, not retired, not flagged), of the same organization, item and purchase line, and the piece has no serial or tag; otherwise it returns to service as its own lot. `undo_write_off` merges by the same rule.
  - All three are SECURITY DEFINER with `search_path = public`, for **Staff and above of the equipment's organization** (EXECUTE revoked from PUBLIC and anon). Each writes an `activity_log` entry: `asset.maintenance_flagged`, `asset.sent_to_maintenance`, `asset.maintenance_updated`, `asset.returned_to_service`, `asset.maintenance_cancelled`. A split is logged against the lot, which stays (`split_off` = the piece, `quantity`); a merge too (`merged_from` = the piece). The flagged entry, and the entry when a flag is applied on coming home, carry the gig (`gig_id`).
  - **Status writers.** Maintenance and Missing, in or out, and the maintenance columns are written only by these functions, `update_asset_status`, and the write-off functions (trigger `assets_status_writer_rules`). Inserts may use any status but Missing, Maintenance included (purchases, CSV import, Add Item), without maintenance details. A foreign key clearing its own column (a gig, user or lot deleted) is let through. Other status changes (Active ↔ Inactive, Disposed, Returned) are unchanged. A whole write-off clears the maintenance details and any flag; Undo restores the status the record had.
- `description` is a long text field that can contain Markdown-formatted content
- Assets are owned by a tenant organization via `organization_id` for RLS and filtering
- `purchase_id` links the asset back to its acquisition purchase header
- `item_cost` is the burdened cost (includes pro-rata allocation of tax, shipping, etc.)
- Status changes are recorded in `activity_log` (`event_type = 'asset.status_changed'`) by the application via `log_activity`; the former status-history trigger was dropped in migration 20260615000000
- Deleting an asset fires `trg_cleanup_attachments` (migration 20260831000100)
- RLS is **ENABLED** on this table. Users can view assets for organizations they belong to; Admins/Managers can manage.
- **Transition (#162):** `category`, `manufacturer_model`, `type`, `description` and `insurance_class` now belong to the item. They stay on `assets` until the screens move (#182–#186), and the trigger `assets_a_link_equipment_item` links a record to its item from its model and category (finding or creating it), so writers that don't know about items keep working. Changing a record's model or category moves it to that item; an item set directly is kept if it's the same organization's.

---

### kits

Reusable collections of equipment assets

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (tenant that owns this kit) (NOT NULL) |
| name | TEXT | Kit name (e.g., "Small Lighting Setup", "XLR Cable Kit") (NOT NULL) |
| category | TEXT | Kit category for organization (e.g., "Lighting", "Audio", "Cables") |
| description | TEXT | Kit description (Markdown-formatted, nullable) |
| tags | TEXT[] | Array of tags for categorization and filtering (default '{}') |
| tag_number | TEXT | Physical tag number for identification (nullable) |
| rental_value | DECIMAL(10,2) | Daily/gig rental value for this kit (nullable) |
| is_container | BOOLEAN | Whether this kit represents a physical container (default false, NOT NULL) |
| created_by | UUID | Reference to users.id (informational, NOT NULL) |
| updated_by | UUID | Reference to users.id (informational, NOT NULL) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Kits are owned by a tenant organization via `organization_id` for RLS and filtering
- Tags enable flexible categorization and filtering
- `is_container` distinguishes physical containers (road cases, racks) from logical groupings
- RLS is **ENABLED** on this table. Users can view kits for organizations they belong to; Admins/Managers can manage.

---

### kit_components

Junction table linking a kit to its components — a specific unit or lot (`asset_id`), N × any unit of an item (`equipment_item_id`, since migration 20261014000000), or a nested child kit (hierarchical kits, migration 20260826000000; formerly the asset-only junction table, renamed in that migration).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| kit_id | UUID | Reference to kits.id — the parent kit (NOT NULL) |
| asset_id | UUID | Reference to assets.id (nullable; CASCADE delete) |
| child_kit_id | UUID | Reference to kits.id — a nested kit (nullable; CASCADE delete) |
| equipment_item_id | UUID | Reference to equipment_items.id — N × any unit of this item, N = quantity (nullable; RESTRICT). Must be the kit's organization's item (trigger `kit_components_item_same_org`) |
| quantity | INTEGER | Number of this asset/child kit in the kit (default 1, NOT NULL) |
| notes | TEXT | Notes about this component in the kit context (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- CHECK `kit_components_exactly_one_target`: exactly one of `asset_id` / `equipment_item_id` / `child_kit_id` is set. CHECK `kit_components_no_self_reference`: `child_kit_id <> kit_id`.
- Partial unique indexes `kit_components_kit_asset_key` (kit_id, asset_id) WHERE asset_id IS NOT NULL and `kit_components_kit_childkit_key` (kit_id, child_kit_id) WHERE child_kit_id IS NOT NULL prevent duplicate components; `kit_components_kit_item_key` does the same for item lines.
- Cycles are blocked by the `kit_components_prevent_cycle` BEFORE INSERT/UPDATE trigger (`prevent_kit_hierarchy_cycle` → `kit_would_create_cycle`), raising SQLSTATE 23514.
- Every write fires `kit_components_refresh_cache` (AFTER INSERT/UPDATE/DELETE), which rebuilds `kit_flattened_cache` (units) and `kit_flattened_item_cache` (item lines) for the kit and all its ancestors.
- Quantity allows specifying multiples (e.g., 2 mains, 2 subs); nested quantities multiply through the hierarchy.
- RLS is **ENABLED**. SELECT for members of the parent kit's org; ALL for Admin/Manager of the parent kit's org **and**, when `child_kit_id` is set, Admin/Manager of the child kit's org.

---

### kit_flattened_cache

Write-time-maintained flattened contents of each kit: total quantity of every asset, recursively through nested kits (migration 20260826000000).

| Field | Type | Description |
|-------|------|-------------|
| kit_id | UUID | Reference to kits.id (PK part, NOT NULL, CASCADE delete) |
| asset_id | UUID | Reference to assets.id (PK part, NOT NULL, CASCADE delete) |
| total_quantity | INTEGER | Total quantity of the asset in the kit including nested kits (NOT NULL) |

`kit_flattened_item_cache` (migration 20261014000000) holds the same for "N × any of an item" lines: `kit_id`, `equipment_item_id` (PK together), `total_quantity`, `updated_at`; same RLS. It's a separate table because the readers of `kit_flattened_cache` key on `asset_id`.
| updated_at | TIMESTAMPTZ | When the row was last rebuilt (default now(), NOT NULL) |

**Notes:**
- Primary key (kit_id, asset_id). Maintained only by `refresh_kit_flattened_cache` / `refresh_kit_flattened_cache_cascade` via the `kit_components_refresh_cache` trigger — never written by clients.
- RLS is **ENABLED** with a SELECT-only policy for members of the kit's org; no write policies.

---

### gig_kit_assignments

Junction table linking gigs to assigned kits

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (tenant that owns this assignment) (NOT NULL) |
| gig_id | UUID | Reference to gigs.id (NOT NULL) |
| kit_id | UUID | Reference to kits.id (NOT NULL) |
| notes | TEXT | Notes about kit assignment (nullable) |
| assigned_by | UUID | Reference to users.id (who assigned the kit) (NOT NULL) |
| assigned_at | TIMESTAMPTZ | When the kit was assigned to the gig (NOT NULL) |
| added_at_pack_out | BOOLEAN | The kit was added on the phone at pack-out, not planned (NOT NULL, default false). Migration 20261019000000 |

**Notes:**

- Scoped to organization via `organization_id` for tenant isolation
- Composite unique constraint on (gig_id, kit_id) prevents duplicate kit assignments
- `organization_id` should match the kit's organization_id
- RLS is **ENABLED** on this table. Users can view assignments for accessible gigs; Admins/Managers can manage.
- **Added at pack-out (#185 PR 2, migration 20261019000000).** Staff or above can also add one of their organization's kits to a gig their organization is on, with `added_at_pack_out = true` and `assigned_by` = themselves (`user_is_staff_or_above_of_org`). They can delete only such a row they added themselves, while still Staff or above, to undo a mistaken add. The gig editor updates rows in place, so the flag stays.

---

### inventory_tracking

Tracks equipment check-in/check-out status at gigs.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL) |
| gig_id | UUID | Reference to gigs.id (NOT NULL, CASCADE delete) |
| kit_id | UUID | Reference to kits.id (nullable, SET NULL on delete) |
| asset_id | UUID | Reference to assets.id (nullable, SET NULL on delete) |
| status | TEXT | Tracking status (NOT NULL) |
| scanned_at | TIMESTAMPTZ | When the scan occurred (NOT NULL) |
| scanned_by | UUID | Reference to public.users(id) (nullable, SET NULL on delete; re-pointed from auth.users in migration 20260530000000) |
| quantity | INTEGER | State, not a delta: how many of this unit or lot are at this gig under this kit as of this row. 1 for a unit, N of a lot (default 1, CHECK > 0). Migration 20261014000000 |
| notes | TEXT | Notes about this tracking event (nullable) |
| location | TEXT | Free-text location for the tracking event (nullable; migration 20260529000000) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Composite index on (gig_id, kit_id, asset_id, scanned_at DESC) for efficient lookups.
- **Append-only history.** The unique index from 20260305000000 was dropped in 20260309000000. Every scan or manual move inserts a row. Undo deletes the newest row.
- **Notes (#246, Cameron 10-10).** Saving a note on the phone appends a new row; no row is ever edited. The new row is always written at this gig and carries the item's last status forward unchanged: the newer of its newest row at this gig and kit (status, count, location) and its last record at any gig (a unit's newest row, or a container's own newest row; status and location), or, with neither, `In Warehouse`. So a unit out at another gig keeps that status, and where the unit is never blocks a note or Send to Maintenance. A note on a whole kit (container or not) is exactly one kit-level row (`asset_id` null) and nothing else: never a cascade, and no rows for its units or lots. On the phone, a unit or lot line reads only its own rows, never its kit's: a kit scan always writes a row for every unit and lot it covers, so a kit-level row is never a scan of a line. The packing list keeps each unit's and container's last record as `last_records` (gig and its name, status, location, notes, who, when). The note popup shows that last record (or the row here, if newer): when, who, status / location, the gig, and its notes when not blank. Ticking **Send to Maintenance** adds "Sent to Maintenance." to the end of the note in that same row, then sets the status through `update_asset_status` (Staff or above), which since migration 20261022000000 sends the whole record through `send_to_maintenance`; unticking sets it back to Active and adds nothing (the phone's own Maintenance step is #186 step 3). "Scanned by" shows a name: the row's, the signed-in person's, or the organization's members', else "Unknown".
- **Reading it (`src/utils/locations.ts`, #186).** The newest row wins, ordered by scanned_at, then created_at, then id. Times are compared as instants.
  - A unit is where its newest row says.
  - A lot's count at a gig is the sum, over kits, of the newest row per (gig_id, kit_id, asset_id). A no-kit manual move is its own bucket.
  - Pieces stay at a gig until a row with status `In Warehouse` returns them. The rest are at home.
  - `bucketsAt(rows, record, gig)` lists what is still out at one gig, kit by kit. The gig's "Not returned" list uses it.
- **Writing it (#185):**
  - **A return goes in the bucket the pieces went out in.** It is written under the same (gig, kit). A no-kit `In Warehouse` row doesn't close a kit's bucket. A lot out under two kits needs two return rows.
  - **A partial return** ("leave the rest at the gig") is one non-return row in the bucket: status `Not Returned`, with quantity = what is still out. It is never a return row with a smaller N, because a return closes the whole bucket. Example: 4 out under FOH and 3 back gives FOH `Not Returned` q=1, so the gig shows 1 and home shows lot − 1.
  - **Moving a lot to another gig** writes a return row in each of the first gig's buckets, then the row at the new gig. Otherwise the lot counts at both. A unit doesn't need this: it is wherever its newest row says.
  - **Move N of the M (Manual Tracking Override, #186; fixes #160)** writes by the same rules (`moveLotPieces`):
    - **N of M home:** the bucket's own row at M − N, with its status and place. All M home is a return row, which closes the bucket.
    - **To another gig:** this bucket keeps M − N (or closes when it's all of it), and the target bucket becomes what it holds plus N.
      - "What it holds" counts only if that bucket is one of the lot's current places (`currentRows`). A stale older row there counts 0; for a lot in a container, an older row at another gig is always stale.
      - The result is never more than the lot.
      - A bucket closed this way gets a return row with no location: the pieces didn't go home. The target row is written 1 ms later, so it reads as the newer of the two.
    - **From home:** only the target bucket changes, and no more than the pieces at home go. With none at home, nothing is written ("None of this lot is at home to move.").
    - **Part of a lot in a case (container kit) to another gig than the case's own newest row** is allowed, with a warning before the Move button: "These N leave <case>. The case stays at <case's gig>." (Cameron, 10-12). Those pieces are written loose (no kit) at the new gig; the rest stay in the case's bucket. Moving them home, or to the case's own gig, keeps them in the case.
    - **A new status at the same gig** applies to the whole bucket. "Mark for Maintenance" is one of these: the pieces stay at the gig, in Maintenance.
    - Moves between two home places (with no gig) aren't possible yet; they come with the Maintenance step.
  - **Where an item is (#186, Cameron 10-11):** `whereabouts` sums each place's pieces across the item's units and lots. This is used by the Locations "where is it" card and the Item page's "Where they are".
    - It follows the Locations rule (`currentRows`), so it agrees with the Locations lines. A lot in a container is one place per container.
    - A lot's pieces at its current places come from `lotPieces`: newest place first, each holding no more than the lot has left; the rest are home. The Locations lot lines use the same counts, so a home line reads the lot less what's out.
    - Home pieces go to the lot's current return rows newest first, each up to what it brought back, so a lot home in two cases reads each case's pieces. A return holding none isn't shown.
    - **Stale places (`currentRows`, 10-11; reworked 10-12):** an out place is stale when, after it, the lot's other places held so many pieces at once that with it they'd be more than the lot. Returns hold no pieces for this check, so a bucket closed by Move N doesn't make an older place elsewhere stale (1 at the festival, 4 moved from A to B: festival 1, B 4, home 1), while a one-piece lot that went out again on a newer gig still drops its older place.
    - Pieces at home are "Not checked out".
    - When everything in a record came back on a return scan, they're at that scan's location instead.
    - Locations headers count pieces, and a lot line reads "2 of 10".
  - **Home has no location** until every bucket of the lot is closed by a return. Home takes the newest return row's status and location.
- **Writing off missing pieces** (`write_off_pieces` / `undo_write_off`, migration 20261018000000):
  - A whole unit or lot becomes `status = 'Missing'`, with `retired_on` = the caller's day (`p_on`, within a day of the server's date).
  - Part of a lot is split off into its own Missing record with the lot's values, on the lot's purchase line, and the lot's quantity drops. The bucket gets a closing row: `In Warehouse` at the Warehouse, or `Not Returned` with what is still out (at most what the lot has left).
  - Quantities are whole pieces.
  - **Write-off provenance is stored on the record.** `assets.written_off_from` is the lot a split-off piece came from, and `assets.status_before_write_off` is the status it had. Only `write_off_pieces` sets them.
  - Undo merges a split-off piece back into its lot when the lot is still on hand, of the same organization, item and purchase line; the piece's tracking rows go with it. Otherwise the record comes back as itself, with its earlier status. A record with a serial or tag is never merged away. Undo is refused once the write-off's tax year is locked.
  - Only Admins and Managers can write off or undo. Both write an `activity_log` entry: `asset.written_off` / `asset.write_off_undone`.
  - **In the app** (#242): the gig's Not returned list asks for confirmation before writing off (naming the pieces and the tax-year effect). The activity log context is `quantity`, `kit_id`, `note`, `split_from` (write-off) and `quantity`, `merged_from` (undo), with no gig title or model; the entries are labelled "Equipment Written Off" and "Write-off Undone" in `activityLog.events.ts`. A Missing record's status, Retired On and disposal amount are read-only on the equipment form and never part of its save payload. The locked-year refusal from `undo_write_off` ("...Record the equipment as found instead.") is replaced in `undoWriteOff` by the app's wording (`src/utils/writeOffMessages.ts`), since there is no "found" action.
- **Data integrity.** A tracking row's `asset_id` and `kit_id`, when set, belong to the row's `organization_id`. This is checked in the write policy.
- **Quantities on the phone (#185 PR 2):**
  - A kit scan writes each line's quantity, multiplied through nested kits. A container writes its flattened totals.
  - A lot line is counted, not ticked. The counter starts at what the kit holds from an earlier step (on Unload, what went out), or at the full line. Fewer leaves the line short.
  - The same lot or "any" item under two sub-kits of one kit is one line of the sum, as on the web packing list; a tracked unit, and anything sealed in a container, stays once.
  - An "any" line fills from what its kit already holds of the item, then from lots at home: the most at home first, ties to the older lot (`pickLots`). One row per lot, saying the lot's new count in that kit. Tagged units are never picked; scanning one fills a slot. Unload never picks from home.
  - Fewer back on Unload asks: **Leave at the gig** writes the partial-return row above, and **Mark missing** calls `write_off_pieces` (online, Admin or Manager). **Finish unload** does the same for everything still out; a container is left as one sealed unit.
  - A unit not on the list can only be **added to the gig** on its own (a no-kit row, below). There is no swap (Cameron, 10-10): nothing is ever written for a listed unit the operator didn't act on. Interchangeable gear belongs in kits as "any" lines. Rows under a kit for a unit not on its list (extras, from before) still show as "Extra".
  - Pack-Out asks before packing a unit or lot in Maintenance or Inactive, or a unit still out at another gig.
  - Pack-Out and Load Truck also ask before recording a container (case) whose own newest record is still out at another gig: "Mic Case is still out at Friday Show (On Site, Oct 10)." (#265). Pack anyway records it at this gig; the warning only informs.
  - Adding something that's already on the gig never adds it again: "+ Add" marks kits and records already on the gig. A kit on the gig can't be picked, and adding one queues nothing. Picking a unit or lot that's on the gig scans it there, the same as its tag. A lot line in a kit, whether its tag is scanned or it is picked in "+ Add", opens its counter, as the list does.
- **Added at pack-out (#185 PR 2).** In Pack-Out and Load Truck, Staff or above can add what isn't on the gig, by scanning any kit, unit or lot tag the organization owns (looked up in an offline index of the organization's kits and equipment in service) or by "+ Add" search.
  - A kit becomes a `gig_kit_assignments` row with `added_at_pack_out = true`; its adder can remove it again while packing. Removing it deletes every row it wrote at the gig, in every mode, once the removal itself has gone through; a refused removal keeps them. Added offline, its contents load once the add has synced; until then the phone keeps it listed and says so.
  - A unit or lot (with a count) added on its own is a **no-kit row** (`kit_id` null). Its newest no-kit row per record says how many are at the gig. Un-checking it deletes that row.
  - From then on, in every mode, what was added is scanned like anything on the list: by the gig's own rows, under their kit (or none) and with their count. Extras too.
  - Both are listed under "Added at pack-out" on the phone and the packing list, and count in the gig's equipment checks (see conflict-detection.md). Online, the phone runs those checks first and says what the addition would newly double-book or leave short, with "Pack anyway".
- RLS is **ENABLED** on this table. Users with gig access can manage inventory tracking.

---

## Google Calendar Integration Tables

### user_google_calendar_settings

Stores user OAuth tokens and calendar preferences for Google Calendar integration.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Reference to users.id (NOT NULL, CASCADE delete) |
| calendar_id | TEXT | Google Calendar ID (NOT NULL) |
| calendar_name | TEXT | Display name of the calendar (nullable) |
| access_token | TEXT | Encrypted OAuth access token (NOT NULL) |
| refresh_token | TEXT | Encrypted OAuth refresh token (NOT NULL) |
| token_expires_at | TIMESTAMPTZ | Token expiration timestamp (NOT NULL) |
| is_enabled | BOOLEAN | Whether sync is enabled (default true, NOT NULL) |
| sync_filters | JSONB | Optional filters for status, organization, etc. (default '{}') |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Unique constraint on (user_id) — one calendar integration per user (replaced the former (user_id, calendar_id) constraint in migration 20260528000000).
- RLS is **ENABLED**. Users can only access their own calendar settings.

---

### gig_sync_status

Tracks sync status of gigs to Google Calendar per user.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| gig_id | UUID | Reference to gigs.id (NOT NULL, CASCADE delete) |
| user_id | UUID | Reference to users.id (NOT NULL, CASCADE delete) |
| google_event_id | TEXT | Google Calendar event ID (nullable) |
| last_synced_at | TIMESTAMPTZ | Last successful sync timestamp (nullable) |
| sync_status | sync_status | Enum: `pending`, `synced`, `failed`, `updated`, `removed` (default 'pending', NOT NULL) |
| sync_error | TEXT | Error message from last failed sync (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |
| updated_at | TIMESTAMPTZ | Record last update timestamp (NOT NULL) |

**Notes:**
- Unique constraint on (gig_id, user_id) — one sync record per gig per user.
- RLS is **ENABLED**. Users can manage their own sync records; read access extends to gigs the user participates in.
- Uses the `sync_status` enum type.

---

## Operational Tables

### ai_scan_usage

Usage log for the `ai-scan` edge function, used for per-user rate limiting (60 scans/hour since 10-02; it was 20).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | The user who requested the scan (NOT NULL) |
| organization_id | UUID | The organization the scan was for (NOT NULL) |
| created_at | TIMESTAMPTZ | Scan timestamp (NOT NULL) |

**Notes:**
- RLS is **ENABLED with no policies** — only the edge function's service-role client can read or write.
- Not a long-term audit log: the edge function opportunistically deletes rows older than 24 hours.
- Indexed on (user_id, created_at) (`idx_ai_scan_usage_user_time`) for the trailing-hour quota query.
- No foreign keys on `user_id` / `organization_id` (migration 20260612000001).

---

### tax_years

Filed tax years, per organization (migration 20261006000000, #133). Purchases dated in a locked year keep their tax fields.

| Field | Type | Description |
|-------|------|-------------|
| organization_id | UUID | Reference to organizations.id (PK part, ON DELETE CASCADE) |
| year | SMALLINT | The tax year (PK part, 2000–2100) |
| locked | BOOLEAN | Default true; false re-opens the year |
| filed_on | DATE | When the return was filed (nullable) |
| notes | TEXT | (nullable) |
| created_at / updated_at | TIMESTAMPTZ | |

**Notes:** RLS enabled — Admins and Managers of the org read; only its Admins insert, update or delete. Enforcement is the `purchases_c_tax_year_lock` trigger on `purchases`, via `tax_year_is_locked(org, date)`; see [financials.md](financials.md) §2.5.

---

### expense_categories

Expense categories per organization (migration 20261008000000, made per organization by 20261010000000, #125). Rows with `organization_id` NULL are the starter set.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Owning organization (ON DELETE CASCADE); NULL = starter set |
| name | TEXT | Unique per organization (case-insensitive). Expensed purchase lines store this in `purchases.category` |
| schedule_c_line | TEXT | FK to `schedule_c_lines.code`; NULL = not deducted |
| sort_order | SMALLINT | Display order |
| active | BOOLEAN | Default true; inactive ones are hidden from pickers |
| created_at | TIMESTAMPTZ | |

**Notes:** RLS — the organization's Admins and Managers read, its Admins write; starter rows are read and written only by platform moderators. `ensure_org_categories(org)` copies the starter set into an organization on first use. See [financials.md](financials.md) §6.

---

### equipment_categories

Equipment categories per organization (migration 20261010000000). Rows with `organization_id` NULL are the starter set.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Owning organization (ON DELETE CASCADE); NULL = starter set |
| name | TEXT | Unique per organization (case-insensitive). Assets store this in `assets.category` |
| default_recovery_period | SMALLINT | 5, 7 or 15: the recovery period depreciated equipment in this category gets; NULL = ask (migration 20261013000000) |
| sort_order | SMALLINT | Display order |
| active | BOOLEAN | Default true |
| created_at | TIMESTAMPTZ | |

**Notes:** RLS — the organization's members read, its Admins write; starter rows are platform moderators only.

---

### schedule_c_lines

IRS Schedule C lines an expense category can be filed on (migration 20261010000000): the Part II expense lines, and line 4, cost of goods sold (Part III; migration 20261027000000, #321). Columns: `code` (PK, e.g. `4`, `22`, `24a`, `27b`), `label`, `sort_order`. Read-only for signed-in users; changed by migration.

---

### purchase_scan_queue

Invoices waiting to be scanned or reviewed on Financials → Purchases → Scan invoices (migration `20261002000000`). Each row is one uploaded invoice file; the row is deleted once its purchase is saved or the invoice is discarded.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Owning organization (NOT NULL, cascades on delete) |
| attachment_id | UUID | The uploaded invoice file in `attachments` (NOT NULL, cascades on delete) |
| file_name | TEXT | Original file name (NOT NULL) |
| status | TEXT | `queued`, `scanning`, `ready` or `failed` (NOT NULL, default `queued`) |
| scanned_data | JSONB | What the scan read: vendor, date, totals, line items |
| error | TEXT | Why the scan failed |
| created_by | UUID | Defaults to `auth.uid()` |
| created_at / updated_at | TIMESTAMPTZ | `updated_at` maintained by trigger |

**Notes:**
- RLS: the organization's Admins and Managers only, for every operation, as with `purchases`. A row's `attachment_id` must belong to the same organization.
- The `ai-scan` edge function, called with `{ queue_item_id }`, claims a row (`queued`/`failed`, or `scanning` for over five minutes), reads its file from storage, and writes the result back.
- Discarding an invoice deletes its attachment, which deletes the row. Saving a purchase links the attachment to the purchase and deletes the row.

---

### activity_log

Unified, append-only activity/audit log for gigs, assets and other entities (migration 20260615000000). Replaced the former per-entity gig and asset status-history tables, whose rows were migrated in with `context_version = 1` and `'[Historical Record]'` placeholders.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id — the org the event is scoped to (nullable, SET NULL on delete) |
| actor_id | UUID | Reference to users.id — who performed the action (nullable, SET NULL on delete) |
| event_type | TEXT | Dotted event name, e.g. `gig.status_changed`, `asset.status_changed` (NOT NULL) |
| entity_type | TEXT | Kind of entity the event is about, e.g. `gig`, `asset` (NOT NULL) |
| entity_id | UUID | ID of that entity — polymorphic, no FK (NOT NULL) |
| gig_id | UUID | Reference to gigs.id when the event is gig-scoped (nullable, CASCADE delete) |
| context | JSONB | Denormalised display context (actor name, titles, from/to status, …) (default '{}', NOT NULL) |
| occurred_at | TIMESTAMPTZ | When the event happened (default NOW(), NOT NULL) |

**Notes:**
- Written only through the SECURITY DEFINER `log_activity(p_organization_id, p_event_type, p_entity_type, p_entity_id, p_gig_id, p_context)` RPC, which sets `actor_id = auth.uid()` and checks gig access (or org membership when `p_gig_id` is NULL). There are no INSERT/UPDATE/DELETE policies.
- RLS is **ENABLED**. Two SELECT policies: gig-scoped rows (`gig_id` set) are visible to anyone with `user_has_access_to_gig`; non-gig rows are visible to members of `organization_id`.
- Event type catalogue lives in `src/utils/activityLog.events.ts`.

---

### access_requests

Viewer/Staff → Manager/Admin elevation requests (migration 20260908000000). Routed to platform moderators while the target org is unclaimed, and to the org's own Admins once it is claimed.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | Reference to organizations.id (NOT NULL, CASCADE delete) |
| requester_id | UUID | Reference to users.id (NOT NULL, CASCADE delete) |
| requested_role | user_role | Role requested — CHECK limits to `Manager` or `Admin` (NOT NULL) |
| message | TEXT | Requester's message (nullable) |
| status | TEXT | `pending`, `approved`, or `rejected` (CHECK; default 'pending', NOT NULL) |
| handled_by | UUID | Reference to users.id — who approved/rejected (nullable) |
| handled_at | TIMESTAMPTZ | When it was handled (nullable) |
| response_message | TEXT | Handler's response (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- `requester_seen_at` existed originally but was dropped in migration 20260916000000 (outcome notices now come from `notifications`).
- Partial unique index `access_requests_one_pending_per_requester` on (organization_id, requester_id) WHERE `status = 'pending'`; plus indexes `access_requests_org_status_idx` (organization_id, status) and `access_requests_requester_idx` (requester_id, status).
- All app reads/writes go through the `server` edge function (service role). RLS is **ENABLED** with SELECT-only policies as a backstop / for realtime: requester sees own requests; org Admins see their org's requests; platform moderators see requests for unclaimed orgs. `authenticated` is granted SELECT only.

---

### notifications

Generic per-user notification feed read by the NotificationBell (migration 20260916000000). Domain tables such as `access_requests` remain the durable record; this is the one-shot "something happened" side-channel.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| recipient_id | UUID | Reference to users.id (NOT NULL, CASCADE delete) |
| type | TEXT | Notification type, e.g. `access_request.outcome`, `invitation.accepted` (NOT NULL) |
| payload | JSONB | Type-specific data (default '{}', NOT NULL) |
| read_at | TIMESTAMPTZ | When the recipient marked it read (nullable) |
| created_at | TIMESTAMPTZ | Record creation timestamp (NOT NULL) |

**Notes:**
- Partial index `notifications_recipient_unread_idx` on (recipient_id) WHERE `read_at IS NULL`.
- Inserted by the service-role edge function, and by `convert_pending_user_to_active` (one `invitation.accepted` row per accepted invitation, to its inviter).
- RLS is **ENABLED**: recipients can SELECT and UPDATE (mark read) their own rows; `authenticated` is granted SELECT, UPDATE only.

---

### Scheduled jobs

Migration 20260919000000 enables the `pg_cron` and `pg_net` extensions and schedules the `daily-health-check` cron job (13:00 UTC daily), which POSTs to the health-check edge function. The URL and bearer token are read at call time from Supabase Vault secrets `health_check_function_url` and `health_check_cron_secret` (one-time per-project setup — see [deployment.md](deployment.md)). No tables are added.

---

## Common Notes

- Each first-class entity owned by the tenant has `organization_id` for RLS and filtering
- All Notes and Description fields store Markdown-formatted text
- The `created_by` and `updated_by` fields throughout the schema store User.id values but don't maintain reverse relations (they're informational only)

---

## Helper Functions & Triggers

The database includes several helper functions and triggers to manage data integrity and security.

### Helper Functions
These functions are defined with `SECURITY DEFINER` to bypass RLS when necessary (e.g., checking organization membership without causing infinite recursion).

- `user_is_member_of_org(org_id, user_uuid)`: Returns true if the user is a member of the specified organization.
- `user_is_admin_of_org(org_id, user_uuid)`: Returns true if the user is an Admin of the specified organization.
- `user_is_admin_or_manager_of_org(org_id, user_uuid)`: Returns true if the user is an Admin or Manager of the specified organization.
- `user_organization_ids(user_uuid)`: Returns a table of organization IDs the user belongs to.
- `user_has_access_to_gig(gig_id, user_uuid)`: Returns true if the user belongs to any organization participating in the gig.
- `user_can_manage_gig(gig_id, user_uuid)`: Returns true if the user is Admin or Manager in a participating organization.
- `user_is_admin_of_gig(gig_id, user_uuid)`: Returns true if the user is Admin in a participating organization.
- `get_user_email(user_uuid)`: Returns the email address from `auth.users`.
- `get_user_ids_in_same_orgs(user_uuid)`: Returns all user IDs that share an organization with the given user.
- `get_user_role_in_org(org_id, user_uuid)`: Returns the user's role in the specified organization.
- `get_complete_user_data(user_uuid)`: Returns user profile and organization memberships as JSONB.
- `get_user_profile_secure(user_uuid)`: Returns user profile row securely.
- `get_user_organizations_secure(user_uuid)`: Returns user's organization memberships securely.
- `search_people(p_query, p_email, p_phone)`: System-wide search for an existing person before adding a new one (#178). Every word of `p_query` must match the name, in any order, with one typo forgiven per word (two in words of 7+ letters); `p_email` matches as typed; `p_phone` matches ignoring formatting (last 10 digits, or 7 for a local number). Any one match is enough; inactive people are left out. Returns only `id`, `first_name`, `last_name`, `email_hint` (masked, e.g. `j***@crew.example`), `organization_names` and `matched_on`. Signed-in callers only.
- `search_organizations(p_query, p_type)`: The same word matching for organization names, optionally by type. Runs as the caller.
- `search_name_rank(p_name, p_query)`: Helper for both: 0 = every word is part of the name, 1 = a typo was forgiven, NULL = no match.
- `convert_pending_user_to_active(p_email, p_auth_user_id)`: Converts a pending user to active on first login.
- `invite_user_to_organization(...)`: Creates an invitation and pending user record.
- `create_gig_complex(p_gig_data, p_participants, p_staff_slots)`: Transactionally creates a gig with participants and staff slots. Since migration 20260613000000 it requires `p_gig_data.primary_organization_id` and that the caller is Admin/Manager of that org; it is the only gig-creation path (no gigs INSERT policy).
- `create_purchase_transaction_v2(p_header, p_items, p_units)`: Transactionally creates a purchase header, its lines, and each tracked line's units or lot (`line_index` names the line). Replaced `create_purchase_transaction_v1`, which was dropped by 20261025000000 (#317).
- `reclassify_expense_as_asset(p_purchase_item_id)`: Retired (dropped by migration 20261011000000, which also dropped `purchases.sub_category` and `assets.sub_category`).
- `update_asset_status(p_asset_id, p_status)`: Updates asset status. **Equipment status changes take Staff or above** (migration 20261019000000): Admins, Managers and Staff of the asset's org can move it between Active, Maintenance and Inactive; a Viewer can't change it (the app hides the controls). A status must be one of the known statuses (Active, Inactive, Maintenance, Disposed, Returned). **Status changes into or out of retired statuses follow the write-off rules:** Disposed and Returned, in or out, take an Admin or Manager; Missing is set only by `write_off_pieces` and left only by `undo_write_off`. **Maintenance** (migration 20261022000000): to Maintenance sends the whole record through the same rules (no gig, wherever its pieces are); out of Maintenance clears its details without merging a split-off piece; Active or Inactive on a flagged record cancels the flag; Disposed or Returned clears it. The phone drops a queued status change the database refuses as not allowed (42501) or not possible for the record as it is (22023), with a message.
- `user_is_admin(user_uuid)`: Returns true if the user is Admin of **at least one** organization (not a global admin; migration 20260522000000).
- `user_can_manage_org_contacts(p_organization_id, p_user_id)`: True if the user is `user_is_admin`, Admin/Manager of the org, or Admin/Manager of an org sharing a gig with it. Gates all contact RPCs and the broadened member/user read policies.
- `user_is_contact_status(p_user_id)`: True if the user's `user_status = 'contact'` (breaks RLS recursion between `users` and `organization_members`).
- Organization-contact RPCs: `add_organization_contact`, `link_existing_person_to_organization`, `update_organization_contact`, `set_organization_primary_contact`, `unset_organization_primary_contact`, `remove_organization_contact`.
- Gig-contact RPCs: `create_contact_person`, `add_gig_participant_contact`, `set_gig_participant_contact_primary`, `remove_gig_participant_contact` (the only write path for `gig_participant_contacts`).
- `log_activity(p_organization_id, p_event_type, p_entity_type, p_entity_id, p_gig_id, p_context)`: The app's write path for `activity_log`; returns the new row id. (The #175 triggers `gig_participants_log_removed` and `gig_participants_log_inactive` also write participant entries directly.)
- `kit_would_create_cycle(p_parent_kit_id, p_child_kit_id)`: True if nesting the child kit under the parent would create a cycle.
- `kits_that_would_cycle(p_parent_kit_id, p_candidate_kit_ids)`: Batch form of the above for the kit picker (migration 20260826230000).
- `get_kit_hierarchy_tree(p_kit_id)`: Returns (parent_kit_id, child_kit_id, quantity, depth) rows for a kit's nested structure; requires org membership.
- `refresh_kit_flattened_cache(p_kit_id)` / `refresh_kit_flattened_cache_cascade(p_kit_id)`: Rebuild `kit_flattened_cache` for a kit (and, for the cascade form, all its ancestor kits).

### Triggers
- `update_updated_at_column()`: Automatically updates the `updated_at` column to `NOW()` before an UPDATE. Applied to: users, organizations, gigs, gig_financials, gig_staff_slots, gig_sync_status, kits, staff_roles, user_google_calendar_settings, purchases. (Not applied to `gig_schedule_entries`.)
- `kit_components_prevent_cycle` → `prevent_kit_hierarchy_cycle()`: BEFORE INSERT/UPDATE on `kit_components` when `child_kit_id` is set; rejects circular nesting.
- `kit_components_refresh_cache` → `trigger_refresh_kit_flattened_cache()`: AFTER INSERT/UPDATE/DELETE on `kit_components`; refreshes `kit_flattened_cache` for the kit and its ancestors.
- `trg_cleanup_attachments` → `cleanup_orphaned_attachments(entity_type)`: BEFORE DELETE on `assets`, `gigs`, `purchases`, and `gig_financials`; removes the row's `entity_attachments` links and any `attachments` rows linked only to it (migration 20260831000100). Does not delete storage objects.
- The former gig and asset status-history triggers were dropped in migration 20260615000000; status changes are now logged by the app via `log_activity`.

---

## Indexes

To optimize performance, the following indexes are implemented:

### Core Tables
- `idx_users_status`: On `users(user_status)`
- `idx_users_email`: On `users(email)` where `user_status = 'pending'`
- `idx_users_timezone`: On `users(timezone)`
- `idx_org_members_org_id`: On `organization_members(organization_id)`
- `idx_org_members_user_id`: On `organization_members(user_id)`
- `idx_org_members_default_staff_role`: On `organization_members(default_staff_role_id)`
- `idx_invitations_organization`: On `invitations(organization_id)`
- `idx_invitations_email`: On `invitations(email)`
- `idx_invitations_token`: On `invitations(token)`
- `idx_invitations_status`: On `invitations(status)`
- `organization_members_one_primary_contact_per_org`: Unique on `organization_members(organization_id)` WHERE `is_primary_contact`
- `access_requests_org_status_idx`: On `access_requests(organization_id, status)`
- `access_requests_requester_idx`: On `access_requests(requester_id, status)`
- `access_requests_one_pending_per_requester`: Unique on `access_requests(organization_id, requester_id)` WHERE `status = 'pending'`
- `notifications_recipient_unread_idx`: On `notifications(recipient_id)` WHERE `read_at IS NULL`

### Gigs & Staffing
- `idx_gigs_start`: On `gigs(start)`
- `idx_gigs_parent_gig_id`: On `gigs(parent_gig_id)`
- `idx_gig_participants_gig_id`: On `gig_participants(gig_id)`
- `idx_gig_participants_org_id`: On `gig_participants(organization_id)`
- `gig_participant_contacts_one_primary_per_gig_org`: Unique on `gig_participant_contacts(gig_id, organization_id)` WHERE `is_primary_contact`
- `idx_gig_participant_contacts_gig_org`: On `gig_participant_contacts(gig_id, organization_id)`
- `idx_schedule_entries_gig`: On `gig_schedule_entries(gig_id)`
- `idx_schedule_entries_act`: On `gig_schedule_entries(act_participant_id)`
- `idx_gig_staff_slots_gig_id`: On `gig_staff_slots(gig_id)`
- `idx_gig_staff_slots_role_id`: On `gig_staff_slots(staff_role_id)`
- `idx_gig_staff_slots_org_id`: On `gig_staff_slots(organization_id)`
- `idx_gig_staff_assignments_slot_id`: On `gig_staff_assignments(slot_id)`
- `idx_gig_staff_assignments_user_id`: On `gig_staff_assignments(user_id)`
- `idx_staff_roles_name`: On `staff_roles(name)`

### Financials
- `idx_gig_financials_gig_id`: On `gig_financials(gig_id)`
- `idx_gig_financials_org_id`: On `gig_financials(organization_id)`

### Equipment & Inventory
- `idx_assets_org_id`: On `assets(organization_id)`
- `idx_assets_category`: On `assets(category)`
- `idx_kits_org_id`: On `kits(organization_id)`
- `idx_kits_category`: On `kits(category)`
- `idx_kit_assets_kit_id`: On `kit_components(kit_id)` (index kept its pre-rename name)
- `idx_kit_assets_asset_id`: On `kit_components(asset_id)` (index kept its pre-rename name)
- `idx_kit_components_child_kit_id`: On `kit_components(child_kit_id)` WHERE `child_kit_id IS NOT NULL`
- `kit_components_kit_asset_key`: Unique on `kit_components(kit_id, asset_id)` WHERE `asset_id IS NOT NULL`
- `kit_components_kit_childkit_key`: Unique on `kit_components(kit_id, child_kit_id)` WHERE `child_kit_id IS NOT NULL`
- `idx_kit_flattened_cache_asset_id`: On `kit_flattened_cache(asset_id)`
- `idx_gig_kit_assignments_org_id`: On `gig_kit_assignments(organization_id)`
- `idx_gig_kit_assignments_gig_id`: On `gig_kit_assignments(gig_id)`
- `idx_gig_kit_assignments_kit_id`: On `gig_kit_assignments(kit_id)`
- `inventory_tracking_lookup_idx`: Composite on `inventory_tracking(gig_id, kit_id, asset_id, scanned_at DESC)`

### Google Calendar Integration
- `idx_user_google_calendar_settings_user_id`: On `user_google_calendar_settings(user_id)`
- `idx_gig_sync_status_gig_id`: On `gig_sync_status(gig_id)`
- `idx_gig_sync_status_user_id`: On `gig_sync_status(user_id)`
- `idx_gig_sync_status_sync_status`: On `gig_sync_status(sync_status)`

### Operational
- `idx_ai_scan_usage_user_time`: On `ai_scan_usage(user_id, created_at)`
- `idx_activity_log_gig_id`: On `activity_log(gig_id, occurred_at DESC)`
- `idx_activity_log_entity`: On `activity_log(entity_type, entity_id, occurred_at DESC)`
- `idx_activity_log_org_id`: On `activity_log(organization_id, occurred_at DESC)`
- `idx_activity_log_actor_id`: On `activity_log(actor_id, occurred_at DESC)`

---

## Row-Level Security (RLS)

All tables have RLS **ENABLED**. Access is controlled through a combination of RLS policies and helper functions.

### RLS Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | Own profile + same-org members + users of orgs you can manage contacts for + gig participant contacts on accessible gigs | Own record (auth) | Own record | — |
| `organizations` | All (public) | Authenticated | Admin of this org; any org's Admin only while `claimed = false` | — |
| `organization_members` | Own orgs + orgs you can manage contacts for | Self-join as Viewer; Admin manages | Admin only | Admin only |
| `invitations` | Own org members | Admin/Manager | Admin/Manager + invitee accept | Admin/Manager |
| `user_devices` | Own devices | Own | Own | Own |
| `access_requests` | Own requests; org Admins; platform moderators (unclaimed orgs) | — (service role) | — (service role) | — (service role) |
| `notifications` | Own | — (service role / SECURITY DEFINER) | Own (mark read) | — |
| `gigs` | Participating orgs | — (only via `create_gig_complex`) | Admin/Manager of participant | Admin of participant |
| `gig_participants` | Accessible gigs | Gig managers | Gig managers | Gig managers |
| `gig_participant_contacts` | Accessible gigs | — (RPC only) | — (RPC only) | — (RPC only) |
| `gig_schedule_entries` | Participating org members | Admin/Manager of participant | Admin/Manager of participant | Admin/Manager of participant |
| `activity_log` | Accessible gigs (gig rows); org members (non-gig rows) | — (`log_activity`, and the participant-removal trigger) | — | — |
| `gig_financials` | Admin/Manager of owning org | Admin/Manager of owning org | Admin/Manager of owning org | Admin/Manager of owning org |
| `purchases` | Admin/Manager | Admin/Manager | Admin/Manager | Admin/Manager |
| `attachments` | Org members | Admin/Manager | Admin/Manager | Admin/Manager |
| `entity_attachments` | Via parent attachment org | Admin/Manager (via attachment) | Admin/Manager (via attachment) | Admin/Manager (via attachment) |
| `staff_roles` | All (public) | — | — | — |
| `gig_staff_slots` | Accessible gigs | Gig managers | Gig managers | Gig managers |
| `gig_staff_assignments` | Accessible gigs | Gig managers | Gig managers + own assignments | Gig managers |
| `assets` | Org members | Admin/Manager | Admin/Manager | Admin/Manager |
| `kits` | Org members | Admin/Manager | Admin/Manager | Admin/Manager |
| `kit_components` | Via parent kit org | Admin/Manager of parent kit org (+ child kit org if nested) | Same | Same |
| `kit_flattened_cache` | Via kit org | — (trigger-maintained) | — | — |
| `gig_kit_assignments` | Accessible gigs | Gig managers | Gig managers | Gig managers |
| `inventory_tracking` | Gig access | Gig access | Gig access | Gig access |
| `user_google_calendar_settings` | Own settings | Own | Own | Own |
| `gig_sync_status` | Own + participating gigs | Own | Own | Own |
| `ai_scan_usage` | — (service role only) | — | — | — |
| `purchase_scan_queue` | Admin/Manager | Admin/Manager (own org's file) | Admin/Manager | Admin/Manager |

### Role Hierarchy

1. **Admins** have full control over the tenancy including user management, account settings, and all data.
2. **Managers** can manage (CRUD) all application data like Gigs, Assets, staffing, etc. but cannot manage organization members or user roles. They can view and edit team member profiles. Financials, Assets, Kits are all available.
3. **Staff** can edit their own profile, view all gigs for their organization (excepting the Financials section), accept/decline staff assignments directed at them, view equipment including assets and kits, and view the team.
4. **Viewers** can only edit their own profile and view basic gig information for gigs that their organization participates in.

### Data Isolation

- Gigs are scoped to organizations via `gig_participants`
- Only members see their organization's data
- Participants can be from any organization (public directory)

---

## Authentication

### Supported Methods

**Email/Password:**
- Built-in Supabase authentication
- No additional setup required
- User profile created on first login

**OAuth Providers:**
- Google OAuth (primary)
- GitHub, Microsoft (optional)
- Configured in Supabase Auth settings

### User Flow

1. User authenticates via Supabase Auth
2. `auth.users` entry created automatically
3. App creates `users` profile record
4. User assigned to organization via `organization_members`
5. Session managed by Supabase with auto-refresh

### Session Management

- Automatic token refresh
- Secure logout functionality
- Session state persisted in local storage
- RLS policies enforce user context

---

## Real-Time Features

### Live Updates

The application uses Supabase Realtime (Postgres CDC) for live data synchronization:

**Gigs:**
- Create/update/delete broadcasts to all connected clients
- Status changes appear instantly
- Inline edits synchronized across users

**Assets & Kits:**
- Inventory updates broadcast in real-time
- Assignment conflicts detected immediately

**Staff Assignments:**
- Assignment status changes synchronized
- Notifications triggered on changes

### Implementation

```typescript
// Automatic subscription to gig changes
supabase
  .channel('gigs')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'gigs' },
    (payload) => {
      // Handle insert/update/delete
    }
  )
  .subscribe()
```

---

## Related Documentation

- **Requirements**: See [../product/requirements.md](../product/requirements.md) for feature requirements
- **Workflows**: See [../product/workflows/](../product/workflows/) for UI flows
- **Tech Stack**: See [tech-stack.md](./tech-stack.md) for technology details
- **Setup Guide**: See [setup-guide.md](./setup-guide.md) for installation instructions
- **Coding Guide**: See [../development/coding-guide.md](../development/coding-guide.md) for implementation patterns

---

## Document History

**2026-10-05**: `gig_financials` money in / money out with stages (migration `20261005000000`): new `direction`, `stage`, `amount_settled`; `type` renamed to `legacy_type`; enums `fin_direction`, `fin_stage`; `fin_type` marked legacy.
**2026-09-25**: Reconciled with all migrations through `20260919000000` (first full pass since 2026-03-16). Enum `organization_type` → `organization_role`, `organizations.type` → `roles` (array); `fin_type` typo fixed to `Payment Received` plus `Informal Terms`; `fin_category` listed as IRS Schedule C values; added `schedule_activity_type`. Removed the dropped `gig_status_history` / `asset_status_history` tables and their triggers in favour of the new `activity_log` table and `log_activity` RPC. `kit_assets` → `kit_components` (asset or `child_kit_id`, cycle-prevention trigger) and new `kit_flattened_cache`. Added `gig_schedule_entries`, `gig_participant_contacts`, `access_requests`, `notifications`, and the `pg_cron` daily health-check job. New columns: `users.platform_moderator` / `contact` status / nullable `email`, `organizations.claimed`, `organization_members.is_primary_contact` / `contact_title`, `gig_participants.is_client`, `gig_staff_assignments.completed_at` / `units_completed` / `gig_financial_id`, `inventory_tracking.location`. Updated RLS for `gig_financials` (owning-org Admin/Manager only, 20260912000000), `purchases` (Admin/Manager reads), `gigs` (no INSERT policy), `organizations` (claimed-aware UPDATE), broadened `users` / `organization_members` reads; refreshed helper functions, triggers, indexes, ER diagrams, and the Google Calendar one-setting-per-user constraint.
**2026-03-16**: Major revision — reconciled all tables with `schema_dump.sql`. Added missing tables (`asset_status_history`, `inventory_tracking`, `user_devices`). Added missing columns (`users.timezone`, `kits.is_container`, `purchases.asset_id`). Removed ghost columns from `gigs` (`venue_address`, `settlement_type`, `settlement_amount`). Fixed type mismatches (`assets.quantity` is numeric(12,4), `assets.status` is NOT NULL). Updated `sync_status` enum with `updated`/`removed` values. Updated RLS to reflect all tables now ENABLED. Added `purchases`, `attachments`, `entity_attachments` tables. Added topical ER diagrams for each major section. Moved `invitations` to Core Tables. Removed unused `kv_store_de012ad4`. Updated helper functions list.
**2026-02-24**: Fixed Prisma/schema.sql references, updated PostgreSQL version to 17, added Google Calendar integration tables (`user_google_calendar_settings`, `gig_sync_status`), documented `Payment Recieved` typo as known issue, fixed file structure paths.
**2026-02-09**: Consolidated migrations into a single initialization file, improved local development workflow, and moved troubleshooting content to `setup-guide.md`.
**2026-01-28**: Updated schema details to match `supabase/migrations/`, added missing tables (`invitations`, `kv_store`), documented helper functions, triggers, and indexes, and corrected RLS status for all tables.
**2026-01-18**: Consolidated DATABASE.md and setup/supabase-integration.md into comprehensive database specification with schema details, Supabase integration guidance, and troubleshooting information.
