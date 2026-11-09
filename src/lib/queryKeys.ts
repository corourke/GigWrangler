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
  // Gigs
  gigs: (orgId: string) => ['gigs', orgId] as const,
  gig: (gigId: string) => ['gig', gigId] as const,

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
  // --- Organizations and settings (A10, Engineer O) ---
  organizationPermissions: (orgId: string, userId: string) => ['organizationPermissions', orgId, userId] as const,
  adminOrganizations: (userId: string) => ['adminOrganizations', userId] as const,
  organizationSearch: (search: string, type?: string) => ['organizationSearch', search, type ?? null] as const,
  userSelectorSearch: (search: string, orgIds?: string[]) => ['userSelectorSearch', search, orgIds ?? null] as const,
  myPendingAccessRequests: (userId: string) => ['myPendingAccessRequests', userId] as const,
  emailConfirmed: (userId: string) => ['emailConfirmed', userId] as const,
  twoFactorStatus: () => ['twoFactorStatus'] as const,
  calendarSettings: (userId: string) => ['calendarSettings', userId] as const,
  googleCalendars: (userId: string) => ['googleCalendars', userId] as const,
  calendarSyncData: (userId: string) => ['calendarSyncData', userId] as const,
} as const;

/** One cache refresh: the key prefix, and how (react-query invalidateQueries filters). */
export interface Invalidation {
  queryKey: readonly unknown[];
  exact?: boolean;
  refetchType?: 'active' | 'inactive' | 'all' | 'none';
}

/**
 * Invalidation map — Organizations and settings (A10, Engineer O): which caches each write
 * refreshes. Hooks pass every entry to queryClient.invalidateQueries.
 */
export const orgSettingsInvalidations = {
  /** Create or edit: the edit permissions, the admin list and any open org search. */
  organizationSaved: (orgId?: string): Invalidation[] => [
    { queryKey: orgId ? ['organizationPermissions', orgId] : ['organizationPermissions'] },
    { queryKey: ['adminOrganizations'] },
    { queryKey: ['organizationSearch'] },
  ],
  organizationDeleted: (): Invalidation[] => [
    { queryKey: ['adminOrganizations'] },
    { queryKey: ['organizationSearch'] },
  ],
  /** Only the team list: the removed member's own detail would fail to refetch. */
  memberRemoved: (orgId: string): Invalidation[] => [{ queryKey: queryKeys.team(orgId), exact: true }],
  /** The request is added to the cache on success; mark it stale so the next visit refetches. */
  accessRequested: (userId: string): Invalidation[] => [
    { queryKey: queryKeys.myPendingAccessRequests(userId), refetchType: 'none' },
  ],
  twoFactorChanged: (): Invalidation[] => [{ queryKey: queryKeys.twoFactorStatus() }],
  /** Turning calendar sync on reloads the calendar list and the sync status. */
  calendarEnabled: (userId: string): Invalidation[] => [
    { queryKey: queryKeys.googleCalendars(userId) },
    { queryKey: queryKeys.calendarSyncData(userId) },
  ],
  /** After a sync run (or the refresh button): the sync status. */
  calendarSynced: (userId: string): Invalidation[] => [{ queryKey: queryKeys.calendarSyncData(userId) }],
} as const;
