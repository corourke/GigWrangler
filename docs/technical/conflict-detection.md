# Conflict Detection

## Overview

Conflict detection identifies scheduling overlaps when multiple gigs share the same staff, venue/act organizations, or equipment during overlapping time periods. Detection is **gig-centric**: given a specific gig (or set of gigs), the system finds other gigs that conflict with it.

## Conflict Types

### Staff Conflicts
Two gigs conflict on staff when the same user is assigned (via `gig_staff_assignments`) to both gigs and their time ranges overlap.

**Data path**: `gigs → gig_staff_slots → gig_staff_assignments → users`

There is no direct FK from `gig_staff_assignments` to `gigs`. Assignments link through `gig_staff_slots.gig_id`.

### Participant Conflicts (Venue & Act)
Two gigs conflict on participants when the same organization appears in `gig_participants` with a conflicting role (`Venue` or `Act`) on both gigs during overlapping times.

**Data path**: `gigs → gig_participants → organizations`

**Inactive participants are left out (#175).** A `gig_participants` row with `inactive = true` neither raises nor receives a participant conflict; `checkParticipantConflicts` and the batch check both skip it.

**Configurable roles**: The constant `PARTICIPANT_CONFLICT_ROLES = ['Venue', 'Act']` controls which participant roles trigger conflict detection. The conflict `type` field remains `'venue'` for UI compatibility, with `details.role` indicating the actual role.

### Equipment Conflicts
Two overlapping gigs conflict on equipment in two ways. Both checks count only the viewing organization's kits.

- **The same unit on both gigs.** Every assigned kit is resolved to its records through `kit_flattened_cache`, so two different kits that share a physical unit conflict. Only **tracked units** count: records with quantity 1 and a serial or tag (`isTrackedUnit`; Cameron, 10-09). A lot on both gigs (cables, stands) isn't a conflict by itself; the per-item check below says whether there are enough. A **container kit counts as one unit** too: the same case on both gigs, or a kit holding it on one gig and the case itself on the other, is a conflict named by the container (`containersIn`, from the kit tree the per-item check loads). Its contents are often lots, which the unit check leaves out. The conflict lists the kits and the shared units, e.g. "Main PA (PD-20 (#DSL-0211))".
- **Not enough of an item (#184).** Per item, the peak concurrent demand from this gig's kits plus the kits of the gigs running at the same moment, against what's free (Active, not retired, not inside a container kit). "Any" lines, specific units and lots all count toward their item. Every pair of gigs that is short together is reported, at the worst moment they share (`itemsShort`).

- **Equipment added at pack-out (#185 PR 2).** Units and lots added to a gig on their own are its no-kit tracking rows (newest per record, the organization's only). Each gig's are one more kit in both checks, "Added at pack-out" (`loose:<gig id>`): its tracked units join the same-unit check, and its units and lots (with the row's quantity) count toward the gig's needs per item. A gig with only such rows is a candidate too. Kits added at pack-out are ordinary assignments. `additionWarnings` runs the single-gig check with and without something about to be added and returns only what the addition makes new; the phone shows it before adding.

**Data path**: `gigs → gig_kit_assignments → kits → kit_flattened_cache / kit_flattened_item_cache → assets → equipment_items`; pack-out additions come from `inventory_tracking` rows with no kit.

## All-Day Gig Handling

An all-day gig has `gigs.all_day = true` (A12). Its `start` and `end` are dates, stored at 12:00 UTC (`T12:00:00.000Z`) so the date reads the same in every time zone. Whether a gig is all-day is the flag, not the 12:00 UTC time: a timed gig can start at 12:00 UTC. `isGigAllDay()` in `dateUtils.ts` reads the flag, and falls back to a 12:00 UTC start only for a gig loaded without it (an offline copy saved before A12).

For an all-day gig, `effectiveRange()` covers its whole local day in the gig's time zone:
- **Start**: local midnight on that date
- **End**: one millisecond before the next local midnight

A timed gig's range is exactly its start to end, including one at 12:00 UTC. The conflict checks select `all_day` for the other gigs and take the current gig's flag as their `allDay` argument.

## Overlap Classification

Given two gigs A and B, `classifyOverlap()` returns:

1. **`'conflict'`** — Their effective ranges directly overlap (`A.start <= B.end AND A.end >= B.start`).
2. **`'warning'`** — They don't directly overlap but are within `WARNING_BUFFER_MS` (4 hours) of each other.
3. **`null`** — No temporal proximity.

## Per-Gig Detection (`checkAllConflicts`)

Used when viewing a single gig's detail screen. Makes 3 parallel Supabase queries:

1. **`checkStaffConflicts(gigId, start, end)`**
   - Query current gig's slots → get slot IDs
   - Query assignments for those slots → get user IDs
   - Query candidate gigs (within widened time range) with their staff slots/assignments
   - Compare user IDs in JS; classify overlaps

2. **`checkParticipantConflicts(gigId, start, end)`**
   - Query current gig's participants with conflicting roles
   - Query candidate gigs with their participants
   - Compare organization IDs in JS; classify overlaps

3. **`checkEquipmentConflicts(gigId, start, end)`**
   - Query current gig's kit assignments
   - Query candidate gigs with their kit assignments
   - Compare kit IDs in JS; classify overlaps

**Query widening**: Database queries use `widenedQueryRange()` which adds `WARNING_BUFFER_MS + DAY_MS` (28 hours) to both ends of the time range. This ensures date-only gigs and warning-proximity gigs are captured as candidates. Precise overlap/warning classification happens in JS after fetching.

## Batch Detection (`checkAllConflictsForGigs`)

Used on the gig list/calendar view to detect conflicts across all visible gigs efficiently. Gigs with status `Cancelled` (`EXCLUDED_STATUSES`) are dropped first. The number of queries doesn't grow with the number of gigs; four run in parallel:

1. `gig_staff_slots` with nested `gig_staff_assignments` for all gig IDs
2. `gig_participants` (filtered to conflict roles, with `inactive`) for all gig IDs
3. `gig_kit_assignments` for all gig IDs
4. The no-kit pack-out rows (`loadLooseSafely`, the viewing organization's only; #185)

A further `kit_flattened_cache` query resolves the assigned kits to their tracked units, and the kit-tree loads for the per-item check follow. Then builds lookup maps (`staffByGig`, `participantsByGig`, `kitsByGig`) and does O(n²) pairwise comparison in JavaScript:

- For each pair (A, B) where `rangesOverlap(A, B)`:
  - Check shared staff user IDs
  - Check shared participant organization IDs
  - Check shared kit IDs
- Conflicts are emitted **symmetrically** (both A→B and B→A)
- Deduplicated by composite key: `${type}:${gig_id}:${other_gig_id}:${venue_id}`

## Service Location

All conflict detection logic is in `src/services/conflictDetection.service.ts`.

Re-exported from `src/services/gig.service.ts` for convenience, including `checkVenueConflicts` as a legacy alias for `checkParticipantConflicts`.

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `WARNING_BUFFER_MS` | 4 hours (14,400,000 ms) | Proximity threshold for warnings |
| `DAY_MS` | 24 hours (86,400,000 ms) | Used in query widening for date-only gigs |
| `EXCLUDED_STATUSES` | `['Cancelled']` | Gig statuses left out of the batch check |
| `PARTICIPANT_CONFLICT_ROLES` | `['Venue', 'Act']` | Organization roles that trigger participant conflicts |
