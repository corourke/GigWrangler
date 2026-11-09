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

  // --- A10 Equipment (items, units and lots, kits) ---
  // Every item page, for invalidation (an item page lists its units and the kits that use it).
  allEquipmentItems: () => ['equipmentItem'] as const,
  // Every unit or lot page, for invalidation (an item edit renames its units).
  allAssets: () => ['asset'] as const,
  // The Items list: items with their units and lots, and the pieces in container kits.
  equipmentItems: (orgId: string) => ['equipmentItems', orgId] as const,
  // An item page: the item, its pieces in containers, its kit lines and where its pieces are.
  equipmentItem: (itemId: string, orgId: string) => ['equipmentItem', itemId, orgId] as const,
  assetTrackingSummary: (orgId: string) => ['assetTrackingSummary', orgId] as const,
  assetActivity: (assetId: string) => ['assetActivity', assetId] as const,
  lockedTaxYears: (orgId: string) => ['lockedTaxYears', orgId] as const,
} as const;

type Key = readonly unknown[];

/**
 * Invalidates each key an invalidation-map entry returns. Keys in `markOnly` are marked stale
 * without refetching now (a list that has just written an inline edit into its own cache).
 */
export function invalidateKeys(
  client: QueryClient,
  keys: readonly Key[],
  options: { markOnly?: readonly Key[] } = {},
): Promise<void> {
  const markOnly = new Set((options.markOnly ?? []).map((k) => JSON.stringify(k)));
  return Promise.all(
    keys.map((queryKey) =>
      client.invalidateQueries({ queryKey, ...(markOnly.has(JSON.stringify(queryKey)) ? { refetchType: 'none' as const } : {}) }),
    ),
  ).then(() => undefined);
}

/**
 * A10 Equipment invalidation map: the caches a write can make stale. A mutation's onSuccess
 * invalidates every key its entry returns (prefix match, so a list key also covers its children).
 */
export const equipmentInvalidation = {
  /** A unit or lot was added, changed, duplicated, deleted, written off or brought back. */
  asset: (orgId: string, assetId?: string): Key[] => [
    queryKeys.equipmentItems(orgId),
    queryKeys.assets(orgId),
    queryKeys.assetTrackingSummary(orgId),
    queryKeys.allEquipmentItems(),
    queryKeys.kits(orgId),
    ...(assetId
      ? [queryKeys.asset(assetId), queryKeys.assetActivity(assetId), queryKeys.assetInventoryTracking(assetId)]
      : []),
  ],
  /**
   * An item's shared fields changed (they are copied to its units and lots). The item page that
   * made the edit writes it into its own cache instead, so the open form isn't refetched under it.
   */
  item: (orgId: string): Key[] => [
    queryKeys.equipmentItems(orgId),
    queryKeys.assets(orgId),
    queryKeys.allAssets(),
    queryKeys.kits(orgId),
  ],
  /** A kit was created, changed, duplicated or deleted. */
  kit: (orgId: string, kitId?: string): Key[] => [
    queryKeys.kits(orgId),
    ...(kitId ? [queryKeys.kit(kitId)] : []),
    queryKeys.allEquipmentItems(),
  ],
};
