import { useState } from 'react';
import { Calendar, ChevronRight, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { OfflineBadge } from './OfflineBadge';
import { useIsOffline } from './useIsOffline';
import { useDayOfShowSheet, useTodayGigs } from './useDayOfShowData';
import DaySheetGigPicker from './DaySheetGigPicker';
import { pickTodayGigs } from '../../utils/todayGig';
import { formatInTimeZone, formatTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import { GIG_STATUS_CONFIG } from '../../utils/supabase/constants';
import type { DayOfShowGig } from '../../services/mobile/dayOfShow.service';
import type { GigStatus } from '../../utils/supabase/types';

interface MobileTodayProps {
  onViewGigDetail: (gigId: string) => void;
  /** Opens a gig's day sheet (#445). */
  onOpenDaySheet: (gigId: string) => void;
}

const SECTION_TITLE = 'text-[11px] font-semibold text-muted-foreground uppercase tracking-wide';

/** "Thu, Nov 12", in the gig's own time zone (all-day gigs are a calendar day). */
const dayLabel = (g: DayOfShowGig) =>
  formatInTimeZone(g.start, isGigAllDay(g) ? 'UTC' : g.timezone || undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeLabel = (g: DayOfShowGig) => (isGigAllDay(g) ? 'All day' : formatTimeDisplay(g.start, g.timezone || undefined));

/**
 * The Today tab, the phone's home screen (#445): today's gig (or the next one) as a card opening its
 * day sheet, then the rest of the next 7 days. It opens from the copy saved on the phone, so it
 * works at a venue with no signal.
 */
export default function MobileToday({ onViewGigDetail, onOpenDaySheet }: MobileTodayProps) {
  const { user, selectedOrganization, userRole } = useAuth();
  const isOffline = useIsOffline();
  const [picking, setPicking] = useState(false);
  const gigsQuery = useTodayGigs({ userId: user?.id, orgId: selectedOrganization?.id, role: userRole });
  const gigs = gigsQuery.data ?? [];
  const { today, next } = pickTodayGigs(gigs);
  const cards = today.length > 0 ? today : next ? [next] : [];
  const shown = new Set(cards.map((g) => g.id));
  const now = Date.now();
  const thisWeek = gigs
    .filter((g) => !shown.has(g.id) && g.status !== 'Cancelled' && new Date(g.start).getTime() > now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <h1 className="text-xl font-bold">Today</h1>
        <div className="flex items-center gap-2">
          {isOffline && <OfflineBadge />}
          <Button aria-label="Refresh" variant="ghost" size="icon" onClick={() => void gigsQuery.refetch()} disabled={gigsQuery.isFetching || isOffline} className="h-9 w-9">
            <RefreshCw className={`w-5 h-5 ${gigsQuery.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 pb-12">
        {gigsQuery.error && !gigsQuery.data && (
          <Card className="p-4 text-center bg-red-50 border-red-200">
            <p className="text-red-600 text-sm font-medium">Couldn't load your gigs</p>
          </Card>
        )}

        {gigsQuery.isPending ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : cards.length === 0 ? (
          <Card className="p-8 text-center bg-muted/30 border-dashed">
            <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No gigs in the next 7 days</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {cards.map((g) => (
              <GigCard key={g.id} gig={g} isNext={today.length === 0} onOpen={() => onOpenDaySheet(g.id)} />
            ))}
          </div>
        )}

        {!gigsQuery.isPending && (
          <button type="button" onClick={() => setPicking(true)} className="w-full text-sm font-medium text-primary py-1">
            Choose another gig
          </button>
        )}

        {thisWeek.length > 0 && (
          <section aria-labelledby="today-this-week">
            <h2 id="today-this-week" className={cn(SECTION_TITLE, 'mb-2')}>This week</h2>
            <ul aria-labelledby="today-this-week" className="rounded-lg border border-border divide-y divide-border/50 bg-background">
              {thisWeek.map((g) => {
                const status = GIG_STATUS_CONFIG[g.status as GigStatus];
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => onViewGigDetail(g.id)} className="w-full text-left px-3 py-2.5 flex items-center gap-3 active:bg-muted">
                      <span className="w-20 shrink-0 text-xs font-semibold text-muted-foreground">{dayLabel(g)}</span>
                      <span className="flex-1 min-w-0 text-sm truncate">{g.title}</span>
                      {status && <Badge variant="outline" className={cn('text-[10px] shrink-0', status.color)}>{status.label}</Badge>}
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {picking && (
        <DaySheetGigPicker
          onClose={() => setPicking(false)}
          onChoose={(id) => {
            setPicking(false);
            onOpenDaySheet(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Today's gig, or the next one. Loading its sheet here also saves it on the phone ahead of the
 * show, and gives the venue.
 */
function GigCard({ gig, isNext, onOpen }: { gig: DayOfShowGig; isNext: boolean; onOpen: () => void }) {
  const sheetQuery = useDayOfShowSheet(gig.id);
  const venue = sheetQuery.data?.venue?.name;
  const status = GIG_STATUS_CONFIG[gig.status as GigStatus];
  const headingId = `today-gig-${gig.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className={cn(SECTION_TITLE, isNext ? 'text-amber-700' : 'text-primary')}>
          {isNext ? `Next up · ${dayLabel(gig)}` : 'Today'} · {timeLabel(gig)}
        </p>
        {status && <Badge variant="outline" className={cn('text-[10px] shrink-0', status.color)}>{status.label}</Badge>}
      </div>
      <h2 id={headingId} className="text-lg font-bold leading-tight mt-1">{gig.title}</h2>
      {venue && (
        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{venue}</span>
        </p>
      )}
      <Button className="w-full mt-3 h-10" onClick={onOpen}>Open day sheet</Button>
    </section>
  );
}
