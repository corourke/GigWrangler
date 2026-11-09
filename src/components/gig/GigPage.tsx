import { useCallback, useEffect, useState } from 'react';
import { Copy, LogOut, Loader2, MoreVertical, PauseCircle, Pencil, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import AppHeader from '../AppHeader';
import AttachmentManager from '../AttachmentManager';
import MarkdownContent from '../MarkdownContent';
import ActivityFeed from '../ActivityFeed';
import { ConflictWarning } from '../ConflictWarning';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tabs, TabsContent } from '../ui/tabs';
import { PageHeader } from '../layout/PageHeader';
import { PageTabsList, PageTabsTrigger } from '../layout/PageTabs';
import GigFinancialsSection from './GigFinancialsSection';
import GigKitAssignmentsSection from './GigKitAssignmentsSection';
import EquipmentNeededTable from './EquipmentNeededTable';
import NotReturnedSection from './NotReturnedSection';
import GigParticipantsSection from './GigParticipantsSection';
import GigStaffSlotsSection from './GigStaffSlotsSection';
import GigEquipmentTable from './view/GigEquipmentTable';
import GigParticipantsTable from './view/GigParticipantsTable';
import GigScheduleView from './view/GigScheduleView';
import GigSection from './view/GigSection';
import GigStaffingTable from './view/GigStaffingTable';
import GigVenueCard from './view/GigVenueCard';
import OrganizationDetailsDialog from './view/OrganizationDetailsDialog';
import GigPrintSheet from './print/GigPrintSheet';
import { PackingList } from '../inventory/InventoryReports';
import { loadPackingColumns, savePackingColumns, type PackingColumn } from '../../utils/packingColumns';
import { GigStatusField, GigTagsField, GigTitleField } from './basicInfo/GigBasicInfoFields';
import { EditSaveStatus, GigEditForm, NotesCard, WhenAndScheduleCard } from './edit/GigEditParts';
import { useEditSession } from '../../utils/hooks/editSession';
import { EditSessionProvider } from '../../utils/hooks/EditSessionProvider';
import { countChildGigs, deleteGig, duplicateGig, getGig } from '../../services/gig.service';
import { getGigActivity } from '../../services/activityLog.service';
import { checkAllConflicts, type Conflict } from '../../services/conflictDetection.service';
import { canManage } from '../../utils/permissions';
import { deleteGigBlockedReason, gigOwnerName, inactiveBannerText, inactiveStaffEquipmentText, isInactiveOn, managesGigOwner, markInactiveConfirmText, offersMarkInactive } from '../../utils/gigOwnership';
import { removeGigParticipant, setGigParticipantInactive } from '../../services/gigParticipant.service';
import { GIG_STATUS_CONFIG } from '../../utils/supabase/constants';
import { formatDateTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import type { ActivityLogEntry, Gig, Organization, User, UserRole } from '../../utils/supabase/types';
import type { GigTab } from '../../routes/paths';
import { useLatestRequest } from '../../utils/hooks/useLatestRequest';

interface GigPageProps {
  gigId: string;
  organization: Organization;
  user: User;
  userRole?: UserRole;
  /** Open in edit mode (the `/gigs/:id/edit` route). Ignored for roles that can't edit. */
  initialEditing?: boolean;
  /** The open tab, when the URL decides it (`/gigs/:id/financials`). */
  tab?: GigTab;
  onTabChange?: (tab: GigTab) => void;
  onBack: () => void;
  backLabel?: string;
  onGigDeleted: () => void;
  onEditOrganization?: (org: Organization) => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

/**
 * The one gig page (#12): view mode for everyone, and a single page-wide edit
 * mode for Admins and Managers. Replaces GigDetailScreen and the separate
 * `/gigs/:id/edit` screen.
 */
export default function GigPage({
  gigId,
  organization,
  user,
  userRole,
  initialEditing = false,
  tab: tabProp,
  onTabChange,
  onBack,
  backLabel = 'Gigs',
  onGigDeleted,
  onEditOrganization,
  onSwitchOrganization,
  onLogout,
}: GigPageProps) {
  const canEdit = canManage(userRole);
  // #175: a parent gig can't be deleted; Delete says so (Cameron 10-13).
  const [childGigCount, setChildGigCount] = useState(0);
  const [deleteReasonShown, setDeleteReasonShown] = useState(false);
  const [gig, setGig] = useState<Gig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEditing && canEdit);
  const [localTab, setLocalTab] = useState<GigTab>('overview');
  const tab = tabProp ?? localTab;
  const setTab = (t: string) => (onTabChange ? onTabChange(t as GigTab) : setLocalTab(t as GigTab));
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [viewingOrg, setViewingOrg] = useState<Partial<Organization> | null>(null);
  // Every autosaving section in edit mode reports here: one save state, one flush (#12).
  const session = useEditSession();
  // Printing (#12): the sheet is rendered on request, and prints once its data has loaded.
  // What the Print menu asked for: the gig sheet (with or without financials) or the packing list (#39).
  const [printRequest, setPrintRequest] = useState<{ kind: 'sheet' | 'packing'; financials: boolean; n: number } | null>(null);
  const startPrint = (financials: boolean, kind: 'sheet' | 'packing' = 'sheet') =>
    setPrintRequest((r) => ({ kind, financials, n: (r?.n ?? 0) + 1 }));
  const printWhenReady = useCallback(() => window.print(), []);
  // The packing list's columns, kept here so its printout has the ones chosen on screen (#245).
  // Remembered in this browser too (Cameron, 10-11).
  const [packingColumns, setPackingColumns] = useState<ReadonlySet<PackingColumn>>(loadPackingColumns);
  const changePackingColumns = useCallback((next: Set<PackingColumn>) => {
    setPackingColumns(next);
    savePackingColumns(next);
  }, []);
  const [finishing, setFinishing] = useState(false);

  // A late answer for an earlier gig (or an earlier reload) is dropped (B12).
  const startGigRequest = useLatestRequest();
  const loadGig = useCallback(async () => {
    const isCurrent = startGigRequest();
    setLoadError(null);
    try {
      const data = await getGig(gigId);
      if (!isCurrent()) return;
      setGig(data);
      countChildGigs(gigId).then((n) => { if (isCurrent()) setChildGigCount(n); }).catch(() => { if (isCurrent()) setChildGigCount(0); });
      checkAllConflicts(gigId, data.start, data.end, data.timezone, organization.id, isGigAllDay(data))
        .then((r) => { if (isCurrent()) setConflicts(r.conflicts); }).catch(() => {});
    } catch (error: any) {
      if (isCurrent()) setLoadError(error.message || 'Failed to load this gig.');
    }
  }, [gigId, organization.id, startGigRequest]);

  useEffect(() => { loadGig(); }, [loadGig]);

  useEffect(() => {
    if (tab !== 'history') return;
    let cancelled = false;
    setActivityLoading(true);
    getGigActivity(gigId)
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity([]); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
  }, [tab, gigId]);

  // Staff and Viewers never see financials (#12); keep them off that tab.
  useEffect(() => { if (!canEdit && tab === 'financials') setTab('overview'); }, [canEdit, tab]);

  // Done waits for every pending save, so nothing typed just before is lost.
  const finishEditing = async () => {
    setFinishing(true);
    await session.flushAll();
    setFinishing(false);
    setEditing(false);
    loadGig();
  };

  const handleDuplicate = async () => {
    try {
      await duplicateGig(gigId);
      toast.success('Gig duplicated');
      onBack();
    } catch (error: any) {
      toast.error(error.message || 'Failed to duplicate gig');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${gig?.title}"? This can't be undone.`)) return;
    try {
      await deleteGig(gigId);
      toast.success('Gig deleted');
      onGigDeleted();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete gig');
    }
  };

  // #175: another participant leaves the gig. The database refuses while the organization has
  // staff or equipment on it (release them first) or financial records (mark it Inactive instead).
  const markInactive = async () => {
    try {
      await setGigParticipantInactive(gigId, organization.id, true);
      toast.success(`${organization.name} is Inactive on this gig`);
      await loadGig();
    } catch (error: any) {
      toast.error(error.message || 'Failed to mark Inactive');
    }
  };

  const handleLeave = async () => {
    if (!confirm(
      `Leave "${gig?.title}"? ${organization.name} is removed from the gig, with its equipment scans and contacts for it, ` +
      `and its purchases are unlinked from it. You won't see the gig afterwards.`,
    )) return;
    try {
      await removeGigParticipant(gigId, organization.id);
      toast.success(`${organization.name} left the gig`);
      onBack();
    } catch (error: any) {
      const message: string = error?.message || 'Failed to leave the gig';
      if (offersMarkInactive(message, inactiveHere)) {
        if (confirm(`${message}\n\n${markInactiveConfirmText(organization.name)}`)) {
          await markInactive();
        }
        return;
      }
      toast.error(message);
    }
  };

  const handleMarkInactive = async () => {
    if (!confirm(markInactiveConfirmText(organization.name))) return;
    await markInactive();
  };

  // An organization Inactive on the gig reactivates itself (#175).
  const handleReactivate = async () => {
    try {
      await setGigParticipantInactive(gigId, organization.id, false);
      toast.success(`${organization.name} is active on this gig again`);
      await loadGig();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reactivate');
    }
  };

  const shell = (children: React.ReactNode, printSheet?: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50">
      <div className="no-print">
        <AppHeader
          organization={organization}
          user={user}
          userRole={userRole}
          currentRoute="gig-detail"
          onSwitchOrganization={onSwitchOrganization}
          onLogout={onLogout}
        />
        {children}
      </div>
      {printSheet}
    </div>
  );

  const back = { label: `Back to ${backLabel}`, onClick: onBack };

  if (loadError) {
    return shell(
      <>
        <PageHeader back={back} title="Gig" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
        <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
        <Button variant="outline" onClick={loadGig}>Retry</Button>
        </div>
      </>,
    );
  }

  if (!gig) {
    return shell(
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-sky-600" aria-label="Loading gig" />
      </div>,
    );
  }

  const participants = (gig.participants ?? []) as any[];
  const venue = participants.find((p) => p.role === 'Venue')?.organization ?? null;
  const acts = participants.filter((p) => p.role === 'Act');
  const actNames = Object.fromEntries(acts.map((p) => [p.id, p.organization?.name ?? '']));
  const ownSlots = (gig.staff_slots ?? []).filter((s) => s.organization_id === organization.id);
  const participantOrgIds = [organization.id, ...participants.map((p) => p.organization_id)];
  const status = GIG_STATUS_CONFIG[gig.status];
  // #175: the owner's Admins and Managers change the status and duplicate the gig. An
  // organization Inactive on the gig is read-only on its shared details and schedule.
  const ownsGig = managesGigOwner(gig, organization.id, userRole);
  const ownerName = gigOwnerName(gig);
  const inactiveHere = isInactiveOn(gig, organization.id);
  // Another participant (not the owner) leaves, or marks itself Inactive.
  const onGig = participants.some((p) => p.organization_id === organization.id);
  const canLeave = canEdit && onGig && gig.owner_organization_id !== organization.id;
  // Delete stays in the menu; when it would be refused it's disabled with its reason (Cameron 10-13).
  const deleteBlocked = deleteGigBlockedReason(gig, organization.id, userRole, childGigCount);
  const showMoreActions = canEdit;

  const page = (
    <Tabs value={tab} onValueChange={setTab} activationMode="manual" className="gap-0">
      {/* #39: one header for view and edit; edit mode recolours the band. */}
      <PageHeader
        className={editing ? 'bg-sky-50 border-b-2 border-sky-700' : undefined}
        back={back}
        title={gig.title}
        badge={status && <Badge className={`${status.color} border`}>{status.label}</Badge>}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {formatDateTimeDisplay(gig.start, gig.end, gig.timezone, isGigAllDay(gig))}
              {venue?.name ? ` · ${venue.name}` : ''}
            </span>
            {ownerName && <span>Owned by {ownerName}</span>}
            {gig.tags.map((t) => <Badge key={t} variant="secondary" className="font-medium">{t}</Badge>)}
          </span>
        }
        heading={editing ? (
          <div className="flex flex-col gap-2 min-w-0" data-gig-header>
            <div className="flex items-center gap-2.5 flex-wrap">
              <GigTitleField variant="header" disabled={inactiveHere} />
              <GigStatusField variant="header" disabled={inactiveHere || !ownsGig} />
            </div>
            <GigTagsField variant="header" disabled={inactiveHere} />
          </div>
        ) : undefined}
        actions={(canEdit || !editing) ? (
          <>
            {!editing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline"><Printer className="w-4 h-4 mr-1.5" />Print</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => startPrint(false)}>Gig sheet</DropdownMenuItem>
                  {canEdit && <DropdownMenuItem onSelect={() => startPrint(true)}>Gig sheet with financials</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => startPrint(false, 'packing')}>Packing list</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!canEdit ? null : editing ? (
              <>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-sky-800">Editing</span>
                <EditSaveStatus state={session.state} />
                <Button onClick={finishEditing} disabled={finishing} className="bg-sky-700 hover:bg-sky-800 text-white">Done</Button>
              </>
            ) : (
              <>
                {showMoreActions && (
                  <DropdownMenu onOpenChange={(open) => { if (!open) setDeleteReasonShown(false); }}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" aria-label="More actions"><MoreVertical className="w-4 h-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ownsGig && <DropdownMenuItem onClick={handleDuplicate}><Copy className="w-4 h-4 mr-2" />Duplicate Gig</DropdownMenuItem>}
                      {canLeave && !inactiveHere && (
                        <DropdownMenuItem onClick={handleMarkInactive}><PauseCircle className="w-4 h-4 mr-2" />Mark Inactive</DropdownMenuItem>
                      )}
                      {canLeave && (
                        <DropdownMenuItem onClick={handleLeave} className="text-red-600 focus:text-red-600">
                          <LogOut className="w-4 h-4 mr-2" />Leave Gig
                        </DropdownMenuItem>
                      )}
                      {deleteBlocked ? (
                        <>
                          {/* Not `disabled`: a disabled item gets no clicks or taps, so the reason couldn't be reached on touch. */}
                          <DropdownMenuItem
                            aria-disabled="true"
                            title={deleteBlocked}
                            className="text-gray-400 focus:text-gray-500"
                            onSelect={(e) => { e.preventDefault(); setDeleteReasonShown(true); }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />Delete Gig
                          </DropdownMenuItem>
                          {deleteReasonShown && (
                            <p role="note" className="max-w-[16rem] px-2 pb-2 text-xs text-gray-600">{deleteBlocked}</p>
                          )}
                        </>
                      ) : (
                        <DropdownMenuItem onClick={handleDelete} className="text-red-600 focus:text-red-600">
                          <Trash2 className="w-4 h-4 mr-2" />Delete Gig
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button onClick={() => setEditing(true)} className="bg-sky-700 hover:bg-sky-800 text-white">
                  <Pencil className="w-4 h-4 mr-1.5" />Edit
                </Button>
              </>
            )}
          </>
        ) : undefined}
        tabs={
          <PageTabsList aria-label="Gig sections">
            {[
              ['overview', 'Overview'],
              ['equipment', 'Equipment'],
              ...(canEdit ? [['financials', 'Financials']] : []),
              ['history', 'History'],
            ].map(([value, label]) => (
              <PageTabsTrigger key={value} value={value}>{label}</PageTabsTrigger>
            ))}
          </PageTabsList>
        }
      />

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {inactiveHere && (
          <Alert className="mb-4 bg-gray-100 border-gray-300 text-gray-700">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {inactiveBannerText(organization.name)}
              </span>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={handleReactivate}>Reactivate</Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {conflicts.length > 0 && <div className="mb-4"><ConflictWarning conflicts={conflicts} showAsCard /></div>}

          <TabsContent value="overview" className="mt-0">
            {editing ? (
              <div className="space-y-4">
                <WhenAndScheduleCard
                  gigId={gigId}
                  gigStart={gig.start}
                  actParticipants={acts.map((p) => ({ id: p.id, organization: p.organization }))}
                  readOnly={inactiveHere}
                  scheduleView={<GigScheduleView entries={gig.schedule_entries ?? []} timeZone={gig.timezone} actNames={actNames} />}
                />
                <GigParticipantsSection
                  gigId={gigId}
                  currentOrganizationId={organization.id}
                  currentOrganizationName={organization.name}
                  currentOrganizationRole={organization.roles?.[0] || 'Production'}
                  currentOrganizationRoles={organization.roles}
                  onEditOrganization={onEditOrganization}
                  userRole={userRole}
                />
                {/* #175: an Inactive organization adds no staff or equipment; it has released them. */}
                {inactiveHere ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{inactiveStaffEquipmentText(organization.name)}</p>
                    <GigStaffingTable slots={ownSlots} showAmounts={canEdit} gig={gig} />
                  </div>
                ) : (
                  <GigStaffSlotsSection gigId={gigId} currentOrganizationId={organization.id} participantOrganizationIds={participantOrgIds} />
                )}
                <NotesCard organizationId={organization.id} gigId={gigId} readOnly={inactiveHere} />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                <div className="lg:col-span-2">
                  <GigScheduleView entries={gig.schedule_entries ?? []} timeZone={gig.timezone} actNames={actNames} />
                </div>
                <GigVenueCard gigId={gigId} venue={venue} />
                <GigSection title="Notes & attachments" className="lg:col-span-3">
                  {gig.notes ? (
                    <div className="text-sm prose prose-sm max-w-none"><MarkdownContent>{gig.notes}</MarkdownContent></div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No notes</p>
                  )}
                  <AttachmentManager organizationId={organization.id} entityType="gig" entityId={gigId} title="" allowUpload={false} />
                </GigSection>
                <div className="lg:col-span-3">
                  <GigParticipantsTable
                    gigId={gigId}
                    participants={participants}
                    currentOrganizationId={organization.id}
                    onViewOrganization={setViewingOrg}
                  />
                </div>
                <div className="lg:col-span-3">
                  <GigStaffingTable slots={ownSlots} showAmounts={canEdit} gig={gig} />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="equipment" className="mt-0">
            {editing && !inactiveHere ? (
              <GigKitAssignmentsSection
                gigId={gigId}
                currentOrganizationId={organization.id}
                gigStart={gig.start}
                gigEnd={gig.end}
                gigTimezone={gig.timezone}
                gigAllDay={isGigAllDay(gig)}
              />
            ) : (
              <div className="space-y-4">
                {editing && <p className="text-sm text-muted-foreground">{inactiveStaffEquipmentText(organization.name)}</p>}
                <GigEquipmentTable gigId={gigId} organizationId={organization.id} showAmounts={canEdit} />
                <EquipmentNeededTable gigId={gigId} gigStart={gig.start} gigEnd={gig.end} gigTimezone={gig.timezone} gigAllDay={isGigAllDay(gig)} organizationId={organization.id} />
                <NotReturnedSection organizationId={organization.id} gigId={gigId} gigEnd={gig.end} canEdit={canEdit} />
                {/* The packing list moved here from Equipment › Inventory › Reports (#39). */}
                <GigSection title="Packing list">
                  <PackingList
                    organizationId={organization.id}
                    organizationName={organization.name}
                    gig={{ id: gig.id, title: gig.title, start: gig.start, timezone: gig.timezone } as any}
                    hidePrintButton
                    columns={packingColumns}
                    onColumnsChange={changePackingColumns}
                  />
                </GigSection>
              </div>
            )}
          </TabsContent>

          {canEdit && (
            <TabsContent value="financials" className="mt-0">
              <GigFinancialsSection
                gigId={gigId}
                currentOrganizationId={organization.id}
                userRole={userRole}
                gigStartDate={gig.start?.substring(0, 10)}
                gigStart={gig.start}
                gigTimezone={gig.timezone}
                gigEnd={gig.end}
                editing={editing}
              />
            </TabsContent>
          )}

          <TabsContent value="history" className="mt-0">
            <GigSection title="History">
              <ActivityFeed entries={activity} isLoading={activityLoading} />
            </GigSection>
          </TabsContent>
      </main>

      <OrganizationDetailsDialog organization={viewingOrg} onClose={() => setViewingOrg(null)} />
    </Tabs>
  );

  const printSheet = printRequest && (
    <div className="print-only hidden">
      {printRequest.kind === 'packing' ? (
        <PackingList
          key={printRequest.n}
          organizationId={organization.id}
          organizationName={organization.name}
          gig={{ id: gig.id, title: gig.title, start: gig.start, timezone: gig.timezone } as any}
          hidePrintButton
          onLoaded={printWhenReady}
          columns={packingColumns}
        />
      ) : (
        <GigPrintSheet
          key={printRequest.n}
          gig={gig}
          organization={organization}
          slots={ownSlots}
          includeFinancials={canEdit && printRequest.financials}
          onReady={printWhenReady}
        />
      )}
    </div>
  );

  return shell(
    editing ? (
      <EditSessionProvider session={session}>
        <GigEditForm gigId={gigId} gig={gig}>{page}</GigEditForm>
      </EditSessionProvider>
    ) : page,
    printSheet,
  );
}
