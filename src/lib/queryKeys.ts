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
  /** The organization's gigs. */
  gigList: (orgId: string) => ['gigs', orgId, 'list'] as const,
  /** The conflicts among the list's recent and upcoming gigs, loaded after the list (#453). */
  gigListConflicts: (orgId: string) => ['gigs', orgId, 'list', 'conflicts'] as const,
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
  /** Refreshed after the gig's kits save (invalidateAfterGigKitsChange), not by a reload token. */
  gigEquipmentNeeded: (gigId: string, orgId: string, when: { start: string; end: string; timezone?: string; allDay: boolean }) =>
    ['gig', gigId, 'equipmentNeeded', orgId, when.start, when.end, when.timezone ?? null, when.allDay] as const,
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
  /** The receipts this person queued from the phone in the last week (mobile receipt capture). */
  myRecentReceipts: (orgId: string, userId: string) => ['purchases', orgId, 'scanQueue', 'mine', userId] as const,
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
  // Lookups the equipment forms and pickers read (A10 sweep).
  /** Types used in a category, with how often. */
  typeUsage: (orgId: string, category: string) => ['assets', orgId, 'typeUsage', category] as const,
  /** Distinct values of a field in use, for autocomplete. */
  distinctValues: (orgId: string, table: 'assets' | 'kits', field: string, category?: string) =>
    [table, orgId, 'distinct', field, category ?? null] as const,
  locationSuggestions: (orgId: string) => ['assets', orgId, 'locationSuggestions'] as const,
  /** One item on its own (getItem), e.g. the item a new unit is added to. */
  itemRecord: (itemId: string, orgId: string) => ['assets', orgId, 'item', itemId, 'record'] as const,
  /** When a unit or lot was first depreciated, if it was. */
  assetDepreciatedOn: (assetId: string) => ['asset', assetId, 'depreciatedOn'] as const,
  /** A record's attachments (a gig, purchase or unit). */
  entityAttachments: (entityType: string, entityId: string) => ['attachments', entityType, entityId] as const,
  /** A category list in Settings: an organization's, or the starter set (null). */
  categoryList: (kind: string, orgId: string | null) => ['purchases', orgId ?? 'starter', 'categories', kind, 'list'] as const,
  categoryUsage: (kind: string, orgId: string) => ['purchases', orgId, 'categories', kind, 'usage'] as const,
  scheduleCLines: () => ['scheduleCLines'] as const,
  /** The organization's gigs, for a gig picker. */
  gigsForOrganization: (orgId: string) => ['gigs', orgId, 'all'] as const,
  // Gig sections and the phone (A10 sweep).
  /** The gig as its basic info form reads it (fresh each open: it seeds an autosaving form). */
  gigForm: (gigId: string) => ['gig', gigId, 'form'] as const,
  /** The gig's schedule rows (fresh each open: they seed the schedule editor). */
  gigScheduleEntries: (gigId: string) => ['gig', gigId, 'schedule'] as const,
  /** The gig's participants as a list (getGigParticipants), e.g. its acts for the schedule. */
  gigParticipantList: (gigId: string) => ['gig', gigId, 'participantList'] as const,
  /** The gig page's Equipment card: { rows, holds } for this organization's view. */
  gigKits: (gigId: string, orgId: string) => ['gig', gigId, 'kits', orgId] as const,
  /** Whether the signed-in user has a device enrolled to unlock the phone with. */
  enrolledDevice: (userId: string) => ['myDevices', userId, 'enrolled'] as const,
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
  // Inventory: Maintenance, Locations, the reports and Not returned.
  maintenanceList: (orgId: string) => ['assets', orgId, 'maintenance'] as const,
  /** Where things are, for one set of Locations filters. */
  locationItems: (orgId: string, filters: Record<string, unknown>) => ['assets', orgId, 'locations', filters] as const,
  manifest: (orgId: string, params: { location: string; gigId: string | null }) => ['assets', orgId, 'manifest', params] as const,
  inventoryConflictFlags: (orgId: string) => ['assets', orgId, 'conflictFlags'] as const,
  /** The organization's items alone (no container pieces), for filters. */
  equipmentItemList: (orgId: string) => ['assets', orgId, 'items', 'list'] as const,
  itemWhereabouts: (itemId: string, orgId: string) => ['assets', orgId, 'item', itemId, 'whereabouts'] as const,
  reportGigs: (orgId: string, showAll: boolean) => ['gigs', orgId, 'reportPicker', { showAll }] as const,
  activeGigsWithTracking: (orgId: string) => ['gigs', orgId, 'activeWithTracking'] as const,
  gigReturns: (gigId: string, orgId: string) => ['gig', gigId, 'returns', orgId] as const,
  gigPackingList: (gigId: string, orgId: string) => ['gig', gigId, 'packingList', orgId] as const,

  // ── Mobile (A10, Engineer O) ──
  // The gig keys extend the shared gig keys, so a write that invalidates gigs(org) or gig(id)
  // refreshes the mobile copies too.
  mobileGigs: (orgId: string) => ['gigs', orgId, 'mobile'] as const,
  mobileGig: (gigId: string) => ['gig', gigId, 'mobile'] as const,
  myUpcomingAssignments: (userId: string, orgId: string) => ['myUpcomingAssignments', userId, orgId] as const,
  myDevices: (userId: string) => ['myDevices', userId] as const,
  // Push notifications: this browser, the person's devices, switches and lock-screen setting.
  pushSettings: (userId: string) => ['pushSettings', userId] as const,
  pushThisDevice: (userId: string) => ['pushSettings', userId, 'thisDevice'] as const,
  pushDevices: (userId: string) => ['pushSettings', userId, 'devices'] as const,
  pushPreferences: (userId: string) => ['pushSettings', userId, 'preferences'] as const,
  pushHideDetails: (userId: string) => ['pushSettings', userId, 'hideDetails'] as const,
  /** The gigs the Today tab chooses from (§3e): Staff's own, or the organization's. */
  todayGigs: (userId: string, orgId: string) => ['todayGigs', userId, orgId] as const,
  /** One gig's day-of-show sheet; under gig(gigId), so a change to the gig refreshes it. */
  dayOfShow: (gigId: string) => ['gig', gigId, 'dayOfShow'] as const,
  /** Which of its documents are saved on the phone (size and type by attachment id). */
  dayOfShowFiles: (gigId: string) => ['gig', gigId, 'dayOfShow', 'files'] as const,
  /** "Choose another gig" for the day sheet (#445): a person's own gigs, and the sheets on the phone. */
  myDaySheetGigs: (userId: string) => ['myDaySheetGigs', userId] as const,
  savedDaySheets: (userId: string) => ['savedDaySheets', userId] as const,
  /** Today's "Needs you" counts (#445). The role-filtered ones carry the user. */
  needsYouInvites: (userId: string) => ['needsYou', userId, 'invites'] as const,
  needsYouCrewSpots: (orgId: string) => ['needsYou', 'crewSpots', orgId] as const,
  needsYouAccessRequests: (userId: string, orgId: string) => ['needsYou', userId, 'accessRequests', orgId] as const,
  needsYouReceipts: (orgId: string) => ['needsYou', 'receipts', orgId] as const,
  needsYouPayments: (orgId: string) => ['needsYou', 'payments', orgId] as const,
  /** Keyed by the gigs it checks, so it runs again when the week's gigs change. */
  needsYouConflicts: (orgId: string, gigIds: string[]) => ['needsYou', 'conflicts', orgId, ...gigIds] as const,

  // ── Mobile inventory (A10, Engineer O) ──
  // Inventory Mode's packing list is local-first: the device copy, then the server's.
  packingList: (gigId: string) => ['packingList', gigId] as const,
  gigTitleOnDevice: (gigId: string) => ['packingList', gigId, 'title'] as const,
  orgIndex: (orgId: string) => ['orgIndex', orgId] as const,
  orgMemberNames: (orgId: string) => ['team', orgId, 'memberNames'] as const,
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
    queryClient.invalidateQueries({ queryKey: queryKeys.taxReport(organizationId) }),
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

/** After maintenance details change, or a record goes back to service: as for any unit or lot. */
export function invalidateAfterMaintenanceChange(
  queryClient: QueryClient,
  { organizationId, assetId }: { organizationId: string; assetId: string },
) {
  return invalidateAfterAssetChange(queryClient, { organizationId, assetId });
}

/**
 * After pieces at a gig are marked returned, written off or brought back: that gig's Not returned
 * list and packing list, and everything a unit or lot change reaches.
 */
export function invalidateAfterGigReturnChange(
  queryClient: QueryClient,
  { organizationId, gigId, assetId }: { organizationId: string; gigId: string; assetId: string },
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [...queryKeys.gig(gigId), 'returns'] }),
    queryClient.invalidateQueries({ queryKey: [...queryKeys.gig(gigId), 'packingList'] }),
    invalidateAfterAssetChange(queryClient, { organizationId, assetId }),
  ]);
}

/**
 * After where something is was changed by hand (a tracking override): the organization's
 * equipment (Locations, manifests, tracking), its kits, the active gigs with their scans (Out on
 * gigs), and every gig's packing list.
 */
export function invalidateAfterTrackingChange(queryClient: QueryClient, { organizationId }: { organizationId: string }) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.assets(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activeGigsWithTracking(organizationId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.kits(organizationId) }),
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'gig' && q.queryKey[2] === 'packingList' }),
  ]);
}

// ── Sweep: equipment, settings, shared (A10, Engineer E) ──

/** After a file is attached to a record or taken off it: that record's attachments. */
export function invalidateAfterAttachmentChange(
  queryClient: QueryClient,
  { entityType, entityId }: { entityType: string; entityId: string },
) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.entityAttachments(entityType, entityId) });
}

/**
 * After a category is added or changed in Settings: every category list and picker of that
 * organization (or of the starter set). The list in `keepList`, which has just written the change
 * into its own cache, is only marked stale.
 */
export function invalidateAfterCategoryChange(
  queryClient: QueryClient,
  { organizationId }: { organizationId: string | null },
  { keepList }: { keepList?: readonly unknown[] } = {},
) {
  const root = ['purchases', organizationId ?? 'starter', 'categories'];
  if (!keepList) return queryClient.invalidateQueries({ queryKey: root });
  const kept = JSON.stringify(keepList);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keepList, exact: true, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: root, predicate: (q) => JSON.stringify(q.queryKey) !== kept }),
  ]);
}

// ── Sweep: gig, financials, mobile (A10, Engineer E) ──

/** After the gig's kits save: its Equipment needed, its Equipment card and its packing list. */
export function invalidateAfterGigKitsChange(queryClient: QueryClient, { gigId }: { gigId: string }) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: [...queryKeys.gig(gigId), 'equipmentNeeded'] }),
    queryClient.invalidateQueries({ queryKey: [...queryKeys.gig(gigId), 'kits'] }),
    queryClient.invalidateQueries({ queryKey: [...queryKeys.gig(gigId), 'packingList'] }),
  ]);
}
