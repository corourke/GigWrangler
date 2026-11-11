import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { queryKeys } from '../../lib/queryKeys';
import { getGigsForOrganization } from '../../services/gig.service';
import { listMyDaySheetGigs, listOfflineGigs, listSavedSheetIds } from '../../services/mobile/daySheetGigs.service';
import { useIsOffline } from './useIsOffline';
import type { DayOfShowGig } from '../../services/mobile/dayOfShow.service';
import { formatInTimeZone, formatTimeDisplay, isGigAllDay } from '../../utils/dateUtils';
import { useVisualViewport } from '../../hooks/useVisualViewport';

interface DaySheetGigPickerProps {
  onChoose: (gigId: string) => void;
  onClose: () => void;
}

const asGig = (g: any): DayOfShowGig => ({
  id: g.id,
  title: g.title ?? '',
  start: g.start,
  end: g.end ?? null,
  timezone: g.timezone ?? null,
  all_day: g.all_day ?? null,
  status: g.status ?? null,
});

/**
 * "Choose another gig" (#445): Staff pick from their own gigs (upcoming and the last 30 days);
 * Admins and Managers from the organization's gigs, with search. Gigs whose day sheet is saved on
 * the phone are marked.
 */
export default function DaySheetGigPicker({ onChoose, onClose }: DaySheetGigPickerProps) {
  const { user, selectedOrganization, userRole } = useAuth();
  const viewport = useVisualViewport();
  const isStaff = userRole === 'Staff';
  const orgId = selectedOrganization?.id ?? '';
  const [search, setSearch] = useState('');

  const mine = useQuery({
    queryKey: queryKeys.myDaySheetGigs(user?.id ?? ''),
    queryFn: () => listMyDaySheetGigs(),
    enabled: isStaff && !!user?.id,
  });
  // The same list (and cache) as the phone's gig list.
  const org = useQuery({
    queryKey: queryKeys.mobileGigs(orgId),
    queryFn: async () => ((await getGigsForOrganization(orgId)) || []) as any[],
    enabled: !isStaff && !!orgId,
    networkMode: 'always',
  });
  const saved = useQuery({ queryKey: queryKeys.savedDaySheets(user?.id ?? ''), queryFn: () => listSavedSheetIds(), networkMode: 'always' });
  // Offline with nothing loaded (#446 review): the gigs on the phone, so a saved sheet still opens.
  const isOffline = useIsOffline();
  const orgFailed = !isStaff && !org.data && (org.isError || isOffline);
  const onPhone = useQuery({
    queryKey: [...queryKeys.savedDaySheets(user?.id ?? ''), 'gigs', orgId],
    queryFn: () => listOfflineGigs(orgId),
    enabled: orgFailed,
    networkMode: 'always',
  });
  const showingPhone = orgFailed && !!onPhone.data;

  const query = isStaff ? mine : showingPhone ? onPhone : org;
  const { upcoming, earlier } = useMemo(() => {
    const all = isStaff ? (mine.data ?? []) : showingPhone ? (onPhone.data ?? []) : (org.data ?? []).map(asGig);
    const term = search.trim().toLowerCase();
    const found = term ? all.filter((g) => g.title.toLowerCase().includes(term)) : all;
    // Upcoming (not yet ended) soonest first; then earlier ones, most recent first.
    const now = Date.now();
    const time = (iso: string | null | undefined) => new Date(iso ?? 0).getTime();
    const isEarlier = (g: DayOfShowGig) => time(g.end ?? g.start) < now;
    return {
      upcoming: found.filter((g) => !isEarlier(g)).sort((a, b) => time(a.start) - time(b.start)),
      earlier: found.filter(isEarlier).sort((a, b) => time(b.start) - time(a.start)),
    };
  }, [isStaff, mine.data, org.data, onPhone.data, showingPhone, search]);
  const gigs = [...upcoming, ...earlier];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a gig"
      className="fixed inset-x-0 z-50 bg-background flex flex-col pt-[env(safe-area-inset-top,0px)]"
      style={viewport.keyboardOpen ? { top: `${viewport.offsetTop}px`, height: `${viewport.height}px` } : { top: 0, bottom: 0 }}
    >
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <h2 className="text-base font-bold">Choose a gig</h2>
        <Button aria-label="Close" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {!isStaff && (
        <div className="px-4 py-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search gigs"
              placeholder="Search gigs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : query.error && gigs.length === 0 && !showingPhone ? (
          <p className="text-sm text-center text-red-600 py-10">Couldn't load the gigs</p>
        ) : gigs.length === 0 ? (
          <p className="text-sm text-center text-muted-foreground py-10">No gigs to show</p>
        ) : (
          <>
            {showingPhone && (
              <p className="px-4 pt-3 text-xs text-amber-700">Offline: showing the gigs saved on this phone.</p>
            )}
            {upcoming.length > 0 && (
              <ul aria-label="Gigs" className="divide-y divide-border/50">
                {upcoming.map((g) => <GigRow key={g.id} gig={g} saved={!!saved.data?.has(g.id)} onChoose={onChoose} />)}
              </ul>
            )}
            {earlier.length > 0 && (
              <>
                <h3 id="day-sheet-picker-earlier" className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Earlier</h3>
                <ul aria-labelledby="day-sheet-picker-earlier" className="divide-y divide-border/50">
                  {earlier.map((g) => <GigRow key={g.id} gig={g} saved={!!saved.data?.has(g.id)} onChoose={onChoose} />)}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GigRow({ gig: g, saved, onChoose }: { gig: DayOfShowGig; saved: boolean; onChoose: (id: string) => void }) {
  const tz = g.timezone || undefined;
  const when = `${formatInTimeZone(g.start, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${
    isGigAllDay(g) ? '' : ` · ${formatTimeDisplay(g.start, tz)}`
  }`;
  return (
    <li>
      <button type="button" onClick={() => onChoose(g.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 active:bg-muted">
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">{g.title}</span>
          <span className="block text-xs text-muted-foreground">{when}</span>
          {saved && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-700">
              <Download className="w-3 h-3" aria-hidden="true" />
              Saved on this phone
            </span>
          )}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>
    </li>
  );
}
