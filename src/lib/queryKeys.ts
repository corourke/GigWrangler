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

  // ── Financials screens (A10, Engineer F) ─────────────────────────────────
  // The Purchases report: purchases, the lines already in a gig ledger, and each
  // purchase's first document (one load, as the screen shows them together).
  purchasesReport: (orgId: string) => ['purchases', orgId, 'report'] as const,
  /** A purchase as the editor loads it: lines, equipment, gig ledger rows, document. */
  purchaseForEdit: (purchaseId: string) => ['purchase', purchaseId, 'edit'] as const,
  /** A purchase's attached documents (the side panel's document view). */
  purchaseDocuments: (headerId: string) => ['purchase', headerId, 'documents'] as const,
  /** A signed link to a stored file. */
  attachmentUrl: (filePath: string) => ['attachmentUrl', filePath] as const,
  taxYears: (orgId: string) => ['taxYears', orgId] as const,
  lockedTaxYears: (orgId: string) => ['taxYears', orgId, 'locked'] as const,
  taxYearDepreciation: (orgId: string) => ['taxYearDepreciation', orgId] as const,
  taxReport: (orgId: string) => ['taxReport', orgId] as const,
  gigAccounting: (orgId: string) => ['gigAccounting', orgId] as const,
  /** The organization's gigs (id and title), e.g. to name a line's gig. */
  gigOptions: (orgId: string) => ['gigOptions', orgId] as const,
  /** The gig picker's options: gigs near a date, plus the chosen one. */
  gigPickerOptions: (orgId: string, aroundDate?: string | null, ensureGigId?: string | null) =>
    ['gigOptions', orgId, 'picker', aroundDate ?? null, ensureGigId ?? null] as const,
  expenseCategories: (orgId: string) => ['purchaseCategories', orgId, 'expense'] as const,
  equipmentCategories: (orgId: string) => ['purchaseCategories', orgId, 'equipment'] as const,
  equipmentCategoryPeriods: (orgId: string) => ['purchaseCategories', orgId, 'periods'] as const,
  /** The organization's items, as options for the purchase editor's equipment pop-up. */
  purchaseItemOptions: (orgId: string) => ['purchaseItemOptions', orgId] as const,
  /** The gig expenses that deleting these purchases or lines would remove (the delete confirm). */
  purchaseLinkedGigExpenses: (orgId: string, purchaseIds: readonly string[]) =>
    ['purchases', orgId, 'linkedGigExpenses', ...purchaseIds] as const,
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
 * Financials invalidation map (A10, Engineer F): after a write, the caches that
 * show what it changed. Pass each key to queryClient.invalidateQueries.
 */
export const financialsInvalidation = {
  /**
   * A purchase or one of its lines was written from the Purchases report: the
   * report, the purchase, the tax report, Gig Accounting, and the gigs whose
   * ledger it touched (all gigs when not known).
   */
  purchaseWritten: (orgId: string, opts: { purchaseId?: string; gigIds?: (string | null | undefined)[]; allGigs?: boolean } = {}) => [
    queryKeys.purchases(orgId),
    ...(opts.purchaseId ? [['purchase', opts.purchaseId] as const] : []),
    queryKeys.taxReport(orgId),
    queryKeys.gigAccounting(orgId),
    ...gigMoneyKeys(opts.gigIds, opts.allGigs),
  ],
  /**
   * Saved in the purchase editor. The report is left to its screen, which reads it
   * again when you go back to it (Add purchase and Scan invoices keep it hidden).
   */
  purchaseSaved: (orgId: string, opts: { purchaseId?: string; gigIds?: (string | null | undefined)[]; allGigs?: boolean } = {}) => [
    ...(opts.purchaseId ? [['purchase', opts.purchaseId] as const] : []),
    queryKeys.gigAccounting(orgId),
    ...gigMoneyKeys(opts.gigIds, opts.allGigs),
  ],
  /** A tax year locked or unlocked, or its Form 4562 figures saved. */
  taxYearWritten: (orgId: string) => [queryKeys.taxYears(orgId), queryKeys.taxYearDepreciation(orgId)],
  /** A document attached to a purchase. */
  purchaseDocumentAttached: (headerId: string) => [queryKeys.purchaseDocuments(headerId)],
};

function gigMoneyKeys(gigIds: (string | null | undefined)[] = [], allGigs = false): (readonly unknown[])[] {
  if (allGigs) return [['financials'], ['gigFinancialsSummary']];
  return [...new Set(gigIds.filter((g): g is string => !!g))]
    .flatMap((g) => [queryKeys.financials(g), queryKeys.gigFinancialsSummary(g)]);
}
