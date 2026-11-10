import React from 'react';
import {
  Calendar,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { toast } from 'sonner';
import { OfflineBadge } from './OfflineBadge';
import { useIsOffline } from './useIsOffline';
import { useDayOfShowSheet, useTodayGigs } from './useDayOfShowData';
import { pickTodayGigs } from '../../utils/todayGig';
import { addressLines, mapsHref, smsHref, telHref } from '../../utils/contactLinks';
import { formatDateTimeDisplay, formatInTimeZone, formatTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import { GIG_STATUS_CONFIG, SCHEDULE_ACTIVITY_CONFIG } from '../../utils/supabase/constants';
import { getAttachmentUrl } from '../../services/attachment.service';
import type { DayOfShowDocument, DayOfShowGig, DayOfShowPerson, DayOfShowSheet } from '../../services/mobile/dayOfShow.service';
import type { GigStatus } from '../../utils/supabase/types';

interface MobileTodayProps {
  /** The gig picked from several today (/today?gig=…); else the app picks. */
  gigId?: string | null;
  onChooseGig?: (gigId: string) => void;
  onViewGigDetail: (gigId: string) => void;
}

const SECTION_TITLE = 'text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2 uppercase tracking-wide';
const ACTION = 'inline-flex items-center justify-center gap-1.5 h-10 px-3 rounded-md border border-border text-xs font-medium bg-background active:bg-muted';

/**
 * The Today tab (§3e): the day-of-show sheet for the signed-in person's gig today, or the next one.
 * It opens from the copy saved on the phone, so it works at a venue with no signal.
 */
export default function MobileToday({ gigId, onChooseGig, onViewGigDetail }: MobileTodayProps) {
  const { user, selectedOrganization, userRole } = useAuth();
  const isOffline = useIsOffline();
  const gigsQuery = useTodayGigs({ userId: user?.id, orgId: selectedOrganization?.id, role: userRole });
  const { today, next } = pickTodayGigs(gigsQuery.data ?? []);

  const chosen = gigId ? (gigsQuery.data ?? []).find((g) => g.id === gigId) : undefined;
  const choosing = !gigId && today.length > 1;
  const shownId = gigId ?? (choosing ? null : (today[0]?.id ?? next?.id ?? null));
  const isNext = !!shownId && today.length === 0 && !chosen;
  const sheetQuery = useDayOfShowSheet(shownId);

  const loading = gigsQuery.isPending || (!!shownId && sheetQuery.isPending);
  const refreshing = gigsQuery.isFetching || sheetQuery.isFetching;
  const refresh = () => {
    void gigsQuery.refetch();
    if (shownId) void sheetQuery.refetch();
  };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Today</h1>
          <p className="text-xs text-muted-foreground">Day-of-show sheet</p>
        </div>
        <div className="flex items-center gap-2">
          {isOffline && <OfflineBadge />}
          <Button aria-label="Refresh" variant="ghost" size="icon" onClick={refresh} disabled={refreshing || isOffline} className="h-9 w-9">
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-3 pb-12">
        {gigsQuery.error && !gigsQuery.data && (
          <Card className="p-4 text-center bg-red-50 border-red-200">
            <p className="text-red-600 text-sm font-medium">Couldn't load your gigs</p>
          </Card>
        )}

        {today.length > 1 && (
          <GigChooser gigs={today} selectedId={shownId} onChoose={(id) => onChooseGig?.(id)} />
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : !shownId ? (
          !choosing && (
            <Card className="p-8 text-center bg-muted/30 border-dashed">
              <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No gigs in the next 7 days</p>
            </Card>
          )
        ) : sheetQuery.data ? (
          <>
            {isNext && (
              <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No gig today. Next up:
              </p>
            )}
            <Sheet sheet={sheetQuery.data} isOffline={isOffline} onViewGigDetail={onViewGigDetail} />
          </>
        ) : sheetQuery.error ? (
          <Card className="p-4 text-center bg-red-50 border-red-200">
            <p className="text-red-600 text-sm font-medium">Couldn't load this gig's sheet</p>
          </Card>
        ) : (
          <Card className="p-6 text-center bg-muted/30 border-dashed">
            <p className="text-sm text-muted-foreground">This gig's sheet isn't saved on this phone. Connect to load it.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function GigChooser({ gigs, selectedId, onChoose }: { gigs: DayOfShowGig[]; selectedId: string | null; onChoose: (id: string) => void }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2">{gigs.length} gigs today</p>
      <div className="grid gap-2">
        {gigs.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onChoose(g.id)}
            aria-current={g.id === selectedId ? 'true' : undefined}
            className={cn(
              'w-full text-left rounded-md border px-3 py-2 flex items-center justify-between gap-2',
              g.id === selectedId ? 'border-primary bg-primary/5' : 'border-border bg-background',
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{g.title}</span>
              <span className="block text-xs text-muted-foreground">
                {isGigAllDay(g) ? 'All day' : formatTimeDisplay(g.start, g.timezone || undefined)}
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Sheet({ sheet, isOffline, onViewGigDetail }: { sheet: DayOfShowSheet; isOffline: boolean; onViewGigDetail: (id: string) => void }) {
  const { gig } = sheet;
  const tz = gig.timezone || undefined;
  const status = GIG_STATUS_CONFIG[gig.status as GigStatus];
  const savedAt = formatInTimeZone(new Date(sheet.saved_at), tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <>
      <Card style={{ gap: 0 }}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{gig.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDateTimeDisplay(gig.start, gig.end ?? gig.start, tz, isGigAllDay(gig))}
              </p>
            </div>
            {status && (
              <Badge variant="outline" className={cn('text-[10px] shrink-0', status.color)}>{status.label}</Badge>
            )}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-muted-foreground">Saved {savedAt}</span>
            {!isOffline && (
              <button type="button" className="text-xs text-primary font-medium" onClick={() => onViewGigDetail(gig.id)}>
                Open gig
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <ScheduleSection sheet={sheet} />
      <VenueSection sheet={sheet} />
      <PeopleSection title="Contacts" people={sheet.contacts} />
      <PeopleSection title="Crew" people={sheet.crew} />
      <DocumentsSection documents={sheet.documents} isOffline={isOffline} />
    </>
  );
}

function ScheduleSection({ sheet }: { sheet: DayOfShowSheet }) {
  const tz = sheet.gig.timezone || undefined;
  const dayOf = (iso: string) => formatInTimeZone(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
  const multiDay = new Set(sheet.schedule.map((e) => dayOf(e.start_time))).size > 1;
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><Clock className="w-3.5 h-3.5" />Schedule</p>
        {sheet.schedule.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedule yet.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {sheet.schedule.map((e, i) => {
              const config = SCHEDULE_ACTIVITY_CONFIG[e.activity_type];
              const showDay = multiDay && (i === 0 || dayOf(sheet.schedule[i - 1].start_time) !== dayOf(e.start_time));
              return (
                <div key={e.id}>
                  {showDay && <p className="text-[10px] font-semibold text-muted-foreground pt-2">{dayOf(e.start_time)}</p>}
                  <div className="py-2 flex items-center gap-3">
                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{formatTimeDisplay(e.start_time, tz)}</span>
                    <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded', config?.color || 'bg-gray-100 text-gray-700')}>
                      {e.label || config?.label || e.activity_type}
                    </span>
                    {e.act_name && <span className="text-xs text-muted-foreground truncate">{e.act_name}</span>}
                    {e.end_time && <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">to {formatTimeDisplay(e.end_time, tz)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VenueSection({ sheet }: { sheet: DayOfShowSheet }) {
  const venue = sheet.venue;
  if (!venue) return null;
  const directions = mapsHref(venue);
  const call = telHref(venue.phone_number);
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><MapPin className="w-3.5 h-3.5" />Venue</p>
        <p className="text-sm font-semibold">{venue.name}</p>
        <div className="text-sm text-muted-foreground select-text">
          {addressLines(venue).map((line) => <div key={line}>{line}</div>)}
        </div>
        {venue.phone_number && <p className="text-sm select-text mt-1 tabular-nums">{venue.phone_number}</p>}
        <div className="flex gap-2 mt-2">
          {directions && (
            <a className={ACTION} href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation className="w-4 h-4" />Directions
            </a>
          )}
          {call && (
            <a className={ACTION} href={call} aria-label={`Call ${venue.name}`}>
              <Phone className="w-4 h-4" />Call
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PeopleSection({ title, people }: { title: string; people: DayOfShowPerson[] }) {
  if (people.length === 0) return null;
  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><Users className="w-3.5 h-3.5" />{title}</p>
        <div className="divide-y divide-border/50">
          {people.map((p) => <PersonRow key={p.key} person={p} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function PersonRow({ person }: { person: DayOfShowPerson }) {
  const call = telHref(person.phone);
  const text = smsHref(person.phone);
  const detail = [person.title, person.org_name && `${person.org_name}${person.org_role ? ` (${person.org_role})` : ''}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="py-2">
      <p className="text-sm font-medium">{person.name}</p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {person.phone && <p className="text-sm select-text tabular-nums mt-0.5">{person.phone}</p>}
      {person.email && <p className="text-xs select-text text-muted-foreground break-all">{person.email}</p>}
      {(call || person.email) && (
        <div className="flex gap-2 mt-1.5">
          {call && <a className={ACTION} href={call} aria-label={`Call ${person.name}`}><Phone className="w-4 h-4" />Call</a>}
          {text && <a className={ACTION} href={text} aria-label={`Text ${person.name}`}><MessageSquare className="w-4 h-4" />Text</a>}
          {person.email && (
            <a className={ACTION} href={`mailto:${person.email}`} aria-label={`Email ${person.name}`}><Mail className="w-4 h-4" />Email</a>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentsSection({ documents, isOffline }: { documents: DayOfShowDocument[]; isOffline: boolean }) {
  if (documents.length === 0) return null;

  // As AttachmentManager: open the tab inside the tap, then send it to the signed link.
  const open = async (doc: DayOfShowDocument) => {
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await getAttachmentUrl(doc.file_path);
      if (tab) {
        tab.opener = null;
        tab.location.replace(url);
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      toast.error('Failed to open document');
    }
  };

  return (
    <Card style={{ gap: 0 }}>
      <CardContent className="p-3">
        <p className={SECTION_TITLE}><FileText className="w-3.5 h-3.5" />Documents</p>
        <div className="divide-y divide-border/50">
          {documents.map((doc) => (
            <div key={doc.id} className="py-2">
              <button
                type="button"
                disabled={isOffline}
                onClick={() => open(doc)}
                className="w-full text-left text-sm font-medium text-primary disabled:text-muted-foreground flex items-center gap-2"
              >
                <FileText className="w-4 h-4 shrink-0" />
                <span className="truncate">{doc.file_name}</span>
              </button>
              {isOffline && <p className="text-[10px] text-muted-foreground mt-0.5">Not saved on this phone – connect to open</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
