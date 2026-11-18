import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { useIsOffline } from './useIsOffline';
import { queryKeys, invalidateAfterAssignmentChange } from '../../lib/queryKeys';
import {
  fetchAccessRequestCount,
  fetchEquipmentConflicts,
  fetchMyInvites,
  fetchOpenCrewSpots,
  fetchPaymentsDue,
  fetchReceiptsToReview,
} from '../../services/mobile/needsYou.service';
import { setMyAssignmentStatus } from '../../services/mobile/myAssignments.service';
import type { DayOfShowGig } from '../../services/mobile/dayOfShow.service';
import { CREW_SPOTS_DAYS } from '../../utils/needsYou';
import { formatInTimeZone, isGigAllDay } from '../../utils/dateUtils';
import { plural } from '../../utils/plural';

interface NeedsYouProps {
  onViewGigDetail: (gigId: string) => void;
  /** The gigs Today has loaded (the organization's next 7 days). The conflict check runs on these once they are in. */
  weekGigs?: DayOfShowGig[];
}

const STALE = 60 * 1000;
/** The conflict check is the slow one: kept longer. */
const CONFLICTS_STALE = 10 * 60 * 1000;
const when = (g: { start: string; timezone?: string | null; all_day?: boolean | null }) =>
  formatInTimeZone(g.start, isGigAllDay(g) ? 'UTC' : g.timezone || undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** A due date (YYYY-MM-DD, no time zone) as the other rows show dates: Fri, Sep 25. */
const dueDay = (iso: string) => formatInTimeZone(`${iso.slice(0, 10)}T12:00:00Z`, 'UTC', { weekday: 'short', month: 'short', day: 'numeric' });

/** Counts need a connection: a query that starts as the phone goes offline makes no request. */
const needConnection = () => { if (!navigator.onLine) throw new Error('offline'); };

/** Today's date as YYYY-MM-DD. */
const todayISO = () => new Date().toLocaleDateString('en-CA');

/**
 * Today's "Needs you" (#445): counts of what is waiting on the person, each opening its list.
 * Staff see their invites; Admins and Managers also open crew spots, access requests and receipts;
 * Admins also payments due or overdue. Each count loads on its own, so none holds up the others
 * (or the gig card above). A count of zero isn't shown; one that fails says so. Counts need a
 * connection.
 */
export default function NeedsYou({ onViewGigDetail, weekGigs }: NeedsYouProps) {
  const { user, selectedOrganization, userRole } = useAuth();
  const isOffline = useIsOffline();
  const queryClient = useQueryClient();
  const userId = user?.id ?? '';
  const orgId = selectedOrganization?.id ?? '';
  const [open, setOpen] = useState<string | null>(null);

  const isManager = userRole === 'Admin' || userRole === 'Manager';
  const isAdmin = userRole === 'Admin';
  const live = !isOffline && !!userId;

  const invites = useQuery({ queryKey: queryKeys.needsYouInvites(userId), queryFn: () => { needConnection(); return fetchMyInvites(); }, enabled: live, staleTime: STALE, networkMode: 'always' });
  const crew = useQuery({ queryKey: queryKeys.needsYouCrewSpots(orgId), queryFn: () => { needConnection(); return fetchOpenCrewSpots(orgId); }, enabled: live && isManager && !!orgId, staleTime: STALE, networkMode: 'always' });
  const access = useQuery({ queryKey: queryKeys.needsYouAccessRequests(userId, orgId), queryFn: () => { needConnection(); return fetchAccessRequestCount(orgId); }, enabled: live && isManager && !!orgId, staleTime: STALE, networkMode: 'always' });
  const receipts = useQuery({ queryKey: queryKeys.needsYouReceipts(orgId), queryFn: () => { needConnection(); return fetchReceiptsToReview(orgId); }, enabled: live && isManager && !!orgId, staleTime: STALE, networkMode: 'always' });
  const payments = useQuery({ queryKey: queryKeys.needsYouPayments(orgId), queryFn: () => { needConnection(); return fetchPaymentsDue(orgId, todayISO()); }, enabled: live && isAdmin && !!orgId, staleTime: STALE, networkMode: 'always' });

  // Last: it waits for Today's gigs, and then runs on just those.
  const conflicts = useQuery({
    queryKey: queryKeys.needsYouConflicts(orgId, (weekGigs ?? []).map((g) => g.id)),
    queryFn: () => { needConnection(); return fetchEquipmentConflicts(orgId, weekGigs as DayOfShowGig[]); },
    enabled: live && isManager && !!orgId && !!weekGigs,
    staleTime: CONFLICTS_STALE,
    networkMode: 'always',
  });

  const answer = useMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: 'Confirmed' | 'Declined' }) => setMyAssignmentStatus(assignmentId, status),
    networkMode: 'always',
    onSuccess: (_r, { status }) => {
      toast.success(status === 'Confirmed' ? 'Accepted' : 'Declined');
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.needsYouInvites(userId) }),
        invalidateAfterAssignmentChange(queryClient),
      ]);
    },
    onError: () => toast.error("Couldn't send your reply. Try again."),
  });

  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));

  type Row = { key: string; query: { isPending: boolean; isError: boolean; fetchStatus: string }; count: number; label: ReactNode; text?: string; failed: string; list: () => ReactNode };
  const rows: Row[] = [
    {
      key: 'invites', query: invites, count: invites.data?.length ?? 0,
      label: invites.data?.length === 1 ? 'Invite to reply to' : 'Invites to reply to', failed: "Couldn't load invites",
      list: () => (
        <ul aria-label="Invites to reply to" className="divide-y divide-border/50">
          {(invites.data ?? []).map((i) => (
            <li key={i.assignmentId} className="px-3 py-2.5">
              <button type="button" onClick={() => onViewGigDetail(i.gig.id)} className="text-left w-full">
                <span className="block text-sm font-medium">{i.gig.title}</span>
                <span className="block text-xs text-muted-foreground">{when(i.gig)}{i.role ? ` · ${i.role}` : ''}</span>
              </button>
              <div className="flex gap-2 mt-2">
                <Button size="sm" className="flex-1 h-9" disabled={answer.isPending} onClick={() => answer.mutate({ assignmentId: i.assignmentId, status: 'Confirmed' })}>Accept</Button>
                <Button size="sm" variant="outline" className="flex-1 h-9" disabled={answer.isPending} onClick={() => answer.mutate({ assignmentId: i.assignmentId, status: 'Declined' })}>Decline</Button>
              </div>
            </li>
          ))}
        </ul>
      ),
    },
    ...(isManager
      ? ([
          {
            key: 'crew', query: crew, count: crew.data?.spots ?? 0,
            label: `Open crew ${crew.data?.spots === 1 ? 'spot' : 'spots'} (${CREW_SPOTS_DAYS} days)`, failed: "Couldn't load open crew spots",
            list: () => (
              <ul aria-label="Open crew spots" className="divide-y divide-border/50">
                {(crew.data?.gigs ?? []).map(({ gig, open: n }) => (
                  <li key={gig.id}>
                    <button type="button" onClick={() => onViewGigDetail(gig.id)} className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{gig.title}</span>
                        <span className="block text-xs text-muted-foreground">{when(gig)} · {n} open</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            key: 'access', query: access, count: access.data ?? 0,
            label: plural(access.data ?? 0, 'Access request').replace(/^\d+ /, ''), failed: "Couldn't load access requests",
            list: () => (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">Decide them on a computer: Team → Access Requests.</p>
            ),
          },
          {
            key: 'conflicts', query: conflicts, count: conflicts.data?.count ?? 0,
            label: `Equipment ${conflicts.data?.count === 1 ? 'conflict' : 'conflicts'} this week`, failed: "Couldn't load equipment conflicts",
            list: () => (
              <ul aria-label="Equipment conflicts" className="divide-y divide-border/50">
                {(conflicts.data?.gigs ?? []).map((g) => (
                  <li key={g.gigId}>
                    <button type="button" onClick={() => onViewGigDetail(g.gigId)} className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{g.title}</span>
                        <span className="block text-xs text-muted-foreground truncate">Clashes with {g.others.join(', ')}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            key: 'receipts', query: receipts, count: receipts.data?.length ?? 0,
            label: plural(receipts.data?.length ?? 0, 'Receipt').replace(/^\d+ /, '') + ' to review', failed: "Couldn't load receipts",
            list: () => (
              <div>
                <ul aria-label="Receipts to review" className="divide-y divide-border/50">
                  {(receipts.data ?? []).map((r) => (
                    <li key={r.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{r.file_name}</span>
                      <span className="text-xs text-muted-foreground capitalize shrink-0">{r.status}</span>
                    </li>
                  ))}
                </ul>
                <p className="px-3 py-2 text-xs text-muted-foreground">Review them on a computer: Purchases → Scan invoices.</p>
              </div>
            ),
          },
        ] as Row[])
      : []),
    ...(isAdmin
      ? ([
          {
            key: 'payments', query: payments, count: (payments.data?.due ?? 0) + (payments.data?.overdue ?? 0),
            text: [payments.data?.due ? `${payments.data.due} due today` : '', payments.data?.overdue ? `${payments.data.overdue} overdue` : ''].filter(Boolean).join(' · '),
            label: 'Payments due or overdue', failed: "Couldn't load payments",
            list: () => (
              <ul aria-label="Payments due or overdue" className="divide-y divide-border/50">
                {(payments.data?.lines ?? []).map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => l.gigId && onViewGigDetail(l.gigId)} className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{l.gigTitle || 'A gig'}</span>
                        <span className="block text-xs text-muted-foreground">{l.direction === 'in' ? 'Money in' : 'Money out'} · due {dueDay(l.due_date)}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            ),
          },
        ] as Row[])
      : []),
  ];

  if (isOffline) {
    return (
      <section aria-labelledby="needs-you-title" className="rounded-lg border border-border bg-background px-3 py-3">
        <h2 id="needs-you-title" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Needs you</h2>
        <p className="text-sm text-muted-foreground mt-1">Counts need a connection.</p>
      </section>
    );
  }

  const visible = rows.filter((r) => r.query.isPending || r.query.isError || r.count > 0);
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="needs-you-title" className="rounded-lg border border-border bg-background">
      <h2 id="needs-you-title" className="px-3 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Needs you</h2>
      <ul className="divide-y divide-border/50">
        {visible.map((r) => (
          <li key={r.key}>
            {r.query.isPending ? (
              <div className="px-3 py-3 flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Loading…
              </div>
            ) : r.query.isError ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">{r.failed}</p>
            ) : (
              <>
                <button
                  type="button"
                  aria-expanded={open === r.key}
                  onClick={() => toggle(r.key)}
                  className="w-full px-3 py-3 flex items-center gap-3 text-left active:bg-muted"
                >
                  <span className={cn('min-w-8 text-base font-bold tabular-nums', r.text && 'text-sm')}>{r.text ?? r.count}</span>
                  <span className="flex-1 text-sm">{r.label}</span>
                  {open === r.key ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </button>
                {open === r.key && <div className="bg-muted/20 border-t border-border/50">{r.list()}</div>}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
