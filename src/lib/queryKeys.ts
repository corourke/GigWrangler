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
  currentUserIsAdmin: () => ['currentUser', 'isAdmin'] as const,

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

  // ── Financials (A10, Engineer F) ──
  // Everything about one organization's purchases sits under purchases(orgId), one purchase under
  // ['purchase', purchaseId], its filed years under taxYears(orgId).
  /** The Purchases report: purchases, the lines already in a gig ledger, each purchase's first document. */
  purchasesReport: (orgId: string) => ['purchases', orgId, 'report'] as const,
  /** The gig expenses that deleting these purchases or lines would remove (the delete confirm). */
  purchaseLinkedGigExpenses: (orgId: string, purchaseIds: readonly string[]) =>
    ['purchases', orgId, 'linkedGigExpenses', ...purchaseIds] as const,
  expenseCategories: (orgId: string) => ['purchases', orgId, 'categories', 'expense'] as const,
  equipmentCategories: (orgId: string) => ['purchases', orgId, 'categories', 'equipment'] as const,
  equipmentCategoryPeriods: (orgId: string) => ['purchases', orgId, 'categories', 'periods'] as const,
  /** The organization's items, as options for the purchase editor's equipment pop-up. */
  purchaseItemOptions: (orgId: string) => ['purchases', orgId, 'itemOptions'] as const,
  /** A purchase as the editor loads it: lines, equipment, gig ledger rows, document. */
  purchaseForEdit: (purchaseId: string, orgId: string) => ['purchase', purchaseId, 'edit', orgId] as const,
  /** A purchase's attached documents (the side panel's document view). */
  purchaseDocuments: (headerId: string) => ['purchase', headerId, 'documents'] as const,
  /** A signed link to a stored file. */
  attachmentUrl: (filePath: string) => ['attachmentUrl', filePath] as const,
  taxYears: (orgId: string) => ['taxYears', orgId] as const,
  lockedTaxYears: (orgId: string) => ['taxYears', orgId, 'locked'] as const,
  taxYearDepreciation: (orgId: string) => ['taxYears', orgId, 'depreciation'] as const,
  taxReport: (orgId: string) => ['taxReport', orgId] as const,
  /** Gig Accounting's summaries: under gigs(orgId), so a gig change reaches them too. */
  gigAccounting: (orgId: string) => ['gigs', orgId, 'accounting'] as const,
  /** The organization's gigs (id and title), e.g. to name a line's gig. */
  gigOptions: (orgId: string) => ['gigs', orgId, 'options'] as const,
  /** The gig picker's options: gigs near a date, plus the chosen one. */
  gigPickerOptions: (orgId: string, aroundDate?: string | null, ensureGigId?: string | null) =>
    ['gigs', orgId, 'options', 'picker', aroundDate ?? null, ensureGigId ?? null] as const,
  /** The Purchases side panel's views of a linked record. */
  purchasePanelAsset: (assetId: string) => ['asset', assetId, 'purchasePanel'] as const,
  purchasePanelGig: (gigId: string, orgId: string) => ['gig', gigId, 'purchasePanel', orgId] as const,

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

// ── Financials (A10, Engineer F) ──

type PurchaseChange = {
  organizationId: string;
  purchaseId?: string;
  /** The gigs whose ledger the change touched. */
  gigIds?: (string | null | undefined)[];
  /** The gigs aren't known (a delete, or an edit's ledger changes): every gig's money. */
  allGigs?: boolean;
};

/** A gig's money: its ledger, profitability summary and projected staff costs (all gigs when none named). */
function gigMoneyKeys(gigIds: (string | null | undefined)[] = [], allGigs = false): (readonly unknown[])[] {
  if (allGigs) return [['financials'], ['gigFinancialsSummary'], ['gigProjectedStaff']];
  return [...new Set(gigIds.filter((g): g is string => !!g))]
    .flatMap((g) => [queryKeys.financials(g), queryKeys.gigFinancialsSummary(g), queryKeys.gigProjectedStaff(g)]);
}

/**
 * After a gig's ledger changes from outside its page (a purchase line put on it, moved, cleared or
 * re-costed): those gigs' money figures (every gig's when not known) and the dashboard. Replaces
 * the old 'gig-financials-updated' window event (A10).
 */
export function invalidateAfterGigFinancialsChange(
  queryClient: QueryClient,
  { organizationId, gigIds, allGigs }: { organizationId: string; gigIds?: (string | null | undefined)[]; allGigs?: boolean },
) {
  return Promise.all([...gigMoneyKeys(gigIds, allGigs), queryKeys.dashboard(organizationId)]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/** The caches a purchase write reaches, besides the Purchases report (see the two helpers below). */
export function purchaseChangeKeys({ organizationId, purchaseId, gigIds, allGigs }: PurchaseChange): (readonly unknown[])[] {
  return [
    ...(purchaseId ? [['purchase', purchaseId] as const] : []),
    queryKeys.taxReport(organizationId),
    queryKeys.gigAccounting(organizationId),
    // Equipment tracked or changed from a purchase, and the dashboard's equipment and money figures.
    queryKeys.assets(organizationId),
    queryKeys.dashboard(organizationId),
    ...gigMoneyKeys(gigIds, allGigs),
  ];
}

const invalidateAll = (queryClient: QueryClient, keys: (readonly unknown[])[]) =>
  Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

/**
 * After a purchase or one of its lines is written from the Purchases report: everything about the
 * organization's purchases (the report), the purchase, the tax report, Gig Accounting, equipment,
 * the dashboard, and the gigs whose ledger it touched.
 */
export function invalidateAfterPurchaseChange(queryClient: QueryClient, change: PurchaseChange) {
  return invalidateAll(queryClient, [queryKeys.purchases(change.organizationId), ...purchaseChangeKeys(change)]);
}

/**
 * After a save in the purchase editor: as above, but the Purchases report is left to its screen,
 * which reads it again when you go back to it (Add purchase and Scan invoices keep it hidden).
 */
export function invalidateAfterPurchaseEditorSave(queryClient: QueryClient, change: PurchaseChange) {
  return invalidateAll(queryClient, purchaseChangeKeys(change));
}

/** After a document is attached to a purchase. */
export function invalidateAfterPurchaseDocumentChange(queryClient: QueryClient, headerId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.purchaseDocuments(headerId) });
}

/** After a tax year is locked or unlocked, or its Form 4562 figures saved: its years, filed years and figures. */
export function invalidateAfterTaxYearChange(queryClient: QueryClient, organizationId: string, options?: { cancelRefetch?: boolean }) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.taxYears(organizationId) }, options);
}
