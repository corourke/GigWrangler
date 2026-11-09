import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useMobileGigListData } from './useMobileGigListData';
import { useGigListFilters } from '../../hooks/useGigListFilters';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Search,
  MapPin,
  ChevronRight,
  Loader2,
  WifiOff,
  RefreshCw,
  Calendar,
  X,
  Plus,
  Music,
  ChevronDown,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { createGig } from '../../services/gig.service';
import { useOrganizationSearch } from '../useOrganizationSelectorData';
import { useAuth } from '../../contexts/AuthContext';
import { GIG_STATUS_CONFIG, ORG_ROLE_CONFIG } from '../../utils/supabase/constants';
import { cn } from '../ui/utils';
import type { GigStatus } from '../../utils/supabase/types';
import type { OrganizationRole } from '../../utils/supabase/types';
import { getAllTimezones } from '../../utils/timezones';
import { parseGigDateTimeFromInput } from '../../utils/dateUtils';
import { isGigPast } from '../../utils/gigTimeframe';
import { managesGigOwner } from '../../utils/gigOwnership';
import { toast } from 'sonner';
import { GigDateFilterDropdown } from '../gigs/GigDateFilterDropdown';
import { applyDateFilter, FUTURE_FILTER_LABEL, PAST_FILTER_LABEL } from '../gigs/gigDateFilter';
import { GigStatusFilterDropdown } from '../gigs/GigStatusFilterDropdown';
import { plural } from '../../utils/plural';

interface MobileGigListProps {
  onViewGig: (gigId: string) => void;
  initialScrollTop?: number;
  onScrollPositionChange?: (scrollTop: number) => void;
}


const _GIG_STATUSES: { key: GigStatus; label: string }[] = [
  { key: 'DateHold', label: 'Date Hold' },
  { key: 'Proposed', label: 'Proposed' },
  { key: 'Booked', label: 'Booked' },
  { key: 'Completed', label: 'Completed' },
  { key: 'Cancelled', label: 'Cancelled' },
  { key: 'Settled', label: 'Settled' },
];

export default function MobileGigList({ onViewGig, initialScrollTop, onScrollPositionChange }: MobileGigListProps) {
  const { selectedOrganization, userRole } = useAuth();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [searchQuery, setSearchQuery] = useState('');
  const { futureDateFilter, setFutureDateFilter, pastDateFilter, setPastDateFilter, activeStatuses, setActiveStatuses } = useGigListFilters();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusMenuGigId, setStatusMenuGigId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  useEffect(() => {
    const handleStatusChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  const orgId = selectedOrganization?.id;
  const { gigs, gigsQuery, refreshGigs, changeStatus } = useMobileGigListData(orgId);
  const loading = gigsQuery.isFetching || (!!orgId && gigsQuery.isPending);
  const loadGigs = () => { refreshGigs(); };

  const scrollRestoredRef = useRef(false);

  useEffect(() => {
    const container = document.querySelector('[data-mobile-scroll]') as HTMLElement | null;
    const target = container || window;
    const handleScroll = () => {
      const scrollTop = container ? container.scrollTop : window.scrollY;
      onScrollPositionChange?.(scrollTop);
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribes once on mount
  }, []);

  useEffect(() => {
    if (!loading && gigs.length > 0 && initialScrollTop && !scrollRestoredRef.current) {
      scrollRestoredRef.current = true;
      const container = document.querySelector('[data-mobile-scroll]') as HTMLElement | null;
      if (container) {
        container.scrollTop = initialScrollTop;
      } else {
        window.scrollTo(0, initialScrollTop);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- restores the starting scroll position once, when the list first has gigs
  }, [loading, gigs]);

  const handleStatusChange = async (gigId: string, newStatus: GigStatus) => {
    setUpdatingStatus(gigId);
    try {
      // Resolves once the list has reloaded.
      await changeStatus.mutateAsync({ gigId, status: newStatus });
      toast.success(`Status updated to ${GIG_STATUS_CONFIG[newStatus].label}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
      setStatusMenuGigId(null);
    }
  };

  const handleGigCreated = () => {
    setShowCreateModal(false);
    refreshGigs();
  };

  const filteredGigs = useMemo(() => {
    let result = gigs;

    result = applyDateFilter(result, futureDateFilter, pastDateFilter);

    if (activeStatuses.length > 0) {
      result = result.filter((g) => activeStatuses.includes(g.status));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((g) => {
        const venue = g.participants?.find((p: any) => p.role === 'Venue')?.organization;
        const act = g.participants?.find((p: any) => p.role === 'Act')?.organization;
        return (
          g.title?.toLowerCase().includes(q) ||
          venue?.name?.toLowerCase().includes(q) ||
          act?.name?.toLowerCase().includes(q) ||
          g.tags?.some((t: string) => t.toLowerCase().includes(q))
        );
      });
    }

    return result;
  }, [gigs, activeStatuses, searchQuery, futureDateFilter, pastDateFilter]);

  const upcomingGigs = useMemo(() => {
    const now = new Date();
    return filteredGigs
      .filter((g) => !isGigPast(g, now))
      .sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [filteredGigs]);

  const pastGigs = useMemo(() => {
    const now = new Date();
    return filteredGigs
      .filter((g) => isGigPast(g, now))
      .sort((a: any, b: any) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [filteredGigs]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md border-b border-border/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Gigs</h1>
            <p className="text-xs text-muted-foreground">
              {futureDateFilter === 'none' && pastDateFilter === 'none'
                ? 'All Dates'
                : [FUTURE_FILTER_LABEL[futureDateFilter], PAST_FILTER_LABEL[pastDateFilter]]
                    .filter(Boolean).join(' / ')} · {plural(filteredGigs.length, 'gig')}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {isOffline && (
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200">
                <WifiOff className="w-3 h-3" />
                <span className="text-[10px]">Offline</span>
              </Badge>
            )}
            <Button aria-label="New gig" variant="ghost" size="icon" onClick={() => setShowCreateModal(true)} className="h-9 w-9">
              <Plus className="w-5 h-5" />
            </Button>
            <Button aria-label="Refresh" variant="ghost" size="icon" onClick={loadGigs} disabled={loading} className="h-9 w-9">
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="px-4 pb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search gigs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-9 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-sky-500/30"
            />
            {searchQuery && (
              <button aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        <div className="px-4 pt-0 pb-3 flex gap-2">
          <GigDateFilterDropdown
            futureDateFilter={futureDateFilter}
            pastDateFilter={pastDateFilter}
            onFutureChange={setFutureDateFilter}
            onPastChange={setPastDateFilter}
            compact
          />
          <GigStatusFilterDropdown
            activeStatuses={activeStatuses}
            onChange={setActiveStatuses}
            compact
          />
        </div>
      </div>

      <div className="flex-1 p-4 space-y-6 pb-12">
        {loading && gigs.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : filteredGigs.length === 0 ? (
          <Card className="p-8 text-center bg-muted/30 border-dashed">
            <p className="text-muted-foreground text-sm">
              {searchQuery ? 'No gigs match your search.' : 'No gigs found.'}
            </p>
          </Card>
        ) : (
          <>
            {upcomingGigs.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                  Upcoming ({upcomingGigs.length})
                </h2>
                <div className="grid gap-2">
                  {upcomingGigs.map((gig) => (
                    <GigListCard
                      key={gig.id}
                      gig={gig}
                      onViewGig={onViewGig}
                      canChangeStatus={managesGigOwner(gig, selectedOrganization?.id, userRole)}
                      statusMenuOpen={statusMenuGigId === gig.id}
                      onToggleStatusMenu={(id) => setStatusMenuGigId(statusMenuGigId === id ? null : id)}
                      onStatusChange={handleStatusChange}
                      updatingStatus={updatingStatus}
                    />
                  ))}
                </div>
              </div>
            )}
            {pastGigs.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                  Past ({pastGigs.length})
                </h2>
                <div className="grid gap-2">
                  {pastGigs.map((gig) => (
                    <GigListCard
                      key={gig.id}
                      gig={gig}
                      onViewGig={onViewGig}
                      isPast
                      canChangeStatus={managesGigOwner(gig, selectedOrganization?.id, userRole)}
                      statusMenuOpen={statusMenuGigId === gig.id}
                      onToggleStatusMenu={(id) => setStatusMenuGigId(statusMenuGigId === id ? null : id)}
                      onStatusChange={handleStatusChange}
                      updatingStatus={updatingStatus}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreateModal && selectedOrganization && (
        <QuickCreateGigModal
          organizationId={selectedOrganization.id}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleGigCreated}
        />
      )}
    </div>
  );
}

function GigListCard({
  gig,
  onViewGig,
  isPast,
  canChangeStatus,
  statusMenuOpen,
  onToggleStatusMenu,
  onStatusChange,
  updatingStatus,
}: {
  gig: any;
  onViewGig: (id: string) => void;
  isPast?: boolean;
  /** The owner's Admins and Managers change a gig's status (#175). */
  canChangeStatus: boolean;
  statusMenuOpen: boolean;
  onToggleStatusMenu: (id: string) => void;
  onStatusChange: (gigId: string, status: GigStatus) => void;
  updatingStatus: string | null;
}) {
  const startTime = parseISO(gig.start);
  const venue = gig.participants?.find((p: any) => p.role === 'Venue')?.organization;
  const acts = gig.participants?.filter((p: any) => p.role === 'Act') || [];
  const actLabel = acts.length > 1 ? 'Multiple' : acts[0]?.organization?.name;
  const statusConfig = GIG_STATUS_CONFIG[gig.status as keyof typeof GIG_STATUS_CONFIG];

  return (
    <Card
      className={cn(
        'overflow-hidden border-l-4 active:bg-muted/50 transition-colors shadow-sm',
        isPast ? 'border-l-gray-300 opacity-75' : 'border-l-sky-500'
      )}
      style={{ gap: 0 }}
    >
      <CardContent className="px-3 py-2" style={{ paddingBottom: '8px' }} onClick={() => onViewGig(gig.id)}>
        <div className="flex justify-between items-start gap-2 cursor-pointer">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight truncate">{gig.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5 text-sky-700">
              <Calendar className="w-3 h-3 shrink-0" />
              <span className="text-[11px] font-medium">
                {format(startTime, 'EEE, MMM d · h:mm a')}
              </span>
            </div>
            {venue && (
              <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="text-[11px] line-clamp-1">{venue.name}</span>
              </div>
            )}
            {actLabel && (
              <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                <Music className="w-3 h-3 shrink-0" />
                <span className="text-[11px] line-clamp-1">{actLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (canChangeStatus) onToggleStatusMenu(gig.id);
              }}
              disabled={!canChangeStatus}
              className="flex items-center"
            >
              <span
                className={cn('inline-flex items-center rounded border px-1.5 py-0.5 font-medium', canChangeStatus && 'cursor-pointer', statusConfig?.color)}
                style={{ fontSize: '11px', lineHeight: '1' }}
              >
                {statusConfig?.label || gig.status}
              </span>
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
      {canChangeStatus && statusMenuOpen && (
        <div className="border-t border-border/50 px-3 py-2 bg-muted/30">
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Change status:</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(GIG_STATUS_CONFIG).map(([key, conf]) => (
              <button
                key={key}
                disabled={gig.status === key || updatingStatus === gig.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(gig.id, key as GigStatus);
                }}
                className={cn(
                  'px-2 py-0.5 rounded font-medium border transition-colors',
                  gig.status === key
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:opacity-80',
                  conf.color
                )}
                style={{ fontSize: '11px' }}
              >
                {updatingStatus === gig.id ? '...' : conf.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const CREATE_INPUT_CLASS = 'w-full h-10 px-3 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-sky-500/30';

interface CreateParticipant {
  organization_id: string;
  organization_name: string;
  role: string;
}

function QuickCreateGigModal({
  organizationId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('19:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('22:00');
  const [allDay, setAllDay] = useState(false);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [status, setStatus] = useState<GigStatus>('DateHold');
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [participants, setParticipants] = useState<CreateParticipant[]>([]);
  const [saving, setSaving] = useState(false);

  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [selectedOrgResult, setSelectedOrgResult] = useState<any>(null);
  const [addParticipantRole, setAddParticipantRole] = useState('');
  // A10: the search runs through react-query, 300 ms after typing stops, narrowed by the role
  // once one is picked; a late answer for an earlier term never shows. Not once a result is chosen.
  const { results: orgSearchResults } = useOrganizationSearch(selectedOrgResult ? '' : orgSearchQuery, {
    type: (addParticipantRole || undefined) as OrganizationRole | undefined,
    delayMs: 300,
  });
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);

  const timezones = useMemo(() => getAllTimezones(), []);
  const statusConfig = GIG_STATUS_CONFIG[status];

  const handleStartDateChange = (val: string) => {
    const prev = startDate;
    setStartDate(val);
    if (!endDate || endDate === prev) setEndDate(val);
  };

  const handleAllDayToggle = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      setStartTime('');
      setEndTime('');
    } else {
      setStartTime('19:00');
      setEndTime('22:00');
    }
  };

  const handleOrgSearchChange = (query: string) => {
    setOrgSearchQuery(query);
    setSelectedOrgResult(null);
  };

  // Choosing an organization from the search list (by tap, or Enter/Space on it).
  const pickOrg = (org: any) => {
    setSelectedOrgResult(org);
    setOrgSearchQuery(org.name);
  };

  const handleRoleSelect = (role: string) => {
    setAddParticipantRole(role);
    setShowRoleDropdown(false);
  };

  const handleAddParticipantConfirm = () => {
    if (!selectedOrgResult || !addParticipantRole) return;
    setParticipants(prev => [...prev, {
      organization_id: selectedOrgResult.id,
      organization_name: selectedOrgResult.name,
      role: addParticipantRole,
    }]);
    setShowAddParticipant(false);
    setOrgSearchQuery('');
    setSelectedOrgResult(null);
    setAddParticipantRole('');
    setShowRoleDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!startDate) {
      toast.error('Start date is required');
      return;
    }
    setSaving(true);
    try {
      const safeDate = (raw: string, fallback: string): string => {
        const result = raw ? parseGigDateTimeFromInput(raw, timezone) : '';
        return result || fallback;
      };
      let start: string;
      let end: string;
      if (allDay) {
        start = parseGigDateTimeFromInput(startDate, timezone, true) || new Date(`${startDate}T12:00:00Z`).toISOString();
        const endRaw = endDate || startDate;
        end = parseGigDateTimeFromInput(endRaw, timezone, true) || new Date(`${endRaw}T12:00:00Z`).toISOString();
      } else {
        const startRaw = startTime ? `${startDate}T${startTime}` : startDate;
        start = safeDate(startRaw, new Date(startRaw).toISOString());
        const resolvedEndDate = endDate || startDate;
        const endRaw = endTime ? `${resolvedEndDate}T${endTime}` : resolvedEndDate;
        end = safeDate(endRaw, new Date(endRaw).toISOString());
      }
      if (!start || !end) throw new Error('Invalid date/time values');
      const allParticipants = [
        { organization_id: organizationId, role: 'Production' },
        ...participants.map(p => ({ organization_id: p.organization_id, role: p.role })),
      ];
      await createGig({
        title: title.trim(),
        start,
        end,
        // A date with no start time is stored as a date, as before (A12: now said explicitly).
        all_day: allDay || !startTime,
        timezone,
        status,
        notes: notes.trim() || undefined,
        primary_organization_id: organizationId,
        participants: allParticipants,
      });
      toast.success('Gig created');
      onCreated();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create gig');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-end justify-center" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}>
      {/* The backdrop closes the sheet on a tap; the Close button does the same from the keyboard. */}
      <div role="presentation" className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-t-2xl max-h-full overflow-y-auto">
        <div className="sticky top-0 bg-background px-4 py-3 border-b border-border/50 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-bold">New Gig</h2>
          <Button aria-label="Close" variant="ghost" size="icon" onClick={onClose} disabled={saving} className="h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">

          <div>
            <label htmlFor="new-gig-title" className="text-[11px] font-medium text-muted-foreground uppercase">Title *</label>
            <input
              id="new-gig-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={cn(CREATE_INPUT_CLASS, 'mt-1')}
              placeholder="Gig title"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the new-gig sheet opens to type its title, as before
              autoFocus
              required
            />
          </div>

          <div role="group" aria-labelledby="new-gig-status-label">
            <span id="new-gig-status-label" className="text-[11px] font-medium text-muted-foreground uppercase">Status</span>
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setShowStatusPicker(!showStatusPicker)}
                className="flex items-center gap-1.5"
              >
                <span className={cn('inline-flex items-center rounded border px-2 py-1 font-medium', statusConfig?.color)} style={{ fontSize: '12px' }}>
                  {statusConfig?.label || status}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              {showStatusPicker && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(GIG_STATUS_CONFIG).map(([key, conf]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setStatus(key as GigStatus); setShowStatusPicker(false); }}
                      className={cn(
                        'rounded border px-2 py-1 font-medium transition-opacity',
                        conf.color,
                        status === key ? 'ring-2 ring-offset-1 ring-sky-400' : 'opacity-70'
                      )}
                      style={{ fontSize: '12px' }}
                    >
                      {conf.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2" role="group" aria-labelledby="new-gig-when-label">
            <div className="flex items-center justify-between">
              <span id="new-gig-when-label" className="text-[11px] font-medium text-muted-foreground uppercase">Date & Time</span>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => handleAllDayToggle(e.target.checked)}
                  className="rounded"
                />
                <span className="text-[11px] text-muted-foreground">All day</span>
              </label>
            </div>
            <div className={cn('grid gap-2', allDay ? 'grid-cols-2' : 'grid-cols-2')}>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Start date *</p>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className={CREATE_INPUT_CLASS}
                  required
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">End date</p>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={CREATE_INPUT_CLASS}
                />
              </div>
            </div>
            {!allDay && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Start time</p>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={CREATE_INPUT_CLASS}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">End time</p>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={CREATE_INPUT_CLASS}
                  />
                </div>
              </div>
            )}
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Timezone</p>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={CREATE_INPUT_CLASS}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>

          <div role="group" aria-labelledby="new-gig-participants-label">
            <span id="new-gig-participants-label" className="text-[11px] font-medium text-muted-foreground uppercase">Participants</span>
            <div className="mt-1 space-y-1">
              {participants.map((p, idx) => {
                const conf = ORG_ROLE_CONFIG[p.role as keyof typeof ORG_ROLE_CONFIG];
                return (
                  <div key={idx} className="flex items-center gap-2 py-1">
                    <span className="text-[11px] font-semibold text-muted-foreground w-24 shrink-0 truncate">
                      {conf?.label || p.role}
                    </span>
                    <span className="text-sm flex-1 truncate">{p.organization_name}</span>
                    <button aria-label={`Remove ${p.organization_name}`}
                      type="button"
                      onClick={() => setParticipants(participants.filter((_, i) => i !== idx))}
                      className="p-1 rounded text-red-500 hover:bg-red-50 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              {showAddParticipant ? (
                <div className="mt-1 space-y-2 border border-border/50 rounded-lg p-2">
                  <div className="relative">
                    <input
                      type="text"
                      className={CREATE_INPUT_CLASS}
                      value={orgSearchQuery}
                      onChange={e => handleOrgSearchChange(e.target.value)}
                      placeholder="Search organizations…"
                      // eslint-disable-next-line jsx-a11y/no-autofocus -- "Add participant" opens to type a search, as before
                      autoFocus
                    />
                    {orgSearchResults.length > 0 && !selectedOrgResult && (
                      <ul role="listbox" aria-label="Organizations" className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {orgSearchResults.map(org => (
                          <li
                            key={org.id}
                            role="option"
                            aria-selected={false}
                            tabIndex={0}
                            className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                            onClick={() => pickOrg(org)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickOrg(org); } }}
                          >
                            {org.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      className={cn(CREATE_INPUT_CLASS, 'cursor-pointer flex items-center justify-between')}
                      onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                    >
                      <span className={addParticipantRole ? '' : 'text-muted-foreground'}>
                        {addParticipantRole
                          ? ORG_ROLE_CONFIG[addParticipantRole as keyof typeof ORG_ROLE_CONFIG]?.label || addParticipantRole
                          : 'Select role…'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                    {showRoleDropdown && (
                      <ul role="listbox" aria-label="Roles" className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {Object.keys(ORG_ROLE_CONFIG).map(role => (
                          <li
                            key={role}
                            className={cn('px-3 py-2 text-sm cursor-pointer hover:bg-muted', addParticipantRole === role && 'font-medium text-sky-600')}
                            role="option"
                            aria-selected={addParticipantRole === role}
                            tabIndex={0}
                            onClick={() => handleRoleSelect(role)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRoleSelect(role); } }}
                          >
                            {ORG_ROLE_CONFIG[role as keyof typeof ORG_ROLE_CONFIG]?.label || role}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" type="button" className="flex-1 h-8 text-xs" onClick={handleAddParticipantConfirm} disabled={!selectedOrgResult || !addParticipantRole}>
                      Add
                    </Button>
                    <Button size="sm" type="button" variant="ghost" className="flex-1 h-8 text-xs" onClick={() => {
                      setShowAddParticipant(false);
                      setOrgSearchQuery('');
                      setSelectedOrgResult(null);
                      setAddParticipantRole('');
                      setShowRoleDropdown(false);
                    }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddParticipant(true)}
                  className="flex items-center gap-1 text-[12px] text-sky-600 hover:text-sky-700 mt-1 py-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Participant
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="new-gig-notes" className="text-[11px] font-medium text-muted-foreground uppercase">Notes</label>
            <textarea
              id="new-gig-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={1}
              className="w-full px-3 py-2 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-sky-500/30 mt-1 resize-none"
              placeholder="Optional notes…"
            />
          </div>

          <div className="pt-1 pb-2">
            <Button type="submit" className="w-full h-11" disabled={saving || !title.trim() || !startDate}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Gig
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
