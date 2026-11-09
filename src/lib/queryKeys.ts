import type { QueryClient } from '@tanstack/react-query';

/**
 * Centralized React Query key conventions (Phase 7, Step 2).
 *
 * Keys are hierarchical so related caches can be invalidated together:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.team(orgId) })
 *
 * Convention: list keys are scoped by the org (or parent) id; detail keys by
 * the entity id; answers that depend on who is signed in, by the user id (the
 * cache is also cleared when the signed-in person changes, lib/queryCacheOwner).
 * Services remain the single Supabase access layer — these keys only identify
 * cache entries; the query functions call the services.
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
  // The gig page's edit sections (A10, PR 2).
  gigStaffSlots: (gigId: string, orgId: string) => ['gig', gigId, 'staffSlots', orgId] as const,
  gigParticipants: (gigId: string) => ['gig', gigId, 'participants'] as const,
  gigKitAssignments: (gigId: string, orgId: string) => ['gig', gigId, 'kitAssignments', orgId] as const,
  gigEquipmentConflicts: (gigId: string, orgId: string, when: { start: string; end: string; timezone?: string; allDay: boolean }) =>
    ['gig', gigId, 'equipmentConflicts', orgId, when.start, when.end, when.timezone ?? null, when.allDay] as const,
  /** refresh: a count the kit section bumps after each save, so the table reloads. */
  gigEquipmentNeeded: (gigId: string, orgId: string, when: { start: string; end: string; timezone?: string; allDay: boolean }, refresh: number) =>
    ['gig', gigId, 'equipmentNeeded', orgId, when.start, when.end, when.timezone ?? null, when.allDay, refresh] as const,
  /** Kits' flattened contents, for the same-gig overlap check. */
  kitsFlattenedSummary: (kitIds: readonly string[]) => ['kits', 'flattened', [...kitIds].sort().join(',')] as const,
  staffRoleNames: () => ['staffRoles', 'names'] as const,
  /** Whether the signed-in user is a platform Admin. */
  currentUserIsAdmin: (userId: string) => ['currentUser', userId, 'isAdmin'] as const,

  // Dashboard
  dashboard: (orgId: string) => ['dashboard', orgId] as const,
  /** Recent activity across the signed-in person's organizations. */
  recentActivity: (userId: string) => ['activity', 'recent', userId] as const,

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

  // ── Import (A10, Engineer F) ──
  /** The items and kit names an assets file is matched against: under assets(orgId), so equipment changes reach it. */
  importCatalog: (orgId: string) => ['assets', orgId, 'importCatalog'] as const,

  // Gig participants
  gigParticipantContacts: (gigId: string, orgId: string) => ['gigParticipantContacts', gigId, orgId] as const,

  // Access requests (issue #33 cluster)
  orgAccessRequests: (orgId: string) => ['orgAccessRequests', orgId] as const,
  /** The platform moderator queue, as the signed-in person may see it. */
  moderatorAccessRequests: (userId: string) => ['moderatorAccessRequests', userId] as const,
  moderatorAccessRequestsAll: () => ['moderatorAccessRequests'] as const,

  // Generic notification feed (issue #52) — powers the notification bell.
  notifications: (userId: string) => ['notifications', userId] as const,
  // ── Organizations and settings (A10, Engineer O) ──
  organizationPermissions: (orgId: string, userId: string) => ['organizationPermissions', orgId, userId] as const,
  adminOrganizations: (userId: string) => ['adminOrganizations', userId] as const,
  organizationSearch: (search: string, type?: string) => ['organizationSearch', search, type ?? null] as const,
  userSelectorSearch: (userId: string, search: string, orgIds?: string[]) => ['userSelectorSearch', userId, search, orgIds ?? null] as const,
  myPendingAccessRequests: (userId: string) => ['myPendingAccessRequests', userId] as const,
  emailConfirmed: (userId: string) => ['emailConfirmed', userId] as const,
  twoFactorStatus: (userId: string) => ['twoFactorStatus', userId] as const,
  calendarSettings: (userId: string) => ['calendarSettings', userId] as const,
  googleCalendars: (userId: string) => ['googleCalendars', userId] as const,
  calendarSyncData: (userId: string) => ['calendarSyncData', userId] as const,

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
  // Kit views, all under kit(kitId) so a kit change reaches them.
  kitDetail: (kitId: string) => ['kit', kitId, 'detail'] as const,
  kitForm: (kitId: string) => ['kit', kitId, 'form'] as const,
  kitActivity: (kitId: string) => ['kit', kitId, 'activity'] as const,
  kitFlattenedSummary: (kitId: string) => ['kit', kitId, 'flattenedSummary'] as const,
  /** The kit editor's items, with container pieces counted without the kit being edited. */
  kitEditorItems: (orgId: string, kitId: string | null | undefined) =>
    ['assets', orgId, 'items', 'forKit', kitId ?? 'new'] as const,
  /** The kit editor's picker: units, kits and their flattened contents for one search. */
  kitPicker: (
    orgId: string,
    params: { kitId: string | null | undefined; filter: string; search: string; inKitIds: readonly string[] },
  ) => ['kits', orgId, 'picker', { ...params, kitId: params.kitId ?? null, inKitIds: [...params.inKitIds].sort() }] as const,

  // ── Mobile (A10, Engineer O) ──
  // The gig keys extend the shared gig keys, so a write that invalidates gigs(org) or gig(id)
  // refreshes the mobile copies too.
  mobileGigs: (orgId: string) => ['gigs', orgId, 'mobile'] as const,
  mobileGig: (gigId: string) => ['gig', gigId, 'mobile'] as const,
  myUpcomingAssignments: (userId: string, orgId: string) => ['myUpcomingAssignments', userId, orgId] as const,
  myDevices: (userId: string) => ['myDevices', userId] as const,
} as const;

// ── Organizations and settings (A10, Engineer O) ──

/**
 * After an organization is created or edited: the edit permissions (that organization's, or all
 * when it is new), the admin list and any open organization search.
 */
export function invalidateAfterOrganizationChange(queryClient: QueryClient, { organizationId }: { organizationId?: string } = {}) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: organizationId ? ['organizationPermissions', organizationId] : ['organizationPermissions'] }),
    queryClient.invalidateQueries({ queryKey: ['adminOrganizations'] }),
    queryClient.invalidateQueries({ queryKey: ['organizationSearch'] }),
  ]);
}

/** After an organization is deleted: the admin list and any open organization search. */
export function invalidateAfterOrganizationListChange(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['adminOrganizations'] }),
    queryClient.invalidateQueries({ queryKey: ['organizationSearch'] }),
  ]);
}

/**
 * After a member is removed: the team list only. The removed member's own detail (under the same
 * team key) would fail to refetch.
 */
export function invalidateAfterTeamListChange(queryClient: QueryClient, { organizationId }: { organizationId: string }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.team(organizationId), exact: true });
}

/** After a request to join: marked stale only (the screen adds it to the cache itself). */
export function invalidateAfterAccessRequestChange(queryClient: QueryClient, { userId }: { userId: string }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.myPendingAccessRequests(userId), refetchType: 'none' });
}

/** After two-factor sign-in is set up or turned off. */
export function invalidateAfterTwoFactorChange(queryClient: QueryClient, { userId }: { userId: string }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.twoFactorStatus(userId) });
}

/** After calendar sync is turned on: the calendar list and the sync status. */
export function invalidateAfterCalendarEnabledChange(queryClient: QueryClient, { userId }: { userId: string }) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.googleCalendars(userId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.calendarSyncData(userId) }),
  ]);
}

/** After a sync run (or the refresh button): the sync status. */
export function invalidateAfterCalendarSyncChange(queryClient: QueryClient, { userId }: { userId: string }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.calendarSyncData(userId) });
}

// ── Mobile (A10, Engineer O) ──
// A gig's status, details or a new gig: invalidateAfterGigChange / invalidateAfterGigListChange.

/**
 * After accept/decline on a staff assignment. On the gig: reload the gig. My Schedule is only
 * marked stale (refetched on its next visit): offline the service answers with the device copy,
 * which would undo the change on screen.
 */
export function invalidateAfterAssignmentChange(queryClient: QueryClient, { gigId }: { gigId?: string } = {}) {
  return Promise.all([
    ...(gigId ? [queryClient.invalidateQueries({ queryKey: queryKeys.gig(gigId) })] : []),
    queryClient.invalidateQueries({ queryKey: ['myUpcomingAssignments'], refetchType: 'none' }),
  ]);
}

/** After a device is enrolled or removed for biometric unlock. */
export function invalidateAfterDeviceChange(queryClient: QueryClient, { userId }: { userId: string }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.myDevices(userId) });
}

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

/**
 * After staff slots or assignments change (saved, finalized, un-finalized): the gig's money
 * figures (profitability summary and projected staff costs) and the dashboard.
 */
export function invalidateAfterStaffingChange(
  queryClient: QueryClient,
  { gigId, organizationId }: { gigId: string; organizationId: string },
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.gigFinancialsSummary(gigId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.gigProjectedStaff(gigId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.financials(gigId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(organizationId) }),
  ]);
}

// ── Import (A10, Engineer F) ──

/**
 * After an assets file's purchases are imported: equipment (with the items and kits the next file
 * is matched against), kits, purchases, the tax report and the dashboard.
 */
export function invalidateAfterAssetImport(queryClient: QueryClient, organizationId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.kits(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.purchases(organizationId) }),
    // The Financials tax report (queryKeys.taxReport, A10 Financials).
    queryClient.invalidateQueries({ queryKey: ['taxReport', organizationId] }),
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
