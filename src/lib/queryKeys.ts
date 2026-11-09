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

  // ── Equipment (A10, Engineer E) ──
  // Everything about one organization's equipment sits under assets(orgId), everything about one
  // unit or lot under asset(assetId), so one invalidation reaches all of it.
  /** The Items list: { items (each with its units and lots), containerPieces }. */
  equipmentItems: (orgId: string) => ['assets', orgId, 'items'] as const,
  /** An item page: { item, inContainers, kitLines, places }. */
  equipmentItem: (itemId: string, orgId: string) => ['assets', orgId, 'item', itemId] as const,
  assetTrackingSummary: (orgId: string) => ['assets', orgId, 'trackingSummary'] as const,
  assetActivity: (assetId: string) => ['asset', assetId, 'activity'] as const,
  /** Filed tax years; nests under the taxYears(orgId) root. */
  lockedTaxYears: (orgId: string) => ['taxYears', orgId, 'locked'] as const,
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

// ── Equipment (A10, Engineer E) ──

/**
 * After a unit or lot is added, changed, duplicated, deleted, written off or brought back: the
 * organization's equipment (lists, item pages, tracking), that record, the kits (their values
 * count it) and the dashboard (equipment value). With refetchList false, the Items list is only
 * marked stale: it has just written an inline edit into its own cache.
 */
export function invalidateAfterAssetChange(
  queryClient: QueryClient,
  { organizationId, assetId }: { organizationId: string; assetId?: string },
  { refetchList = true }: { refetchList?: boolean } = {},
) {
  const listKey = queryKeys.equipmentItems(organizationId);
  return Promise.all([
    refetchList
      ? queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) })
      : Promise.all([
          queryClient.invalidateQueries({ queryKey: listKey, exact: true, refetchType: 'none' }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.assets(organizationId),
            predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(listKey),
          }),
        ]),
    assetId ? queryClient.invalidateQueries({ queryKey: queryKeys.asset(assetId) }) : null,
    assetId ? queryClient.invalidateQueries({ queryKey: queryKeys.assetInventoryTracking(assetId) }) : null,
    queryClient.invalidateQueries({ queryKey: queryKeys.kits(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(organizationId) }),
  ]);
}

/**
 * After an item's shared fields change (they are copied to its units and lots): the
 * organization's equipment, every unit or lot page, and the kits. With refetchItemPage false,
 * that item's page is only marked stale: it has just written the edit into its own cache.
 */
export function invalidateAfterItemChange(
  queryClient: QueryClient,
  { organizationId, itemId }: { organizationId: string; itemId?: string },
  { refetchItemPage = true }: { refetchItemPage?: boolean } = {},
) {
  const pageKey = itemId ? queryKeys.equipmentItem(itemId, organizationId) : null;
  const keepPage = !refetchItemPage && pageKey;
  return Promise.all([
    keepPage
      ? Promise.all([
          queryClient.invalidateQueries({ queryKey: pageKey, exact: true, refetchType: 'none' }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.assets(organizationId),
            predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(pageKey),
          }),
        ])
      : queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) }),
    queryClient.invalidateQueries({ queryKey: ['asset'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.kits(organizationId) }),
  ]);
}

/**
 * After a kit is created, changed, duplicated or deleted: the organization's kits, that kit, the
 * item pages (they list the kits that use an item) and the dashboard. With refetchList false, the
 * kit list is only marked stale: it has just written an inline edit into its own cache.
 */
export function invalidateAfterKitChange(
  queryClient: QueryClient,
  { organizationId, kitId }: { organizationId: string; kitId?: string },
  { refetchList = true }: { refetchList?: boolean } = {},
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.kits(organizationId),
      ...(refetchList ? {} : { refetchType: 'none' as const }),
    }),
    kitId ? queryClient.invalidateQueries({ queryKey: queryKeys.kit(kitId) }) : null,
    queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(organizationId) }),
  ]);
}
