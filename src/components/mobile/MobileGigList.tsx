import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
import { getGigsForOrganization, createGig, updateGig } from '../../services/gig.service';
import { searchOrganizations } from '../../services/organization.service';
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
import {
  GigDateFilterDropdown,
  applyDateFilter,
  FUTURE_FILTER_LABEL,
  PAST_FILTER_LABEL,
} from '../gigs/GigDateFilterDropdown';
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
  const [gigs, setGigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (selectedOrganization?.id) {
      loadGigs();
    }
  }, [selectedOrganization?.id]);

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
  }, [loading, gigs]);

  const loadGigs = async () => {
    if (!selectedOrganization?.id) return;
    setLoading(true);
    try {
      const data = await getGigsForOrganization(selectedOrganization.id);
      setGigs(data || []);
    } catch (error) {
      console.error('Failed to load gigs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (gigId: string, newStatus: GigStatus) => {
    setUpdatingStatus(gigId);
    try {
      await updateGig(gigId, { status: newStatus });
      toast.success(`Status updated to ${GIG_STATUS_CONFIG[newStatus].label}`);
      await loadGigs();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
      setStatusMenuGigId(null);
    }
  };

  const handleGigCreated = useCallback(() => {
    setShowCreateModal(false);
    if (selectedOrganization?.id) {
      getGigsForOrganization(selectedOrganization.id)
        .then(data => setGigs(data || []))
        .catch(err => console.error('Failed to reload gigs:', err));
    }
  }, [selectedOrganization]);

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
            <Button variant="ghost" size="icon" onClick={() => setShowCreateModal(true)} className="h-9 w-9">
              <Plus className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={loadGigs} disabled={loading} className="h-9 w-9">
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
              <button
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
  const [orgSearchResults, setOrgSearchResults] = useState<any[]>([]);
  const [selectedOrgResult, setSelectedOrgResult] = useState<any>(null);
  const [addParticipantRole, setAddParticipantRole] = useState('');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const orgSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleOrgSearchChange = (query: string, roleOverride?: string) => {
    setOrgSearchQuery(query);
    setSelectedOrgResult(null);
    if (orgSearchTimerRef.current) clearTimeout(orgSearchTimerRef.current);
    if (!query.trim()) { setOrgSearchResults([]); return; }
    const role = roleOverride !== undefined ? roleOverride : addParticipantRole;
    orgSearchTimerRef.current = setTimeout(async () => {
      try {
        const filters: { search: string; type?: OrganizationRole } = { search: query };
        if (role) filters.type = role as OrganizationRole;
        setOrgSearchResults(await searchOrganizations(filters));
      } catch { setOrgSearchResults([]); }
    }, 300);
  };

  const handleRoleSelect = (role: string) => {
    setAddParticipantRole(role);
    setShowRoleDropdown(false);
    if (orgSearchQuery.trim() && !selectedOrgResult) handleOrgSearchChange(orgSearchQuery, role);
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
    setOrgSearchResults([]);
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
      <div className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-t-2xl max-h-full overflow-y-auto">
        <div className="sticky top-0 bg-background px-4 py-3 border-b border-border/50 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-bold">New Gig</h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={saving} className="h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={cn(CREATE_INPUT_CLASS, 'mt-1')}
              placeholder="Gig title"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Status</label>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground uppercase">Date & Time</label>
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

          <div>
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Participants</label>
            <div className="mt-1 space-y-1">
              {participants.map((p, idx) => {
                const conf = ORG_ROLE_CONFIG[p.role as keyof typeof ORG_ROLE_CONFIG];
                return (
                  <div key={idx} className="flex items-center gap-2 py-1">
                    <span className="text-[11px] font-semibold text-muted-foreground w-24 shrink-0 truncate">
                      {conf?.label || p.role}
                    </span>
                    <span className="text-sm flex-1 truncate">{p.organization_name}</span>
                    <button
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
                      autoFocus
                    />
                    {orgSearchResults.length > 0 && !selectedOrgResult && (
                      <ul className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {orgSearchResults.map(org => (
                          <li
                            key={org.id}
                            className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                            onClick={() => { setSelectedOrgResult(org); setOrgSearchQuery(org.name); setOrgSearchResults([]); }}
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
                      <ul className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {Object.keys(ORG_ROLE_CONFIG).map(role => (
                          <li
                            key={role}
                            className={cn('px-3 py-2 text-sm cursor-pointer hover:bg-muted', addParticipantRole === role && 'font-medium text-sky-600')}
                            onClick={() => handleRoleSelect(role)}
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
                      setOrgSearchResults([]);
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
            <label className="text-[11px] font-medium text-muted-foreground uppercase">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={1}
              className="w-full px-3 py-2 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-sky-500/30 mt-1 resize-none"
              style={{ fontSize: '14px' }}
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
