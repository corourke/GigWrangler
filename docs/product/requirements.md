# GigWrangler Product Requirements

**Purpose**: This document defines the functional requirements, business rules, and high-level features of the GigWrangler application. It focuses on WHAT the system should do and WHY, not HOW it should be implemented.

**Last Updated**: 2026-06-21

**GigWrangler** (gigwrangler.com) is a production and event management platform used by:

- Production companies managing events and performances;
- Sound and lighting companies tracking equipment and staff;
- Event producers coordinating venues, acts, and logistics.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Features](#core-features) — Authentication, Organizations, Gig Management (incl. Multi-Act Scheduling, Financials), Equipment, Dashboard, Import/Export, Notifications, Calendar
3. [Major Functionality Enhancements](#major-functionality-enhancements) — Attachments, Mobile, Receipt Import, CSV Import, Hierarchical Gigs, Data Tables, Expense Management

**Status Key**: ✅ Implemented | 🔄 In Progress | 📋 Planned

---

## Overview

This app streamlines the management of gigs (where an act performs at a venue) for operators of sound and lighting companies, and event producers. By centralizing tools for tracking gear inventory, bids/proposals, personnel, venues, loadouts and documentation such as stage plots, we reduce manual errors, save time on preparation, and ensure efficient operations.

### Target Users

- Primary Users (may plan and manage gigs, bids, staffing and equipment.)
  - Production companies
  - Sound/lighting companies
  - Event producers

- Secondary Users (may participate in gig planning)
  - Venues
  - Acts/Performers
  - Talent agencies
  - Equipment rental companies
  - Staging companies

### Key Features

- **Multi-Organization Collaboration:** The different organizations that participate in an event can all share and collaborate on the same gig, with tenants maintaining their own staffing, equipment, and financial information. 
- **Shared Organizations**: Organization profiles are shared so each tenant doesn't have to create them; users can belong to multiple organizations with role-based access control.
- **Gig Management**: Full lifecycle tracking from Date-Hold to Completed/Paid.
- **Asset Inventory**: Track owned assets, group assets into kits, assign equipment to gigs, reporting on conflicts, handle rentals, and export insurance details.
- **Personnel Management**: Create staffings slots on gigs, assign staff to roles, notify staff automatically, and check for conflicts.
- **Mobile Support**: Offline-first with push notifications and biometric authentication.
- **Calendar Integration**: Syncronize gig dates with Google Calendar.
- **Export/Import:** Easy data export and import to/from spreadsheets.

### Key Benefits

- **Improved Coordination**: Collaborative data management across participants improves communication and reduces mistakes and misunderstandings.
- **Efficiency**: Automates notifications, confirmations, checklists, and tracking.
- **Integrated**: Track dates, equipment inventory, acts, venues, proposals, and staff in one place.
- **Risk Mitigation**: Maintain equipment inventory for insurance purposes and avoid double booking.
- **Purpose-built**: Unlike general event tools, this app specializes in coordinating acts, venues, equipment and supporting services.

### User Experience Principles

#### Design Philosophy

- **Multi-Platform First**: Seamless experience across web browsers, mobile browsers, and native mobile apps
- **Organization-Centric**: All data and workflows are scoped to the user's active organization context
- **Progressive Disclosure**: Show essential information first, with advanced options available as needed
- **Offline-Ready**: Core functionality works without internet connection with automatic sync

#### Interface Design

- **Spreadsheet-like Tables**: Familiar data entry patterns for power users (desktop)
- **Card-based Layouts**: Touch-friendly information consumption (mobile)
- **Contextual Actions**: Right-click menus, swipe actions, and floating action buttons
- **Consistent Navigation**: Global navigation with organization switcher, breadcrumbs, and search
- **Mobile-First Design**: Responsive layouts with touch-optimized controls (see [Mobile Features](#10-mobile-features) for details)

### Definitions

- **Organization**: Any business or group of people that participate in the delivery of a gig.
- **User**: A user is someone who can log into the application, and who may be a member of one or more organizations. A user is assigned an application role for each organization they are a member of.
- **Tenants**: A tenant is an organization with users that are using the application, with a private data scope enforced by RLS.
- All event participants are a type of **organization**: 
  - A **Production Company** matches up clients to a venue and one or more bands for an event. They are the prime contractor for the gig and are responsible for coordinating all resources. Data includes name, contacts (staff), contact and bid history, and various notes.
  - A **Sound/Lighting Company** provides sound reinforcement and lighting equipment, including setup and operations.
  - A **Client** is an individual (perhaps booking a private party) or corporate entity that is distinct from any band or venue. We may interact directly with a client, or the client might work primarily with a production company, band or venue. Data includes company name, contact person(s), payment terms, contract history, and preferences.
  - A **Venue** is a place or business where an event (party, reception, dinner, concert) occurs. Can be a bar or restaurant hiring a band directly or through a production company. Data includes address, contact(s), and various notes such as: hours, capacity, stage dimensions, power availability, acoustics notes, and uploaded photos or floor plans.
  - An **Act** is a solo musician, band of musicians, or other performance act. Data includes act name, members, genre, contact info, rider requirements, and historical notes (e.g., preferred setups or past issues).
  - A **Rental Company** provides supplemental equipment as needed.

---

## Core Features

### 1. Authentication & User Management ✅

#### Authentication & SSO

- **Supabase SSO Support**: All OAuth providers supported by Supabase
- **Email/Password Authentication**: Standard signup with email confirmation
  - Send confirmation email with secure link (email/password signups only)
  - No configurable email confirmation settings

#### User Types & Data Architecture

- **Two User Types**:
  1. **Authenticated Users**: Full Supabase auth.users accounts with complete profiles
  2. **Placeholder Users**: User records without auth.users entries for planning (data-only, no system access)
- **Users Table Linking**: Link users table to supabase auth.users via email column
- **Invitation System**: Uses separate `invitations` table to track invited placeholder users
  - **Secure Token Purpose**: Creates secure, one-time-use URLs for invitation acceptance
  - **Token Security**: Prevents unauthorized access to invitation acceptance

#### User Roles (Hierarchical)

- **Admin**: Full organization access, manages users and settings
- **Manager**: Create/edit gigs, assign personnel, manage assets
- **Staff**: View assigned gigs, limited editing
- **Viewer**: Read-only access

**Permissions Per Role**:

| Feature | Admin | Manager | Staff | Viewer |
|---------|-------|---------|-------|--------|
| Accept / Reject assignments | ✅ | ✅ | ✅ | ✅ |
| Receive Notifications | ✅ | ✅ | ✅ | ✅ |
| View organization's gig details | ✅ | ✅ | Own gigs only | ❌ |
| Create/edit gigs | ✅ | ✅ | ❌ | ❌ |
| Assign staff | ✅ | ✅ | ❌ | ❌ |
| Manage assets | ✅ | ✅ | ❌ | ❌ |
| View and edit gig financials | ✅ | ❌ | ❌ | ❌ |
| Invite users | ✅ | ❌ | ❌ | ❌ |
| Change roles | ✅ | ❌ | ❌ | ❌ |
| Delete data | ✅ | ❌ | ❌ | ❌ |

#### User Profile

- **Required Fields**: first_name, last_name, email
- **Optional Fields**: phone, address (line1, line2, city, state, postal_code, country), avatar_url
- **Auto-Completion**: First-time users complete profile after SSO login
- **Profile Editing**: Users can update their profile anytime

#### Team & Invitation Management

- **Invite by Email**: Admin sends invitation to new user with role assignment
- **Invitation Workflow**: 
  1. Admin enters email and selects role
  2. System creates invitation record with secure token
  3. Email sent with invitation link
  4. User clicks link, signs up/logs in, and joins organization
- **Organization Membership**: Display list of team members with roles
- **Role Changes**: Admin can change user roles
- **Remove Members**: Admin can remove users from organization

---

### 2. Organization Management ✅

#### Organization Data

- **Required**: name, type
- **Optional**: url, phone_number, description, address (line1, line2, city, state, postal_code, country), allowed_domains
- **Relationships**: Organizations can participate in multiple gigs

#### Multi-Tenant Architecture

- **Tenant Isolation**: RLS policies enforce organization_id filtering on all queries
- **Shared Organizations**: Organization profiles shared across tenants (any organization can reference any other organization)
- **Organization Membership**: Users belong to one or more organizations with assigned roles
- **Organization Switcher**: Users can switch between organizations they belong to

#### Organization CRUD

- **Create**: Admin can create organizations for their tenant
- **Read**: View organization details, members, and associated gigs
- **Update**: Admin can edit organization details
- **Delete**: Admin can delete organizations (with dependency checks). Other members must be removed first; the Admin's own membership goes with the organization, so a sole Admin can delete it.

---

### 3. Gig Management ✅

#### Gig Data Model

**Basic Fields**:
- **Required**: title, start (datetime), end (datetime), timezone, status
- **Optional**: notes, tags (array)

**Related Entities**:
- **Participants**: Organizations involved (act, venue, clients, production companies, sound/lighting companies)
- **Staff Slots**: Defined gig roles with optional staff assignments
- **Financials**: Financial transactions related to the gig and possibly to other organizations
- **Kit Assignments**: Equipment packages assigned to gig

#### Gig Participants

- **Purpose**: Track which organizations are involved in a gig
- **Participant Types**: Act, Venue, Client, Production Company, Sound/Lighting Company, Rental Company
- **Multiple Participants**: Gig can have multiple participants of different types

#### Staff Slots & Assignments

- **Staff Slot**: Defined role needed for gig (e.g., "Sound Engineer", "Lighting Tech")
  - Attributes: title, count (how many needed), notes
- **Staff Assignment**: Assignment of specific user to a slot
  - Attributes: user_id, slot_id, status (Invited, Confirmed, Declined)
- **Unassigned Slots**: Slots can exist without assignments (TBD staffing)
- **Conflict Detection**: Warn when assigning acts, venues, staff or equipment to overlapping gigs

#### Financials

- **Purpose**: Track all financial transactions for a gig and calculate gig profitability
- **Single-Ledger Model**: `gig_financials` is the single source of truth. Every financial event — revenue, expense, staff labor — is a row in this table. Profitability = querying one table (plus uncompleted staff assignments for projections).
- **Source Documents Feed the Ledger**:
  - `purchases` — receipt/invoice archive. When a receipt is a gig expense, a `gig_financials` record is created with `purchase_id` linking back. The purchase also retains `gig_id` for tracking. Two-way linking: purchases ↔ gig_financials.
  - `gig_staff_assignments` — staff scheduling with fee/rate. When marked complete, a `gig_financials` record is created with `staff_assignment_id`, and the assignment gets `gig_financial_id` back-link. Before completion, fees are projected costs only.
- **Financial Record Fields**: organization_id, amount, currency, type (fin_type enum), category (fin_category enum), description, counterparty_id, external_entity_name, due_date, paid_at, reference_number, notes, purchase_id (nullable FK), staff_assignment_id (nullable FK)
- **Staff Assignment Completion Fields**: completed_at (timestamp), units_completed (numeric, for rate-based), gig_financial_id (FK back to ledger entry)
- **Profitability View**: Contract amount minus (actual costs from ledger + projected staff from uncompleted assignments) = Profit with margin percentage
- **Type Grouping**: The 24-value `fin_type` enum is grouped in the UI into Revenue, Cost, Tracking, and Advanced categories. Common types shown prominently; full list accessible via expand

#### Gig CRUD Operations

- **Create**: Manager+ can create gigs
- **Read**: Staff+ can view gigs (staff see only assigned gigs)
- **Update**: Manager+ can edit gigs
- **Delete**: Admin can delete gigs
- **Duplicate**: Copy gig with its related data (participants, and the primary org's staff slots and kit assignments). Copied staff slots start unstaffed; assignments are not copied. No money rows are copied (B10, Cameron 11-08): no income, labor, purchase or mileage rows and no reference numbers; the copy's history entry records how many staff slots, kits and schedule entries were copied.

#### Multi-Act Scheduling & Event Timeline

Many gigs involve multiple acts performing at scheduled times, plus logistical activities (load-in, soundcheck, rehearsals). This section defines the scheduling model within a single gig.

**Schedule Entries**:
- A gig can have multiple schedule entries, each with a type, start time, end time, and optional notes.
- Schedule entries are stored in a separate `gig_schedule_entries` table — participants define who is involved, schedule entries define when things happen.
- **Schedule items**: free text. The UI offers the defaults Load-In, Act Arrival, Soundcheck, Doors, Set, Load-Out and Return (Set and Soundcheck can be linked to an act participant), and any custom item can be added (#12).
- Schedule entry times must fall within the gig's start/end window.

**Act Time Slots**:
- Acts added as gig participants can each have a scheduled performance time via a Set-type schedule entry.
- Simple single-act gigs do not need to interact with scheduling at all.
- Multi-act gigs use a schedule builder to assign time slots to each act.

**Staffing Windows**:
- Staff slots can optionally reference a schedule entry or time range, so staff can be assigned to specific windows within a gig rather than the full gig duration.
- Example: A sound engineer assigned only to the 7pm-9pm set, not the entire event.

**Conflict Detection**:
- Detect overlapping act time slots within the same gig.
- Detect staff assigned to overlapping schedule windows across gigs.

**UI Requirements**:
- A timeline/schedule view within the gig detail page showing all activities and act slots in chronological order.
- Simple gigs (single act, no schedule entries) show no scheduling UI — it appears only when schedule entries are added.
- Schedule entries can be added, edited, reordered, and removed.

---

### 4. Equipment Management ✅

#### Assets

Tracking all assets owned, for the purposes of assigning equipment to gigs, tracking insurance values, and general inventory.

**Asset Data**:

- **Required**: category, manufacturer_model, acquisition_date
- **Optional**: type (comma path, general to specific), serial_number, vendor, cost, quantity, replacement_value, insurance_policy_added, insurance_class, notes

**Asset Categories**: Sound, Lighting, Video, Staging, Other

**Insurance Tracking**:
- Track which assets are insured
- Export insurance reports with replacement values
- Filter by insurance status

#### Kits (Equipment Packages)

Groupings of assets that can be deployed on gigs. Simplifies building packages, and groups items that go together (like the individual items in a rack) into one unit. Assets can belong to multiple kits, but we want to detect when the same asset has been assigned on overlapping dates. 

**Kit Data**:
- **Required**: name
- **Optional**: description, notes, category, estimated_value

**Kit-Asset Relationships**:
- Kits contain multiple assets
- Assets can belong to multiple kits
- Track quantity of each asset in kit

**Kit Templates**:
- Create reusable equipment packages
- Quick assignment to gigs
- Easy duplication and modification

#### Kit Assignments

- **Purpose**: Assign equipment packages to gigs
- **Conflict Detection**: Warn when assigning assets to overlapping gigs
- **Data**: kit_id, gig_id, notes
- **Multiple Assignments**: Gig can have multiple kits assigned

#### Kit Containers

- **Container Kits**: A kit can be marked as a container (e.g., a rack or flight case)
- **Container vs. Logical**: Container kits represent physical enclosures; non-container kits are logical groupings whose individual items must be accounted for separately during inventory operations

#### Asset Status Lifecycle

- **Status Tracking**: Assets have a status reflecting their current state (e.g., Available, Checked Out, In Transit, On Site, In Warehouse, Inspect, Maintain, Retired)
- **Status History**: Track all status changes over time with timestamps for audit trail
- **Maintenance Flagging**: Staff can flag assets for inspection or maintenance during return workflows

#### Inventory Workflow (Warehouse & Field Operations)

Equipment moves through a multi-step lifecycle during gig operations. The workflow supports barcode scanning at each step for tracking.

- **Pack-Out**: Select a gig, display packing list, scan items against the list, update status to Checked Out
- **Load Truck**: Scan items, auto-detect associated gig, update status to In Transit
- **Load-In** (optional): Update status to On Site
- **Load-Out** (optional): Update status to In Transit
- **Unload**: Scan items, update status to In Warehouse, optionally flag for maintenance
- **Configurable Steps**: Organizations can enable or disable optional workflow steps
- **Packing Lists**: Auto-generated from kit assignments; non-container kits are expanded to show individual assets

---

### 5. Dashboard, Reporting & Analytics 📋

#### Gig Reports

- **Revenue by Month**: Track income per month
- **Gigs by Status**: Count gigs in each status
- **Gigs by Venue**: Track which venues are busiest
- **Staff Utilization**: Track which staff work most gigs

#### Asset Reports

- **Asset Inventory**: List all assets with values
- **Insurance Report**: Assets with insurance details
- **Asset Utilization**: Which assets are used most often
- **Depreciation**: Track asset values over time
- **Retirement:** Track when assets should be retired and disposition

#### Financial Reports

- **Revenue vs. Expenses**: Compare income to costs
- **Outstanding Payments**: Track unpaid gigs
- **Bid Acceptance Rate**: Track proposal success

---

### 6. Data Import/Export ✅

#### CSV Import

- **Import Types**: Gigs, Assets
- **Validation**: Client-side validation before import
- **Error Handling**: Display errors inline, allow correction before import
- **Batch Import**: Import multiple records at once
- **Organization Mapping**: Auto-create organizations if they don't exist (for gig imports)

#### CSV Export

- **Export Types**: Gigs, Insurance Asset List
- **Filters**: Export filtered/searched data

---

### 7. Notifications & Reminders 🔄

#### Email Notifications

- **Invitation Emails**: When user invited to organization
- **Staff Assignment**: When staff assigned to gig
- **Gig Reminders**: Day before gig starts
- **Status Changes**: When gig status changes

#### In-App Notifications

- **Bell Icon**: Notification count badge
- **Notification List**: View all notifications
- **Mark as Read**: Clear notifications

#### Push Notifications (Mobile)

- **Assignment Notifications**: Staff assignments
- **Gig Reminders**: Upcoming gigs
- **Status Updates**: Gig status changes

---

### 8. Calendar Integration & Scheduling ✅

#### Calendar View

Two additional Gig views: 

- **Month View**: Display gigs in calendar format
- **Week View**: Detailed weekly schedule
- **Filters**: Both views can filter by status, staff, venue, act

#### Calendar Integration

- **Google Calendar Integration**: Direct integration with Google Calendar API. 
  - User specifies a specific Google calendar to sync to. 
  - Gig adds, deletes and updates are reflected in the Google Calendar. 
  - A link is included in the calendar entry to navigate to the corresponding Gig record in the App.
  - It is a one-way sync. Google calendar deletes and updates are overwritten on the next sync event.  

#### Calendar View Conflict Detection

These warnings are displayed both in a box above the calendar display, and in the calendar itself with a distinctive color. When detected, they can also be added to the corresponding gig detail and entry screens. 

Two levels of conflict detection are implemented:

**CONFLICT**: A resource is committed to two or more gigs where there is complete, partial, or edge overlap.

**WARNING**: A resource is committed to two or more gigs where the end of one gig is within four hours of the start of another gig.

- **Staff Conflicts**: Detect when staff members are assigned to overlapping gigs (CONFLICT) or gigs within 4 hours (WARNING)
- **Equipment Conflicts**: Detect when equipment/kits are assigned to overlapping gigs (CONFLICT) or gigs within 4 hours (WARNING)
- **Venue Conflicts**: Detect when multiple gigs are scheduled at the same venue with overlapping times (CONFLICT) or within 4 hours (WARNING)

---
## Major Functionality Enhancements

### Attachments and File Management ✅ (partial)

There must be a uniform file attachment facility that is used in multiple places.

**Built** — a generic polymorphic system (`attachments` + `entity_attachments`, `{org_id}/{filename}` in the private `attachments` bucket, Admin/Manager to write, org member to view) mounted on:
- **Gig Attachments**: stage plots, input lists, contracts, riders, production schedules
- **Asset Attachments**: purchase receipts, manuals, warranty documents, calibration certificates
- **Purchase Attachments**: the scanned receipt/invoice on a `purchases` header
- **Expense (gig_financials) Attachments**: a receipt/invoice/document on an individual expense row — web and mobile (added 2026-08, `entity_type = 'gig_financial'`)
- Upload accepts PDF and image types in practice (`.pdf,image/*` on the receipt path; the generic `AttachmentManager` sets no client filter). No enforced size cap in the client today.

**Not built** (still aspirational): Organization- and Kit-level attachments, per-file tagging/categorization, version history, and full-text search across attachments.

---

### Mobile Version 🔄

Mobile features are organized by priority. For full implementation detail, see [Mobile Development Plan](./development-plan/04_mobile-development.md).

#### Priority 1: Gig Browsing & Quick Booking ✅

A compact interface for managing gigs on the go.

- **Mobile Gig List**: Card-based list of upcoming gigs showing title, date/time, status badge, venue, and act(s). Filterable by date range, status, venue, and act. Searchable by title, venue, and act name. Gigs are split into Upcoming and Past on web and mobile alike: a gig moves to Past only after its last day (`end`, or `start` when there's no end) is over in the gig's own timezone, so a gig underway today stays in Upcoming.
- **Simplified Gig Detail**: Read-only view showing only essentials — basic information (title, dates, timezone, status, notes, tags) plus venue and act participants. Excludes staff assignments, financials, and equipment details.
- **Quick-Create Gig**: Streamlined form for capturing new bookings with just: title, start/end dates, timezone, status (defaults to Date Hold), venue (dropdown), act (dropdown), and notes. Full details can be added later from the desktop app.
- **Booking Status Confirmation**: Tap to update gig status directly from the gig list or detail view. Quick swipe actions for common status transitions (e.g., Date Hold → Booked).

#### Priority 2: Staff Dashboard ✅

- **Upcoming Gigs**: Card-based list of assigned gigs for the next 48 hours
- **Quick Links**: Venue map/directions (native maps integration), stage plot viewer, one-tap contact list for gig organizers
- **Time Tracking**: Location-aware check-in button (active within venue radius)

#### Priority 3: Inventory & Warehouse Workflows 📋

- **Inventory Mode**: Specialized one-handed interface for equipment logistics with barcode scanning
- **Pack-Out/Load/Unload/Return Flows**: Multi-step asset tracking through the full gig lifecycle
- **Barcode Scanning**: Camera-based scanning (QR, Data Matrix, Code 128) plus Bluetooth HID scanner support
- **Packing Lists**: Auto-generated from kit assignments; non-container kits expanded to show individual assets

#### Mobile-Optimized Interface

- **Touch-Optimized UI**: Minimum 44px touch targets, swipe gestures, bottom sheets
- **Responsive Design**: Adaptive layouts for mobile browsers
- **Card-based Layouts**: Touch-friendly information consumption
- **Bottom Navigation**: Easy thumb access to primary actions
- **High-Contrast**: Readable in bright sunlight (outdoor festivals)

#### Offline Support

- **Offline-First Architecture**: Core functionality works without internet connection
- **Local Caching**: Cache 7 days of gig data using IndexedDB
- **Automatic Sync**: Background synchronization when connection restored
- **Sync Indicators**: Visual feedback for sync status
- **Conflict Resolution**: Last-write-wins for simple fields; user-prompted resolution for critical fields (gig status, asset availability)

#### Native Features

- **Biometric Authentication**: Face ID, Touch ID, fingerprint authentication via WebAuthn
- **Camera Integration**: Scan asset barcodes/QR codes, capture photos
- **Push Notifications**: Real-time alerts for assignments, reminders, status changes
- **Location Services**: GPS for venue check-in, travel distance calculations

#### Progressive Web App (PWA)

- **Installable**: Add to home screen functionality
- **App-like Experience**: Full-screen standalone mode, splash screen
- **Background Sync**: Queue actions when offline for automatic replay
- **Push Notifications**: Web push for real-time updates

---

### Receipt and Invoice Import ✅

#### Overview
In addition to CSV import, the system must support importing assets by uploading PDF or image-based receipts and invoices. This process uses AI (LLM) to extract structured data and automatically creates both `purchases` and `assets` records.

#### Functional Requirements
1. **File Upload**: Users can upload one or more PDF or image files (JPG, PNG) from the Assets screen.
2. **AI Extraction**: The system uses an LLM (e.g., Claude) to extract:
   - Invoice Date
   - Vendor Name
   - Grand Total (including tax/shipping)
   - Line items with Model, Description, Quantity, and Unit Price.
3. **Storage**: Uploaded files must be stored in the system (Supabase Storage) and associated with the created entities.
4. **Polymorphic Linking**:
   - The file (Attachment) must be linked to the `purchases` header record.
   - All `assets` created from the invoice must be linked to the `purchases` record via `purchase_id`.
5. **Asset-Invoice Traceability**:
   - The Asset Detail screen must display a link/preview of the original invoice/receipt.
   - The Purchase Detail screen must list all associated assets.
6. **Cost Allocation**: The system must apply a pro-rata cost allocation factor to distribute tax and shipping costs across all line items (Stage 4 of the native implementation spec).

---

### CSV Import Feature ✅

#### Overview

CSV import functionality for gigs and assets with client-side validation, immediate import of valid rows, and an error correction interface for invalid rows. For gigs, act/venue columns are automatically mapped to gig_participant rows, and organizations are created if they don't exist.

#### User Stories

**As a production manager**, I want to:
- Import my existing gig data from a spreadsheet
- See validation errors before importing
- Fix invalid rows and re-import
- Automatically create organizations that don't exist
- Import gigs with act/venue relationships

**As an equipment manager**, I want to:
- Import my asset inventory from a spreadsheet
- Bulk import equipment with all details
- See any errors and fix them before importing
- Track insurance information during import

#### CSV Templates

##### Gig Template Columns

| Column | Required | Type | Example | Notes |
|--------|----------|------|---------|-------|
| title | Yes | string | "Summer Festival" | Event name |
| start | Yes | ISO datetime | "2024-07-15T19:00:00" | Start datetime |
| end | Yes | ISO datetime | "2024-07-15T23:00:00" | End datetime |
| timezone | Yes | IANA timezone | "America/New_York" | Must be valid IANA timezone |
| status | Yes | enum | "Booked" | DateHold, Proposed, Booked, Completed, Cancelled, Settled |
| act | No | string | "The Rock Band" | Organization name (type: Act) |
| venue | No | string | "Madison Square Garden" | Organization name (type: Venue) |
| tags | No | comma-separated | "festival,outdoor,summer" | Converted to array |
| notes | No | string | "Load-in at 2pm" | Free-form text |
| amount | No | number | "5000.00" | Numeric or empty |

##### Asset Template Columns (A-Z)

| Col | CSV Column Name | Required | Type | Example | Notes |
|---|---|---|---|---|---|
| A | acquisition_date | Yes | Date | 2025-10-10 | YYYY-MM-DD |
| B | source | Yes | Enum | 1-Asset | 0 (Invoice), 1 (Asset), 2 (Expense) |
| C | vendor | Yes* | String | Amazon | *Required for Source 0 |
| D | total_inv_amount | Yes* | Number | 106.05 | *Required for Source 0 |
| E | payment_method | No | String | Visa | |
| F | line_amount | Yes* | Number | 87.98 | *Required for Source 2 |
| G | line_cost | No | Number | 95.24 | Computed if empty |
| H | quantity | No | Integer | 2 | Default: 1 |
| I | item_price | No | Number | 43.99 | |
| J | item_cost | No | Number | 47.62 | |
| K | manufacturer_model | Yes* | String | Shure SM58 | *Required for Source 1 |
| L | category | Yes* | String | Sound | *Required for Source 1 or 2 |
| M | sub_category | No | String | Microphones | |
| N | type | No | String | Dynamic Mic | |
| O | kit | No | String | Mic Pack A | Add to named kit |
| P | serial_number | No | String | SN12345 | |
| Q | tag_number | No | String | TAG-001 | |
| R | description | No | String | Black finish | |
| S | insured | No | Boolean | TRUE | |
| T | insurance_class | No | String | Class A | |
| U | replacement_value | No | Number | 150.00 | |
| V | retired_on | No | Date | 2029-12-31 | YYYY-MM-DD |
| W | liquidation_amt | No | Number | 20.00 | |
| X | service_life | No | Integer | 5 | Years |
| Y | dep_method | No | String | MACRS | |
| Z | status | No | Enum | Active | |

#### Validation Rules

##### Gig Validation

- **Required Fields**: title, start, end, timezone, status
- **Date Validation**: 
  - Start and end must be valid ISO datetime strings
  - End must be after start
- **Status Validation**: Must be valid enum value (DateHold, Proposed, Booked, Completed, Cancelled, Settled)
- **Timezone Validation**: Must be valid IANA timezone
- **Tags**: Comma-separated, converted to array
- **Amount_paid**: Numeric or empty
- **Act/Venue**: 
  - Search organizations table by name (case-insensitive)
  - If not found, create new organization with appropriate type ('Act' or 'Venue')
  - Map to gig_participants table

##### Asset Validation

- **Required Fields**: 
  - All: `acquisition_date`, `source`
  - Source 0 (Invoice): `vendor`, `total_inv_amount`
  - Source 1 (Asset): `manufacturer_model`, `category`
  - Source 2 (Expense): `line_amount`, `category`
- **Date Validation**: `acquisition_date` and `retired_on` must be valid dates (YYYY-MM-DD).
- **Numeric Fields**: Must be numeric or empty (defaults handled by logic).
- **Boolean Fields**: `insured`: parse from text ('yes', 'true', '1', etc.).

#### Import Logic

##### Gig Import Process

1. Parse CSV file
2. Validate all rows
3. For each valid row:
   - Search for act organization by name (case-insensitive)
   - If not found, create new organization with type 'Act'
   - Search for venue organization by name (case-insensitive)
   - If not found, create new organization with type 'Venue'
   - Create gig with all basic fields
   - Create gig_participants for act if provided
   - Create gig_participants for venue if provided
   - Always include current organization as a participant
   - Create a 'Payment Recieved' financial transaction if amount is present.
4. Show success count and any errors

##### Asset Import Process

1. Parse CSV file (A-Z columns).
2. Validate rows based on Source (0, 1, 2).
3. Group rows into logical Transactions:
   - A `Source 0` (Invoice) defines a new Purchase header.
   - Subsequent `Source 1` (Asset) or `Source 2` (Expense) rows are linked to the most recent `Source 0` via `purchase_id`.
   - Standalone `Source 1` or `Source 2` rows create an implicit Purchase if needed or remain unlinked.
4. For each valid row:
   - **Source 0**: Create `purchases` record (type: 'header').
   - **Source 1**: Create `assets` record AND a `purchases` record (type: 'item') linked to the asset.
   - **Source 2**: Create `purchases` record (type: 'item').
5. Map specific fields:
   - `line_amount` -> `purchases.line_amount`
   - `line_cost` -> `purchases.line_cost`
   - `item_price` -> `assets.item_price`, `purchases.item_price`
   - `item_cost` -> `assets.item_cost`, `purchases.item_cost`
   - `retired_on` -> `assets.retired_on`
   - `tag_number` -> `assets.tag_number`
6. Show success count and errors.

#### User Interface Requirements

##### Import Screen Components

- **File Upload**: Drag & drop or file picker
- **Import Type Selector**: Radio buttons for "Gigs" or "Assets"
- **Download Template Button**: Generate and download CSV template
- **Parsed Rows Table**: Display all parsed rows with validation status
- **Validation Indicators**: Green checkmark for valid, red X for invalid
- **Error Messages**: Inline error descriptions per row
- **Editable Invalid Rows**: Allow editing invalid rows before import
- **Import Button**: "Import Valid Rows" - disabled if no valid rows
- **Progress Indicator**: Show progress during import
- **Results Summary**: Display success count and error count

##### Error Correction UI

- **Inline Editing**: Click to edit invalid row fields
- **Real-time Validation**: Re-validate on change
- **Organization Autocomplete**: Search existing organizations for act/venue fields
- **Re-import**: After corrections, re-import specific rows

#### User Flow

1. User navigates to Gig List or Asset List screen
2. Clicks "Import" button
3. Selects import type (Gigs or Assets)
4. Downloads template (optional) to see expected format
5. Uploads CSV file (drag & drop or file picker)
6. System parses and validates all rows
7. Valid rows displayed in table, ready to import
8. Invalid rows displayed with inline editing capability
9. User fixes invalid rows directly in the UI
10. User clicks "Import Valid Rows" to import all valid rows
11. System shows success/error summary
12. After successful import, user is redirected to list view

#### Future Enhancements

- **Bulk Edit**: Edit multiple rows at once
- **Preview Changes**: Preview before importing
- **Undo/Rollback**: Rollback imports
- **Update Existing**: Match by ID or unique fields and update

---

### Complex Events: Hierarchical Gig Structure 📋

**Prioritization Note**: Hierarchical gigs are an advanced feature for complex multi-venue or multi-stage events. Most gigs operate as flat (non-hierarchical) events with multi-act scheduling (see Gig Management above). All core features — mobile, financials, scheduling, inventory — must work fully for flat gigs first. Hierarchy extends these capabilities but is not a prerequisite for them. For implementation detail, see [Hierarchy Foundations](./development-plan/05_hierarchy-foundations.md) and [Hierarchy UI](./development-plan/06_hierarchy-ui.md).

#### Overview

The hierarchical gig structure enables complex events (festivals, multi-venue events, multi-day events) where gigs can have parent-child relationships. This allows:
- **Equipment** consistency per stage throughout an event
- **Staffing** that is persistent (same staff for all days) or variable (different staff on different days)
- **Acts** that change for each individual performance
- **Participants** that could be consistent or variable (different companies per stage)
- **Bids** that encompass the whole event or roll up from components

#### Key Principles

##### Core Design Philosophy

- **Minimal Schema Changes**: Add only essential columns to maintain simplicity
- **Backward Compatibility**: Existing gigs continue to work without modification
- **Recursive Inheritance**: Use database queries to resolve inheritance, not explicit metadata
- **Child Overrides Parent**: Child values always take precedence over parent values
- **Hierarchical Access**: Users with access to parent gigs automatically access children

##### Inheritance Model

- **Simple Precedence**: Child values override parent values at all levels
- **No Explicit Overrides**: No need for override flags - just define values on child gigs
- **Optional Hierarchy**: Most gigs remain flat (no parent) for simple use cases

#### Constraints

- **No Cycles**: Circular parent-child relationships are prevented
- **Date Validation**: Child gig dates must fall within parent date range
- **Max Depth**: Hierarchy limited to 3 levels

#### Inheritance Behavior

- **Participants**: Child participants are added to inherited parent participants
- **Staff Slots**: Child staff slots override parent slots with same role
- **Equipment**: Child equipment assignments override parent assignments for same assets
- **Financials**: All financial records from the hierarchy are considered (no override logic)

#### Business Rules

##### Status Propagation

**Default Behavior (Simple)**:
- Parent and child gigs maintain independent statuses
- No automatic cascading of status changes
- Children can complete while parent remains booked

**Optional Advanced Logic (Future)**:
- **Cascade Cancellation**: When parent is cancelled, optionally cancel all children
- **Completion Rules**: Parent can only complete when all children are completed
- **Status Constraints**: Children cannot be booked if parent is cancelled

##### Conflict Resolution

**Staff Conflicts**:
- Prevent double-booking staff across overlapping gigs in same hierarchy
- Allow same staff on non-overlapping gigs within hierarchy
- Warn when staff availability conflicts arise

**Equipment Conflicts**:
- Track equipment usage across hierarchy
- Prevent double-assignment of same equipment to overlapping gigs
- Allow equipment reuse on non-overlapping gigs

#### Access Control

**Row-Level Security**:
- Users can access child gigs if they can access the parent
- Organization membership grants access to entire hierarchies
- Private data (notes, annotations) respects hierarchy boundaries

**Permission Inheritance**:
- Admin role on parent grants admin access to children
- Manager role allows creating child gigs
- Viewer role allows read-only access to hierarchy

#### Use Cases

##### Example 1: Multi-Day Music Festival

```
Summer Music Festival
├── Main Stage Setup
│   ├── Equipment: Full PA system, lighting rig
│   ├── Staff: Stage Manager, Lighting Tech
│   ├── Participants: Venue, Production Company
│   └── Friday Night Concert
│       ├── Act: Headliner Band
│       └── Staff: Specific lighting tech for this show
├── Side Stage Setup
│   └── [inherits equipment/staff from festival, overrides with smaller setup]
└── VIP Lounge
    └── [inherits equipment/staff from festival, overrides with lounge setup]
```

##### Example 2: Wedding with Ceremony + Reception

```
Sarah & John Wedding
├── Ceremony at Church
│   ├── Equipment: Basic sound system
│   ├── Staff: sound engineer, musicians
│   └── Participants: sound company, band
└── Reception at Hotel
    ├── Equipment: Full DJ/sound system, DJ lighting
    ├── Staff: DJ, sound engineer, lighting engineer
    └── Participants: Hotel (venue), DJ company, sound company, lighting company
```

#### UI/UX Requirements

##### Progressive Disclosure

- **Simple First**: Most users never need hierarchy - keep it hidden until needed
- **Contextual UI**: Show hierarchy features only when creating/editing hierarchical gigs
- **Optional Complexity**: Users can opt into complex features without affecting simple workflows

##### Visual Hierarchy Indicators

- **Parent-Child Relationships**: Clear visual indicators (nesting, indentation, breadcrumbs)
- **Inheritance Status**: Show which values are inherited vs. locally defined
- **Hierarchy Depth**: Visual cues for different levels (colors, icons, indentation)
- **Status Propagation**: Visual indicators for related gig statuses

##### Gig Creation Workflow

**Parent Gig Creation**:
- Standard gig creation form with optional "Create as Parent" toggle
- When enabled, show hierarchy planning section
- Allow defining shared resources (equipment, staff slots, participants)

**Child Gig Creation**:
- Parent selection dropdown (filtered by accessible gigs)
- Pre-populated inherited values
- Clear indication of what can be overridden
- Validation against parent constraints

##### Form Design Patterns

**Inherited Value Display**:
```
[Field Label] (Inherited from "[Parent Gig Name]")
[Value Display - Read-only] [Override Button]
[Override: Editable Input Field - when override enabled]
```

**Hierarchy Navigation**:
- Breadcrumb trail: Festival > Main Stage > Friday Night
- Sibling navigation: Previous/Next child gigs
- Parent jump: Quick access to parent gig details

##### List View Enhancements

**Gig List with Hierarchy**:
- Indented rows for child gigs
- Expandable/collapsible parent rows
- Hierarchy-aware sorting and filtering
- Bulk selection across hierarchies

**Status Overview**:
- Parent gig shows rollup status of children
- Color-coded hierarchy indicators
- Quick status changes with cascade options

For implementation detail (schema, recursive queries, phasing), see [Hierarchy Foundations](./development-plan/05_hierarchy-foundations.md).

---

### Robust Data Tables Feature ✅

#### 1. Overview
The goal is to implement a robust, highly-functional, and consistent table system across the GigWrangler application. The new system will provide advanced sorting, filtering, and column management, along with a seamless in-place editing experience inspired by tools like Coda and Notion.

#### 2. Goals
- Provide a unified table component that can be used throughout the application.
- Enhance data discoverability through persistent sorting and multi-criteria filtering.
- Allow users to customize their view by adding or removing columns.
- Implement a "natural" in-place editing experience that minimizes UI disruption.
- Ensure state persistence (filters, sorting, column layout) across page reloads.

#### 3. Features

##### 3.1. Robust Table Capabilities
- **Sorting**:
  - Click on column headers to cycle through Ascending, Descending, and No Sort.
  - Sorting state must persist across sessions/page invocations.
- **Filtering**:
  - Support for multiple filtering criteria simultaneously.
  - Filtering state must persist across sessions/page invocations.
- **Column Management**:
  - Ability to toggle visibility of optional columns.
  - Column layout (which columns are visible) must persist across sessions/page invocations.

##### 3.2. In-place Editing ("Natural Feel")
- **UX Patterns**:
  - Single click to select a cell (shows a blue outline).
  - Double click to enter edit mode.
  - No flickering or formatting changes when switching to edit mode.
- **Field Types**:
  - **Checkboxes**: Direct interaction.
  - **Text Fields**: Cursor placed at the end of text on entry.
  - **Pills (Badges)**: Maintain formatting; cursor placed at the end to add/edit. Backspace to delete pill, select list with search to add a new pill. Use colors from `src/utils/supabase/constants.ts`.
  - **Select Lists**: Dropdown with a search/filter field.
- **Persistence**: Edits should be saved immediately (auto-save) or via a robust update mechanism.

##### 3.3. Configuration & Consistency
- **Schema-driven Configuration**:
  - Define fields that are **Required** (must be in table).
  - Define fields that are **Read-only**.
  - Define fields that are **Optional** (can be toggled by user).
- **Action Column**:
  - Configurable actions (Edit, Delete, Duplicate, etc.) per table instance.
- **Uniformity**: Consistent styling and behavior for all tables (main screens and nested tables in Edit screens).

#### 4. User Experience (UX)
- Blue outline for selected cells.
- Smooth transitions between viewing and editing states.
- Intuitive sorting and filtering UI (e.g., icons in headers).
- Persistent state should feel seamless to the user.

---

### 6. Attachments and File Management

#### Overview
The application provides a centralized system for managing file attachments (PDFs, images, spreadsheets) associated with various entities like Gigs, Assets, and Expenses.

#### Requirements
- **Generic Attachment System**: A single file can be linked to multiple entities (polymorphic associations).
- **Supabase Storage**: Files are stored in an `attachments` bucket, isolated by organization ID.
- **Security**: Access restricted via RLS to organization members with Manager+ roles.
- **File Types**: Support for PDF, PNG, JPG, JPEG, and CSV (max 10MB).
- **Audit Trail**: Link source documents (invoices, receipts) to all assets and expenses they created.
- **UI Integration**:
    - Centralized file viewer for documents.
    - Quick access links on relevant entity detail screens.
    - Support for mobile camera capture and direct upload.

### 7. Expense Management & Gig Profitability

#### Overview
`gig_financials` is the single source of truth for all gig financial data. Every financial event — revenue, expense, staff labor cost — is a ledger entry. Source documents (`purchases` for receipts, `gig_staff_assignments` for labor) feed into the ledger but are not queried separately for profitability.

#### Single-Ledger Architecture
- A single financial ledger is the source of truth for all gig financial data. Every financial event — revenue, expense, staff labor cost — is a ledger entry. Profitability = Revenue entries minus Cost entries.
- When a scanned receipt is a gig expense, the system creates both a purchase record (the archive) and a ledger entry (the financial effect), linked together for traceability.
- Staff assignment fees are projected costs until the assignment is marked complete, at which point they become actual costs in the ledger.
- Capital asset purchases (equipment acquisitions) are inventory, not gig expenses, and do not appear in gig profitability.

For the technical data model, ER diagram, and two-way linking pattern, see [Financial Data Technical Reference](../technical/financials.md).

#### Staff Cost Lifecycle
- **Before gig**: Staff assigned with fee/rate → shows as projected cost in profitability view
- **After gig**: Assignment marked complete → becomes actual cost in ledger
- **Payment**: Payment recorded → clear visibility into "incurred but not yet paid"
- **Bulk finalization**: "Finalize All" completes all confirmed fee-based assignments in one click when gig moves to Completed

#### Gig Profitability
- **Revenue**: Total contract value (Contract Signed + Bid Accepted amounts)
- **Received**: Deposits and payments received to date
- **Actual Costs**: Expenses incurred and payments sent (includes completed staff labor, manual expenses, receipt-sourced expenses)
- **Projected Staff**: Fees from staff not yet finalized (goes to zero as staff are completed)
- **Profit**: Revenue minus (Actual Costs + Projected Staff), with margin percentage
- **Outstanding**: Unpaid revenue (contract minus received) and unpaid costs (expenses with a due date but no payment recorded)

#### Requirements
- **Manual Expense Entry**: Quick entry via Financials section — type, amount, category, description.
- **AI-Powered Receipt Entry**: Upload receipt via "Upload Receipt" button; AI extracts line items; system creates both a purchase record (archive) and a ledger entry (financial effect) automatically.
- **Receipt on any expense**: Any expense row (manual, mileage, imported, receipt-sourced) can carry attached receipts/documents directly, via the paperclip on the row (web) or the transaction detail sheet (mobile).
- **General Business Expenses**: Purchases without a gig association are tracked as general business receipts. Such a purchase (or an individual line) can be assigned to a gig after the fact from the Purchases tab, which then offers to create the matching ledger entry.
- **Categorization**: `fin_category` uses IRS Schedule C categories (Advertising, Car and truck expenses, Contract labor, Office expense, Rent or lease, Supplies, Travel, Meals, Utilities, Wages, Other expenses, …). Authoritative list: `FIN_CATEGORY_CONFIG` in `src/utils/supabase/constants.ts`. `category` is nullable.
- **Profitability Summary**: Three-card display: Contract (received/outstanding), Total Costs (actual + projected staff), Profit (with margin).
- **Source Indicators**: Each expense row shows its source: Manual, Receipt (linked to purchase), Staff (linked to assignment).
- **Paid/Unpaid Visibility**: All revenue and expense records show payment status.
- **Receipt-Linked Expenses**: Receipt-sourced expenses in the Financials section link to the original purchase record for viewing line items and attachments. No separate Purchase Receipts section.
- **Reporting**: Revenue vs. expenses per gig, outstanding payments across gigs, staff earnings.

## Related Documentation

- [Development Roadmap](./development-plan/01_roadmap.md) — Product roadmap with completed work, what's next, and strategic priorities
- [Competitive Analysis](./development-plan/02_competitive-analysis.md) — Market positioning vs. Rentman, Current RMS, LASSO, BackOpsLive, gig-manager.app
- [Database Documentation](../technical/database.md) — Schema and RLS policies
- [Financial Data Technical Reference](../technical/financials.md) — Financial architecture, data boundaries, ER diagram
- [Tech Stack](../technical/tech-stack.md) — Technology overview
- [Security Scheme](../technical/security-scheme.md) — Authentication, authorization, and storage security

