import { useState } from 'react';
import { Calendar, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { OfflineBadge } from './OfflineBadge';
import { useIsOffline } from './useIsOffline';
import { useDayOfShowSheet, useTodayGigs } from './useDayOfShowData';
import DaySheet from './DaySheet';
import DaySheetGigPicker from './DaySheetGigPicker';
import { pickTodayGigs } from '../../utils/todayGig';
import { formatTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import type { DayOfShowGig } from '../../services/mobile/dayOfShow.service';

interface MobileTodayProps {
  /** The gig picked from several today (/today?gig=…); else the app picks. */
  gigId?: string | null;
  onChooseGig?: (gigId: string) => void;
  onViewGigDetail: (gigId: string) => void;
  /** Opens any gig's day sheet, chosen from the gig picker (#445). */
  onOpenDaySheet?: (gigId: string) => void;
}

/**
 * The Today tab (§3e): the day-of-show sheet for the signed-in person's gig today, or the next one.
 * It opens from the copy saved on the phone, so it works at a venue with no signal.
 */
export default function MobileToday({ gigId, onChooseGig, onViewGigDetail, onOpenDaySheet }: MobileTodayProps) {
  const [picking, setPicking] = useState(false);
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
            <DaySheet sheet={sheetQuery.data} isOffline={isOffline} onViewGigDetail={onViewGigDetail} />
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

        {onOpenDaySheet && !loading && (
          <button type="button" onClick={() => setPicking(true)} className="w-full text-sm font-medium text-primary py-2">
            Choose another gig
          </button>
        )}
      </div>

      {picking && onOpenDaySheet && (
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

