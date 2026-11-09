import type { QueryClient } from '@tanstack/react-query';

/**
 * Centralized React Query key conventions (Phase 7, Step 2).
 *
 * Keys are hierarchical so related caches can be invalidated together:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.team(orgId) })
 *
 * Convention: list keys are scoped by the org (or parent) id; detail keys by
 * the entity id. Services remain the single Supabase access layer — these keys
 * only identify cache entries; the query functions call the services.
 */
export const queryKeys = {
  // Gigs. Everything about one organization's gigs sits under gigs(orgId), everything about one
  // gig under gig(gigId), so one invalidation reaches all of it (A10).
  gigs: (orgId: string) => ['gigs', orgId] as const,
  /** The gig list with its conflicts: { gigs, conflicts }. */
  gigList: (orgId: string) => ['gigs', orgId, 'list'] as const,
  /** Per-gig money totals for the list's optional columns and the export. */
  gigAggregates: (orgId: string) => ['gigs', orgId, 'aggregates'] as const,
  gig: (gigId: string) => ['gig', gigId] as const,
  gigChildCount: (gigId: string) => ['gig', gigId, 'children'] as const,
  /** Conflicts for a gig as seen by one organization, for the times they were checked at. */
  gigConflicts: (gigId: string, orgId: string, when: { start: string; end: string; timezone?: string; allDay: boolean }) =>
    ['gig', gigId, 'conflicts', orgId, when.start, when.end, when.timezone ?? null, when.allDay] as const,
  gigActivity: (gigId: string) => ['gig', gigId, 'activity'] as const,

  // Dashboard
  dashboard: (orgId: string) => ['dashboard', orgId] as const,
  recentActivity: () => ['activity', 'recent'] as const,

  // Assets
  assets: (orgId: string) => ['assets', orgId] as const,
  asset: (assetId: string) => ['asset', assetId] as const,
  assetInventoryTracking: (assetId: string) => ['assetInventoryTracking', assetId] as const,

  // Kits
  kits: (orgId: string) => ['kits', orgId] as const,
  kit: (kitId: string) => ['kit', kitId] as const,

  // Team / organization membership
  team: (orgId: string) => ['team', orgId] as const,
  teamMember: (orgId: string, memberId: string) => ['team', orgId, memberId] as const,
  invitations: (orgId: string) => ['invitations', orgId] as const,
  staffRoles: (orgId: string) => ['staffRoles', orgId] as const,
  orgContacts: (orgId: string) => ['orgContacts', orgId] as const,

  // Financials
  financials: (gigId: string) => ['financials', gigId] as const,
  gigFinancialsSummary: (gigId: string) => ['gigFinancialsSummary', gigId] as const,
  gigProjectedStaff: (gigId: string) => ['gigProjectedStaff', gigId] as const,
  purchases: (orgId: string) => ['purchases', orgId] as const,

  // Gig participants
  gigParticipantContacts: (gigId: string, orgId: string) => ['gigParticipantContacts', gigId, orgId] as const,

  // Access requests (issue #33 cluster)
  orgAccessRequests: (orgId: string) => ['orgAccessRequests', orgId] as const,
  moderatorAccessRequests: () => ['moderatorAccessRequests'] as const,

  // Generic notification feed (issue #52) — powers the notification bell.
  notifications: () => ['notifications'] as const,
} as const;

/**
 * After a change to one gig (its details, participants, an organization going Inactive): the
 * gig itself, its organization's gig list and the dashboard's figures.
 */
export function invalidateAfterGigChange(
  queryClient: QueryClient,
  { gigId, organizationId }: { gigId: string; organizationId: string },
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.gig(gigId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.gigs(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(organizationId) }),
  ]);
}

/** After a gig is added (created, duplicated) or removed: the gig list and the dashboard. */
export function invalidateAfterGigListChange(queryClient: QueryClient, organizationId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.gigs(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(organizationId) }),
  ]);
}
