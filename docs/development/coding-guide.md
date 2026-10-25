# GigManager AI Coding Guide

**Purpose**: Essential coding guidelines and patterns for AI agents working on the GigManager codebase.

---

## Application Context

**GigManager** is a production and event management platform. 
- Full production application with Supabase/PostgreSQL.
- User authentication via Supabase.
- Multi-tenant isolation enforced by RLS and application logic.

## Database 

### Schema Modifications

- Write a new migration file in `/supabase/migrations/`. Never edit a committed migration; `schema.sql` changes do nothing.
- Cameron applies migrations (`supabase db push` on dev, then `./deploy_prod.sh`); ask, and wait for confirmation (AGENTS.md rule 4).
- Regenerate `src/utils/supabase/database.types.ts` and update `/docs/technical/database.md` in the same change.
- A new org-private table or a policy change needs a test in `supabase/tests/rls/` (CI job `rls`).

**Note**: The KV store limitations DO NOT apply to this project.

### Data Handling Guidelines

- **Partial Updates**: When updating data through user edit actions (form or inline editing), ONLY update database columns for values that have been changed in the UI. Do not make changes to column values that haven't changed to avoid triggering unnecessary change logic in the back-end.
- **Migration Assumptions**: It is not necessary to gracefully handle cases where tables don't exist - we will always assume migrations have been run.
- **No Mock Data**: Do not add or maintain any code to handle mock data outside of tests - we are using a live database.

---

## Core Technology Stack

- **Frontend**: React 18 (Function components), TypeScript (strict — enforced by `npm run typecheck` against the root `tsconfig.json`), Vite, Tailwind CSS v4.
- **UI Components**: Shadcn/ui (Radix), Lucide React icons.
- **Forms**: `react-hook-form` + `zod` validation.
- **Backend**: Supabase (JS Client), PostgreSQL, RLS.
- **Utilities**: `date-fns` (dates), `sonner` (toasts), `recharts` (charts).
- **Testing**: Vitest + React Testing Library.

## Security & Multi-Tenancy

1. **Organization Isolation**: Every database query **MUST** include `.eq('organization_id', organizationId)`.
2. **Membership Verification**: Every API call must verify the user belongs to the target organization.
3. **Server-Side Trust**: Never trust client-provided IDs without verification.
4. **RLS**: Rely on RLS policies but always filter explicitly in application code for defense in depth.

## Implementation Patterns

### 1. Components & Screens
- **Shared Form**: Use one component for both "Create" and "Update" operations.
- **Structure**: Props -> State -> Form Setup -> Effects -> Handlers -> JSX.
- **File Size**: Keep components small (<500 lines); extract helpers to separate files.
- **Naming**: `FeatureScreen.tsx`, `FeatureDialog.tsx`, `FeatureForm.tsx`.

### 2. Forms & Data
- **Partial Updates**: Use the `useSimpleFormChanges` hook (`src/utils/hooks/`) to identify only changed fields for `UPDATE` operations.
- **Validation**: Use Zod schemas for all forms.
- **Loading States**: Show spinners on buttons and disable interactive elements during async operations.

### 3. API & Error Handling
- **Location**: API functions belong in `src/services/*.service.ts`, with shared error handling in `src/utils/api-error-utils.ts`.
- **Data-access base**: `src/services/base/dataAccess.ts` holds generic CRUD and the auth lookup (issue #20). `user`, `attachment`, `notification`, `taxYear`, `accessRequest`, `purchaseScanQueue`, `purchaseCategory`, `activityLog`, `gigKit`, `gigParticipant`, `gigParticipantContacts`, `gigSchedule`, `gigStaff`, `asset`, `kit` (asset and kit share `computeFieldChanges` in `src/utils/fieldChanges.ts`), `organization`, `conflictDetection`, `googleCalendar`, `inventoryManagement`, `gigFinancial`, `taxReport`, `purchase`, `equipmentItem`, `equipmentNeeds`, `writeOff`, `maintenance` and `gig` services, and the mobile `staffDashboard`, `inventoryTracking`, `offlineSync`, `packingList` and `orgIndex` services use it. The mobile services take the client once, when the module loads. Activity-log entries go through `writeActivity` (`src/services/writeActivity.ts`): it starts every entry with `context_version` and the actor (`actorNameOf(user)`), and a failed write never fails the change. Field changes use `computeFieldChanges` (`src/utils/fieldChanges.ts`), one rule for every service: the saved record before vs the saved record after, empty values (null, undefined, '', an empty list or object) all the same, lists compared by contents. Every helper takes a required `context`, the words a lost connection shows ("Unable to <context>"), so a query moved onto a helper keeps its message; `listAllRecords` pages past the 1000-row cap, `countRecords` counts without reading, `deleteOne` confirms a row went and otherwise throws the service's own words, and `updateRecord`'s `audit` stamps `updated_by`/`updated_at`.
- **Error Pattern**: Catch errors, log to console, and throw user-friendly messages for the UI to display via `toast`.
- **Timestamps**: Always update `updated_at` on records during updates.

### 4. UI/UX & Styling
- **Mobile-First**: Use Tailwind responsive prefixes (`md:`, `lg:`).
- **Touch Targets**: Minimum 44x44px for interactive elements.
- **Layout**: Prefer Flexbox/Grid over absolute positioning.
- **States**: Design for Loading, Error, Empty, and Success states.
- **Consistency across pages**: an interaction pattern is a property of the *pattern*, not
  of the one page it was first built on. When you add or fix how something behaves (a
  click target, a confirmation step, an empty-state layout, a loading treatment), find
  every other place the same kind of element already exists and apply the same behavior
  there too, in the same change — don't leave one page doing it differently because that
  wasn't the page you were asked about. If applying it everywhere is out of scope for the
  change at hand, say so explicitly and file a follow-up rather than silently leaving the
  inconsistency. This is what the `SmartDataTable` title-cell rule below is an instance of
  (issue #27: the first fix only touched the Gigs list, and every other list needed the
  identical fix once someone actually clicked around them).
- **`SmartDataTable` title cell**: every list backed by `SmartDataTable` for a record with
  its own detail/edit screen (gigs, assets, kits, team members, ...) must set `onCellClick`
  on that record's title/name column to open it — a click opens the record. `onCellClick`
  fires on every click, including the first click of a double-click, so it can't coexist
  with inline editing on that column — don't also set `editable` there; rename/edit that
  field from the detail screen instead. Don't rely on a row-menu action alone. A table with
  no detail screen to open (invitations, access requests) doesn't need this.

## Quick Checklist

- [ ] `organization_id` filter included in all queries.
- [ ] Partial updates implemented (only changed fields sent).
- [ ] User membership/authorization verified.
- [ ] Zod validation applied to forms.
- [ ] Loading states handled during async calls.
- [ ] UI is responsive and touch-friendly (44px targets).
- [ ] Types are explicitly defined (avoid `any`).
- [ ] Components are modular and focused.
- [ ] Any new/changed interaction pattern applied to every other page with the same kind
      of element, not just the one page the task named.

## Quality Gates

All must pass before merging. CI (`.github/workflows/ci.yml`) runs them, then `npm run build`, plus the `rls` job:

```bash
npm run typecheck   # tsc --noEmit, strict mode, root tsconfig.json
npm run lint        # ESLint flat config (eslint.config.js)
npm run test:run    # Vitest
npm run build       # Vite production build
```

### Type system notes

- The Supabase `Database` type is **generated** from the live dev schema into `src/utils/supabase/database.types.ts` (`supabase gen types typescript --linked`). Regenerate it after every schema migration. The `Db*` row types in `src/utils/supabase/types.tsx` are aliases of the generated rows and must not be hand-edited back into drift.
- Test fixtures should use the factories in `src/test/factories.ts` (`makeUser`, `makeOrganization`) rather than hand-built objects.

### Lint burn-down debt (intentional, tracked)

- `@typescript-eslint/no-explicit-any` is **off**: about 660 `any`s in app code and 480 in tests (counted 2026-10-03). Tighten to `error` as services and components are refactored.
- The react-hooks v6 compiler rules (`set-state-in-effect`, `immutability`, `refs`, `purity`, `incompatible-library`, `static-components`) are **off**: they flag real but refactor-sized issues in the large screen components. Re-enable them per component as the screens are split.
- `react-hooks/exhaustive-deps` is a **warning** (37 open on 2026-10-03). Fix opportunistically; do not add new ones.
- `react-refresh/only-export-components` is a **warning** (17 open, files that export helpers next to components).
- `react-big-calendar` is typed as `any` via `src/types/react-big-calendar.d.ts`; replace with `@types/react-big-calendar` when convenient.

## Future Refactoring Opportunities

- **`src/services/gig.service.ts`** (~980 lines): participants, schedule, financials, staff, kits and participant contacts are already split into `gig*.service.ts` modules (kits, financials, participants and staff are re-exported from here). Gig CRUD, duplicate, the gig pickers and accounting summaries remain.
- **`src/components/AssetScreen.tsx`** (~970 lines): form state uses in-place string→number normalization with boundary casts at the `createAsset`/`updateAsset` call sites; replace with a typed conversion layer when the component is split.

---
**Last Updated**: 2026-10-03
