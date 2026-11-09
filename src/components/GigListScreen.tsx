import { useState, useMemo, useCallback } from 'react';
import { useGigListFilters } from '../hooks/useGigListFilters';
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addDays } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar as DatePicker } from './ui/calendar';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  updateGig,
  duplicateGig,
  deleteGig,
} from '../services/gig.service';
import {
  buildExportRows,
  gigsToCsv,
  downloadGigCsv,
  gigExportFilename,
  formatExportDate,
  roundMoney,
  ZERO_GIG_EXPORT_AGGREGATES,
} from '../utils/gigExport';
import AppHeader from './AppHeader';
import { SmartDataTable, ColumnDef, RowAction } from './tables/SmartDataTable';
import { GigListEmptyState } from './gigs/GigListEmptyState';
import { ConflictWarning } from './ConflictWarning';
import { GigDateFilterDropdown } from './gigs/GigDateFilterDropdown';
import { applyDateFilter } from './gigs/gigDateFilter';
import { GigStatusFilterDropdown } from './gigs/GigStatusFilterDropdown';
import {
  Plus,
  Upload,
  Download,
  Calendar as CalendarIcon,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Organization, User, UserRole, GigStatus, Gig } from '../utils/supabase/types';
import { isGigPast } from '../utils/gigTimeframe';
import { GIG_STATUS_CONFIG, TAG_CONFIG } from '../utils/supabase/constants';
import { formatDateTimeDisplay, formatTimeDisplay, isGigAllDay } from '../utils/dateUtils';
import { canDeleteGig, canManage } from '../utils/permissions';
import { deleteGigBlockedReason, isInactiveOn, managesGigOwner } from '../utils/gigOwnership';
import { PageHeader } from './layout/PageHeader';
import { checkAllConflictsForGigs } from '../services/conflictDetection.service';
import { useGigListData } from './gigs/useGigListData';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

type ViewMode = 'list' | 'calendar';
type CalendarViewType = 'month' | 'week';

interface GigListScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  initialViewMode?: ViewMode;
  /** List or calendar, when the URL decides it (`/gigs` vs `/calendar`). */
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  onBack: () => void;
  onCreateGig: () => void;
  onViewGig: (gigId: string, fromCalendar?: boolean) => void;
  onEditGig: (gigId: string) => void;
  onNavigateToDashboard: () => void;
  onNavigateToGigs: () => void;
  onNavigateToAssets: () => void;
  onNavigateToImport?: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
  onEditProfile?: () => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: Gig;
}

const statusPillConfig: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.entries(GIG_STATUS_CONFIG).map(([key, cfg]) => [key, { label: cfg.label, color: cfg.color }])
);

const tagPillConfig: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.entries(TAG_CONFIG).map(([key, cfg]) => [key, { label: key, color: cfg.color }])
);

export default function GigListScreen({
  organization,
  user,
  userRole,
  initialViewMode = 'list',
  viewMode: viewModeProp,
  onViewModeChange,
  onBack,
  onCreateGig,
  onViewGig,
  onEditGig,
  onNavigateToDashboard,
  onNavigateToGigs,
  onNavigateToAssets,
  onNavigateToImport,
  onSwitchOrganization,
  onLogout,
  onEditProfile,
}: GigListScreenProps) {
  // A10: the list, its conflicts and the money totals come from react-query.
  const {
    gigs, conflicts, financialsByGigId, isLoading, error,
    reload: loadGigs, afterListChange, setGigs, setConflicts,
  } = useGigListData(organization.id);
  const [localViewMode, setLocalViewMode] = useState<ViewMode>(initialViewMode);
  const viewMode = viewModeProp ?? localViewMode;
  const setViewMode = (m: ViewMode) => (onViewModeChange ? onViewModeChange(m) : setLocalViewMode(m));
  const [gigTimeframe, setGigTimeframe] = useState<'upcoming' | 'past'>('upcoming');
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  // Rows the list table is actually showing (date/status filters + per-column
  // filters + sort applied). Fed by SmartDataTable's onFilteredDataChange; drives
  // the CSV export so it matches what's on screen.
  const [exportRows, setExportRows] = useState<Gig[]>([]);
  // Column ids the table is currently showing, in display order (Columns menu
  // toggles this). Fed by SmartDataTable's onVisibleColumnsChange; also drives
  // the export so exported columns match what's on screen.
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>([]);
  // Per-gig financial rollups (revenue/cost of staff/expenses/staff count) for
  // the optional financial columns and the export. Loaded alongside the gig
  // list so toggling those columns on is instant.
  const { futureDateFilter, setFutureDateFilter, pastDateFilter, setPastDateFilter, activeStatuses, setActiveStatuses } = useGigListFilters();

  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<CalendarViewType>('month');


  const canEdit = canManage(userRole);
  // Deleting a gig is Admin-only on the server (#175).
  const canDelete = canDeleteGig(userRole);
  // Money columns are Admin/Manager only: gig_financials RLS hides the figures
  // from Staff/Viewers, and they can't see staff pay either (#168).
  const showFinancials = canManage(userRole);

  const filteredGigs = useMemo(() => {
    let result = applyDateFilter(gigs, futureDateFilter, pastDateFilter);
    if (activeStatuses.length > 0) {
      result = result.filter((g) => activeStatuses.includes(g.status as GigStatus));
    }
    return result;
  }, [gigs, futureDateFilter, pastDateFilter, activeStatuses]);

  // Mirrors the mobile gig list's Upcoming/Past split (see MobileGigList.tsx)
  // so the web list separates future and past gigs the same way.
  const { upcomingGigs, pastGigs } = useMemo(() => {
    const now = new Date();
    const upcoming: Gig[] = [];
    const past: Gig[] = [];
    for (const gig of filteredGigs) {
      (isGigPast(gig, now) ? past : upcoming).push(gig);
    }
    return { upcomingGigs: upcoming, pastGigs: past };
  }, [filteredGigs]);

  const timeframeGigs = gigTimeframe === 'upcoming' ? upcomingGigs : pastGigs;

  const handleGigDuplicate = useCallback(async (gigId: string) => {
    try {
      await duplicateGig(gigId);
      toast.success('Gig duplicated successfully');
      void afterListChange();
    } catch (err: any) {
      console.error('Error duplicating gig:', err);
      toast.error(err.message || 'Failed to duplicate gig');
    }
  }, [afterListChange]);

  const handleGigDelete = useCallback(async (gigId: string) => {
    if (!confirm('Are you sure you want to delete this gig?')) return;

    const gigToDelete = gigs.find(g => g.id === gigId);
    if (gigToDelete) {
      setGigs(prev => prev.filter(g => g.id !== gigId));
      // Also optimistically remove any conflicts for this gig
      setConflicts(prev => prev.filter(c => c.gig_id !== gigId));
    }

    try {
      await deleteGig(gigId);
      toast.success('Gig deleted successfully');
      void afterListChange();
    } catch (err: any) {
      console.error('Error deleting gig:', err);
      toast.error(err.message || 'Failed to delete gig');
      if (gigToDelete) {
        setGigs(prev => [...prev, gigToDelete]);
        // Note: we don't easily know the old conflicts without another check,
        // but loadGigs would fix it if needed. For now just reload if it fails.
        loadGigs();
      }
    }
  }, [gigs, loadGigs, afterListChange, setGigs, setConflicts]);

  const handleRowUpdate = useCallback(async (id: string, updates: Partial<Gig>) => {
    const gig = gigs.find(g => g.id === id);
    if (!gig) return;

    const updatedGigs = gigs.map(g => (g.id === id ? { ...g, ...updates } : g));
    setGigs(() => updatedGigs);

    try {
      // Strip view-model fields; inline edit only changes gig columns
      const { venue, act, participants, financials, staff_slots, ...gigFields } = updates;
      await updateGig(id, gigFields);
      const detected = await checkAllConflictsForGigs(updatedGigs, organization.id);
      setConflicts(() => detected);
    } catch (err: any) {
      setGigs(prev => prev.map(g => (g.id === id ? gig : g)));
      console.error('Error updating gig:', err);
      toast.error(err.message || 'Failed to update gig');
    }
  }, [gigs, organization.id, setGigs, setConflicts]);

  const getGigFinancials = useCallback(
    (gigId: string) => financialsByGigId.get(gigId) ?? ZERO_GIG_EXPORT_AGGREGATES,
    [financialsByGigId],
  );

  // An organization Inactive on a gig is read-only on its shared details (#175).
  const sharedEditable = useCallback((row: Gig) => !isInactiveOn(row, organization.id), [organization.id]);

  const gigColumns = useMemo<ColumnDef<Gig>[]>(() => [
    {
      id: 'title',
      header: 'Title',
      accessor: 'title',
      sortable: true,
      filterable: true,
      required: true,
      type: 'text',
      className: 'w-[25%]',
      onCellClick: (row) => onViewGig(row.id),
      render: (val, row) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-gray-900 hover:underline cursor-pointer">
            {val || <span className="text-gray-400 italic">Untitled Gig</span>}
          </span>
          {/* #175: this organization is Inactive on the gig (being removed from it). */}
          {isInactiveOn(row, organization.id) && (
            <span className="rounded border border-gray-300 bg-gray-100 px-1.5 text-[11px] font-medium text-gray-600">Inactive</span>
          )}
        </span>
      ),
    },
    {
      id: 'start',
      header: 'Start',
      accessor: 'start',
      sortable: true,
      required: true,
      editable: canEdit,
      isEditable: sharedEditable,
      type: 'datetime',
      timezone: (row) => row.timezone,
      allDay: (row) => isGigAllDay(row),
      className: 'w-[14%]',
      render: (_, row) => (
        <span className="text-sm text-gray-700">
          {formatDateTimeDisplay(row.start, row.end, row.timezone, isGigAllDay(row))}
        </span>
      ),
      // Displayed as a combined start–end range on screen; export gets a plain start date.
      exportValue: (row) => formatExportDate(row.start, row.timezone, isGigAllDay(row)),
    },
    {
      id: 'end',
      header: 'End',
      accessor: 'end',
      sortable: true,
      optional: true,
      editable: canEdit,
      isEditable: sharedEditable,
      type: 'datetime',
      timezone: (row) => row.timezone,
      allDay: (row) => isGigAllDay(row),
      exportValue: (row) => formatExportDate(row.end, row.timezone, isGigAllDay(row)),
    },
    {
      // A12: shown on request; in an export it says which dates are whole days.
      id: 'all_day',
      header: 'All day',
      accessor: 'all_day',
      sortable: true,
      optional: true,
      render: (_, row) => <span className="text-sm text-gray-700">{isGigAllDay(row) ? 'Yes' : ''}</span>,
      exportValue: (row) => (isGigAllDay(row) ? 'yes' : 'no'),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: 'status',
      sortable: true,
      filterable: true,
      required: true,
      editable: canEdit,
      // The status is the gig owner's to change (#175).
      isEditable: (row) => sharedEditable(row) && managesGigOwner(row, organization.id, userRole),
      type: 'pill',
      pillConfig: statusPillConfig,
      className: 'w-[12%]',
      exportValue: (row) => GIG_STATUS_CONFIG[row.status]?.label ?? row.status ?? '',
    },
    {
      id: 'venue',
      header: 'Venue',
      accessor: (row) => row.venue?.name || '',
      sortable: true,
      filterable: true,
      render: (val) => val ? (
        <Badge variant="outline" className="truncate bg-gray-100 text-gray-800 border-gray-200">
          {val}
        </Badge>
      ) : (
        <span className="text-gray-400 italic">—</span>
      ),
    },
    {
      id: 'act',
      header: 'Act',
      accessor: (row) => row.act?.name || '',
      sortable: true,
      filterable: true,
      render: (val) => val ? (
        <Badge variant="outline" className="truncate bg-gray-100 text-gray-800 border-gray-200">
          {val}
        </Badge>
      ) : (
        <span className="text-gray-400 italic">—</span>
      ),
    },
    {
      id: 'tags',
      header: 'Tags',
      accessor: 'tags',
      filterable: true,
      editable: canEdit,
      isEditable: sharedEditable,
      type: 'multi-pill',
      pillConfig: tagPillConfig,
      className: 'w-[18%]',
    },
    {
      id: 'notes',
      header: 'Notes',
      accessor: 'notes',
      filterable: true,
      optional: true,
      editable: canEdit,
      isEditable: sharedEditable,
      type: 'text',
      render: (val) => (
        <span className="text-sm text-gray-600 line-clamp-2">{val || '—'}</span>
      ),
    },
    // Financial rollups — hidden by default (toggle on via the Columns button).
    // Read-only: computed from gig_financials / gig_staff_assignments, not gig columns.
    {
      id: 'staffCount',
      header: 'Number of Staff',
      accessor: (row) => getGigFinancials(row.id).staffCount,
      sortable: true,
      optional: true,
      readOnly: true,
      type: 'number',
    },
    ...(showFinancials ? ([
      {
        id: 'costOfStaff',
        header: 'Cost of Staff',
        accessor: (row) => roundMoney(getGigFinancials(row.id).costOfStaff),
        sortable: true,
        optional: true,
        readOnly: true,
        type: 'currency',
      },
      {
        id: 'revenue',
        header: 'Revenue',
        accessor: (row) => roundMoney(getGigFinancials(row.id).revenue),
        sortable: true,
        optional: true,
        readOnly: true,
        type: 'currency',
      },
      {
        id: 'expenses',
        header: 'Expenses',
        accessor: (row) => roundMoney(getGigFinancials(row.id).expenses),
        sortable: true,
        optional: true,
        readOnly: true,
        type: 'currency',
      },
      {
        id: 'profit',
        header: 'Profit',
        accessor: (row) => {
          const f = getGigFinancials(row.id);
          return roundMoney(f.revenue - f.costOfStaff - f.expenses);
        },
        sortable: true,
        optional: true,
        readOnly: true,
        type: 'currency',
      },
    ] as ColumnDef<Gig>[]) : []),
  ], [canEdit, showFinancials, getGigFinancials, onViewGig, sharedEditable, organization.id, userRole]);

  // Fallback for the (rare) case Export is clicked before SmartDataTable's
  // mount effect has reported which columns are visible: mirrors its own
  // default-visibility rule (required, or not marked optional).
  const defaultVisibleColumnIds = useMemo(
    () => gigColumns.filter((c) => c.required || !c.optional).map((c) => c.id),
    [gigColumns],
  );

  const handleExport = useCallback(() => {
    const rows = exportRows.length > 0 ? exportRows : filteredGigs;
    if (rows.length === 0) return;
    const shownIds = visibleColumnIds.length > 0 ? visibleColumnIds : defaultVisibleColumnIds;
    const columnsToExport = gigColumns.filter((c) => shownIds.includes(c.id));
    const csv = gigsToCsv(
      buildExportRows(columnsToExport, rows),
      columnsToExport.map((c) => c.header),
    );
    downloadGigCsv(csv, gigExportFilename());
    toast.success(`Exported ${rows.length} gig${rows.length === 1 ? '' : 's'}`);
  }, [exportRows, filteredGigs, gigColumns, visibleColumnIds, defaultVisibleColumnIds]);

  const rowActions = useMemo<RowAction<Gig>[]>(() => [
    {
      id: 'view',
      label: 'View',
      onClick: (row) => onViewGig(row.id),
    },
    // Manage actions hidden from read-only roles (Staff/Viewer)
    ...(canEdit ? ([
      {
        id: 'edit',
        label: 'Edit',
        onClick: (row: Gig) => onEditGig(row.id),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        onClick: (row: Gig) => handleGigDuplicate(row.id),
        // Only the gig owner's Admins and Managers duplicate it (#175).
        hidden: (row: Gig) => !managesGigOwner(row, organization.id, userRole),
      },
    ] satisfies RowAction<Gig>[]) : []),
    ...(canDelete ? ([
      {
        id: 'delete',
        label: 'Delete',
        onClick: (row: Gig) => handleGigDelete(row.id),
        // #175: the reasons the row's own data shows (owner, other claimed organizations); child
        // gigs aren't loaded here, so the database's refusal explains that one.
        blockedReason: (row: Gig) => deleteGigBlockedReason(row, organization.id, userRole, 0),
      },
    ] satisfies RowAction<Gig>[]) : []),
  ], [canEdit, canDelete, onViewGig, onEditGig, handleGigDuplicate, handleGigDelete, organization.id, userRole]);

  const calendarEvents: CalendarEvent[] = useMemo(() => {
    return filteredGigs.map(gig => {
      const isAllDay = isGigAllDay(gig);
      if (isAllDay) {
        const startDateStr = gig.start.substring(0, 10);
        const endDateStr = gig.end ? gig.end.substring(0, 10) : startDateStr;
        const [sy, sm, sd] = startDateStr.split('-').map(Number);
        const [ey, em, ed] = endDateStr.split('-').map(Number);
        return {
          id: gig.id,
          title: gig.title,
          start: new Date(sy, sm - 1, sd),
          end: addDays(new Date(ey, em - 1, ed), 1),
          allDay: true,
          resource: gig,
        };
      }
      const startDate = new Date(gig.start);
      const endDate = gig.end ? new Date(gig.end) : new Date(startDate.getTime() + 3600000);
      return {
        id: gig.id,
        title: gig.title,
        start: startDate,
        end: endDate > startDate ? endDate : new Date(startDate.getTime() + 3600000),
        resource: gig,
      };
    });
  }, [filteredGigs]);

  const STATUS_HEX_COLORS: Record<string, string> = {
    DateHold: '#6b7280',
    Proposed: '#3b82f6',
    Booked: '#16a34a',
    Completed: '#9333ea',
    Cancelled: '#9ca3af',
    Settled: '#4f46e5',
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    const hasConflicts = conflicts.some(conflict => conflict.gig_id === event.resource.id);
    const bgColor = hasConflicts ? '#dc2626' : (STATUS_HEX_COLORS[event.resource.status] || '#6b7280');

    return {
      style: {
        backgroundColor: bgColor,
        borderRadius: '4px',
        opacity: 0.8,
        color: 'white',
        border: hasConflicts ? '2px solid #991b1b' : '0px',
      },
    };
  };

  const EventComponent = ({ event }: { event: CalendarEvent }) => {
    const gig = event.resource;

    const parts: string[] = [];
    if (!event.allDay && calendarView === 'month') {
      const timeStr = formatTimeDisplay(gig.start, gig.timezone);
      if (timeStr) parts.push(timeStr);
    }
    if (gig.act?.name) parts.push(gig.act.name);
    if (gig.venue?.name) parts.push(gig.venue.name);

    return (
      <div className="p-0.5 cursor-pointer text-xs leading-tight">
        <div className="font-medium truncate">{gig.title}</div>
        {parts.length > 0 && (
          <div className="opacity-85 truncate">{parts.join(' · ')}</div>
        )}
      </div>
    );
  };

  const handleCalendarNavigate = (action: 'PREV' | 'NEXT' | 'TODAY') => {
    const newDate = new Date(calendarDate);
    switch (action) {
      case 'PREV':
        if (calendarView === 'month') newDate.setMonth(newDate.getMonth() - 1);
        else newDate.setDate(newDate.getDate() - 7);
        break;
      case 'NEXT':
        if (calendarView === 'month') newDate.setMonth(newDate.getMonth() + 1);
        else newDate.setDate(newDate.getDate() + 7);
        break;
      case 'TODAY':
        newDate.setTime(new Date().getTime());
        break;
    }
    setCalendarDate(newDate);
  };

  const handleDrillDown = (date: Date) => {
    setCalendarDate(date);
    setCalendarView('week');
  };

  const viewToggle = (
    <div className="flex items-center border rounded-lg overflow-hidden">
      <button
        onClick={() => setViewMode('list')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
          viewMode === 'list'
            ? 'bg-sky-500 text-white'
            : 'bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        <List className="w-4 h-4" />
        List
      </button>
      <button
        onClick={() => setViewMode('calendar')}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
          viewMode === 'calendar'
            ? 'bg-sky-500 text-white'
            : 'bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        <CalendarIcon className="w-4 h-4" />
        Calendar
      </button>
    </div>
  );

  const dateFilterControl = (
    <div className="flex items-center gap-2">
      <Tabs value={gigTimeframe} onValueChange={(v) => setGigTimeframe(v as 'upcoming' | 'past')}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming ({upcomingGigs.length})</TabsTrigger>
          <TabsTrigger value="past">Past ({pastGigs.length})</TabsTrigger>
        </TabsList>
      </Tabs>
      <GigDateFilterDropdown
        futureDateFilter={futureDateFilter}
        pastDateFilter={pastDateFilter}
        onFutureChange={setFutureDateFilter}
        onPastChange={setPastDateFilter}
      />
      <GigStatusFilterDropdown
        activeStatuses={activeStatuses}
        onChange={setActiveStatuses}
      />
    </div>
  );

  const calendarToolbar = (
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-2">
        <Button aria-label="Previous period" variant="outline" size="sm" onClick={() => handleCalendarNavigate('PREV')}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleCalendarNavigate('TODAY')}>
          Today
        </Button>
        <Button aria-label="Next period" variant="outline" size="sm" onClick={() => handleCalendarNavigate('NEXT')}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <CalendarIcon className="h-4 w-4 mr-2" />
              {format(calendarDate, calendarView === 'month' ? 'MMMM yyyy' : "'Week of' MMM d, yyyy")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DatePicker
              mode="single"
              selected={calendarDate}
              onSelect={(date) => date && setCalendarDate(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <Tabs value={calendarView} onValueChange={(v) => setCalendarView(v as CalendarViewType)}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="gig-list"
        onSwitchOrganization={onSwitchOrganization}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader
        icon={CalendarIcon}
        title="Gigs"
        actions={
          <>
            {viewToggle}
            {canEdit && (
              <Button
                onClick={onCreateGig}
                className="bg-sky-500 hover:bg-sky-600 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Gig
              </Button>
            )}
            {canEdit && onNavigateToImport && (
              <Button
                onClick={onNavigateToImport}
                variant="outline"
                className="border-sky-500 text-sky-600 hover:bg-sky-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            )}
            {viewMode === 'list' && (
              <Button
                onClick={() => setShowExportConfirm(true)}
                variant="outline"
                disabled={filteredGigs.length === 0}
                className="border-sky-500 text-sky-600 hover:bg-sky-50"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        <div className="pb-6">
          {error ? (
            <Card className="p-12 text-center">
              <div className="text-red-500 mb-4 font-semibold">Error loading gigs</div>
              <p className="text-gray-600 mb-6">{error}</p>
              <Button onClick={loadGigs} variant="outline">
                Try Again
              </Button>
            </Card>
          ) : viewMode === 'list' ? (
            !isLoading && gigs.length === 0 ? (
              <GigListEmptyState
                hasActiveFilters={false}
                onClearFilters={() => {}}
                onCreateGig={onCreateGig}
                onNavigateToImport={onNavigateToImport}
              />
            ) : (
              <>
                {conflicts.length > 0 && (
                  <div className="mb-4">
                    <ConflictWarning
                      conflicts={conflicts}
                      onViewGig={(id) => onViewGig(id)}
                    />
                  </div>
                )}
                <SmartDataTable
                  tableId="gig-list"
                  data={timeframeGigs}
                  columns={gigColumns}
                  rowActions={rowActions}
                  onRowUpdate={canEdit ? handleRowUpdate : undefined}
                  onAddRowClick={canEdit ? onCreateGig : undefined}
                  onFilteredDataChange={setExportRows}
                  onVisibleColumnsChange={setVisibleColumnIds}
                  isLoading={isLoading}
                  emptyMessage={gigTimeframe === 'upcoming' ? 'No upcoming gigs found' : 'No past gigs found'}
                  toolbarLeft={dateFilterControl}
                />
              </>
            )
          ) : (
            <>
              {conflicts.length > 0 && (
                <div className="mb-4">
                  <ConflictWarning
                    conflicts={conflicts}
                    onViewGig={(id) => onViewGig(id, true)}
                  />
                </div>
              )}

              <Card>
                {calendarToolbar}
                <div className="p-4">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-[600px]">
                      <div>Loading calendar...</div>
                    </div>
                  ) : (
                    <BigCalendar
                      localizer={localizer}
                      events={calendarEvents}
                      startAccessor="start"
                      endAccessor="end"
                      allDayAccessor="allDay"
                      style={{ height: 600 }}
                      view={calendarView}
                      onView={(v: string) => setCalendarView(v as CalendarViewType)}
                      date={calendarDate}
                      onNavigate={setCalendarDate}
                      onSelectEvent={(event: { id: string }) => onViewGig(event.id, true)}
                      onDrillDown={handleDrillDown}
                      eventPropGetter={eventStyleGetter}
                      showMultiDayTimes
                      toolbar={false}
                      components={{
                        event: EventComponent,
                      }}
                      views={['month', 'week']}
                    />
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={showExportConfirm} onOpenChange={setShowExportConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export gigs as shown?</AlertDialogTitle>
            <AlertDialogDescription>
              This exports exactly what the list is currently showing — the Date and Status filters,
              any column search filters, sort order, and the columns you've chosen to display (via the
              Columns button) all carry over to the CSV. Adjust filters or columns first if you want a
              different export.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleExport}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
