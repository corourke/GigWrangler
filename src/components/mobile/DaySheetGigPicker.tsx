import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { queryKeys } from '../../lib/queryKeys';
import { getGigsForOrganization } from '../../services/gig.service';
import { listMyDaySheetGigs, listSavedSheetIds } from '../../services/mobile/daySheetGigs.service';
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
  const saved = useQuery({ queryKey: queryKeys.savedDaySheets(), queryFn: () => listSavedSheetIds(), networkMode: 'always' });

  const query = isStaff ? mine : org;
  const gigs = useMemo(() => {
    const all = isStaff ? (mine.data ?? []) : (org.data ?? []).map(asGig);
    const term = search.trim().toLowerCase();
    return term ? all.filter((g) => g.title.toLowerCase().includes(term)) : all;
  }, [isStaff, mine.data, org.data, search]);

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
        ) : query.error && gigs.length === 0 ? (
          <p className="text-sm text-center text-red-600 py-10">Couldn't load the gigs</p>
        ) : gigs.length === 0 ? (
          <p className="text-sm text-center text-muted-foreground py-10">No gigs to show</p>
        ) : (
          <ul aria-label="Gigs" className="divide-y divide-border/50">
            {gigs.map((g) => {
              const tz = g.timezone || undefined;
              const when = `${formatInTimeZone(g.start, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${
                isGigAllDay(g) ? '' : ` · ${formatTimeDisplay(g.start, tz)}`
              }`;
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => onChoose(g.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 active:bg-muted">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{g.title}</span>
                      <span className="block text-xs text-muted-foreground">{when}</span>
                      {saved.data?.has(g.id) && (
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
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
