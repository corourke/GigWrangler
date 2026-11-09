import { useEffect, useRef } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { queryKeys } from '../../../lib/queryKeys';
import { getGigParticipantContacts, type GigParticipantContact } from '../../../services/gigParticipantContacts.service';
import { getEntityAttachments } from '../../../services/attachment.service';
import { getGigFinancials, getGigProfitabilitySummary } from '../../../services/gigFinancial.service';
import { GIG_STATUS_CONFIG, ORG_ROLE_CONFIG, SCHEDULE_ACTIVITY_CONFIG } from '../../../utils/supabase/constants';
import { formatDateTimeDisplay, formatInTimeZone, isGigAllDay } from '../../../utils/dateUtils';
import type { Gig, GigStaffSlotView, Organization } from '../../../utils/supabase/types';
import MarkdownContent from '../../MarkdownContent';
import { assignmentCost, money, rateBasis, staffRows } from '../view/staffRows';
import { projectedStaffCost } from '../../../utils/rateEstimate';
import { settledAmount, stageLabel } from '../../../utils/moneyFlow';

interface GigPrintSheetProps {
  gig: Gig;
  organization: Organization;
  /** This organization's staff slots on the gig. */
  slots: GigStaffSlotView[];
  /** Adds page 2, the financials (Admins and Managers only). */
  includeFinancials: boolean;
  /** Called once everything on the sheet has loaded, so the page can print. */
  onReady: () => void;
}

const time = (iso: string, tz?: string) => formatInTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
const day = (iso: string, tz?: string) => formatInTimeZone(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
const shortDate = (date: string) => format(new Date(`${date.slice(0, 10)}T12:00:00`), 'MMM d');
const fullName = (u?: { first_name?: string | null; last_name?: string | null } | null) =>
  u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';

// Print styles: black on white, compact, sized for Letter/A4 (#12, boards 4–5).
const H2 = 'text-[10pt] font-bold uppercase tracking-[0.08em] border-b-[1.5px] border-black pb-0.5 mb-1';
const TABLE = 'w-full border-collapse text-[9.5pt] [&_td]:py-0.5 [&_td]:pr-1.5 [&_td]:align-top [&_td]:border-b [&_td]:border-[#bbb] [&_th]:text-left [&_th]:text-[8pt] [&_th]:uppercase [&_th]:tracking-[0.05em] [&_th]:pr-1.5 [&_th]:pb-0.5';

function PageHeader({ kicker, title, detail, right }: { kicker: string; title: string; detail: string; right: React.ReactNode }) {
  return (
    <header className="flex justify-between items-start border-b-[3px] border-black pb-2 mb-3.5">
      <div className="flex flex-col gap-0.5">
        <div className="text-[8pt] uppercase tracking-[0.1em]">{kicker}</div>
        <div className="text-[18pt] font-bold leading-tight">{title}</div>
        <div>{detail}</div>
      </div>
      <div className="text-right text-[8.5pt]">{right}</div>
    </header>
  );
}

/**
 * The printed gig sheet (#12): page 1 has the venue, schedule, participants,
 * crew contacts and notes; page 2, only when asked for, the gig's financials.
 * Equipment is left to the packing list.
 */
export default function GigPrintSheet({ gig, organization, slots, includeFinancials, onReady }: GigPrintSheetProps) {
  const participants = (gig.participants ?? []) as any[];
  const venue = participants.find((p) => p.role === 'Venue')?.organization;
  const actNames = Object.fromEntries(participants.filter((p) => p.role === 'Act').map((p) => [p.id, p.organization?.name ?? '']));
  const tz = gig.timezone;

  const contactQueries = useQueries({
    queries: participants.map((p) => ({
      queryKey: queryKeys.gigParticipantContacts(gig.id, p.organization_id),
      queryFn: () => getGigParticipantContacts(gig.id, p.organization_id),
    })),
  });
  const primaryContact = (orgId: string): GigParticipantContact | undefined => {
    const i = participants.findIndex((p) => p.organization_id === orgId);
    const list = (contactQueries[i]?.data ?? []) as GigParticipantContact[];
    return list.find((c) => c.is_primary_contact) ?? list[0];
  };
  const attachments = useQuery({ queryKey: ['gigAttachments', gig.id], queryFn: () => getEntityAttachments('gig', gig.id) });
  const summary = useQuery({
    queryKey: [...queryKeys.gigFinancialsSummary(gig.id), organization.id],
    queryFn: () => getGigProfitabilitySummary(gig.id, organization.id),
    enabled: includeFinancials,
  });
  const financials = useQuery({
    queryKey: ['gigFinancialsPrint', gig.id, organization.id],
    queryFn: () => getGigFinancials(gig.id, organization.id),
    enabled: includeFinancials,
  });

  const loading = contactQueries.some((q) => q.isLoading) || attachments.isLoading
    || (includeFinancials && (summary.isLoading || financials.isLoading));
  const reported = useRef(false);
  useEffect(() => {
    if (!loading && !reported.current) {
      reported.current = true;
      onReady();
    }
  }, [loading, onReady]);

  const schedule = [...(gig.schedule_entries ?? [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const multiDay = new Set(schedule.map((e) => day(e.start_time, tz))).size > 1;
  const crew = staffRows(slots);
  const printed = `Printed ${format(new Date(), 'MMM d, yyyy')}`;
  const when = formatDateTimeDisplay(gig.start, gig.end, tz, isGigAllDay(gig));
  const status = GIG_STATUS_CONFIG[gig.status]?.label ?? gig.status;
  const venueContact = venue ? primaryContact(venue.id) : undefined;
  const cityLine = venue ? [venue.city, [venue.state, venue.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

  const rows = (financials.data ?? []) as any[];
  const revenueRows = rows.filter((f) => f.direction === 'in');
  const expenseRows = rows.filter((f) => f.direction === 'out');
  const dueOrPaid = (f: any) =>
    f.stage === 'paid' ? `Paid ${shortDate(String(f.paid_at).slice(0, 10))}` : f.due_date ? `Due ${shortDate(f.due_date)}` : '';
  const rowMoney = (f: any) => (f.amount == null ? '—' : money(f.stage === 'paid' ? settledAmount(f) : Number(f.amount)));
  const staffCosts = slots.flatMap((slot) =>
    (slot.staff_assignments ?? slot.assignments ?? [])
      .filter((a: any) => a.user_id && a.status !== 'Declined')
      .map((a: any) => ({ id: a.id, role: slot.role || slot.role_info?.name || '', name: fullName(a.user), a })),
  );

  return (
    <div className="gig-print text-black bg-white text-[10pt] leading-snug font-sans">
      <section aria-label="Gig sheet" className="flex flex-col gap-3.5">
        <PageHeader
          kicker={`Gig sheet · ${organization.name}`}
          title={gig.title}
          detail={when}
          right={<>Status: <b>{status}</b><br />{printed}</>}
        />

        <div className="grid grid-cols-2 gap-5">
          <div>
            <h2 className={H2}>Venue</h2>
            {venue ? (
              <>
                <div>
                  <b>{venue.name}</b>
                  {venue.address_line1 && <div>{venue.address_line1}</div>}
                  {venue.address_line2 && <div>{venue.address_line2}</div>}
                  {cityLine && <div>{cityLine}</div>}
                  {venue.phone_number && <div>Main {venue.phone_number}</div>}
                </div>
                {venueContact?.user && (
                  <div className="mt-1">
                    Contact: <b>{fullName(venueContact.user)}</b>{venueContact.title ? `, ${venueContact.title}` : ''}
                    <div>{[venueContact.user.phone, venueContact.user.email].filter(Boolean).join(' · ')}</div>
                  </div>
                )}
              </>
            ) : <div className="italic">No venue yet</div>}
          </div>
          <div>
            <h2 className={H2}>Schedule</h2>
            {schedule.length === 0 ? <div className="italic">No schedule yet</div> : (
              <table aria-label="Schedule" className={TABLE}>
                <tbody>
                  {schedule.map((e) => {
                    const item = e.label || SCHEDULE_ACTIVITY_CONFIG[e.activity_type]?.label || e.activity_type;
                    const extra = [e.act_participant_id ? actNames[e.act_participant_id] : null, e.notes].filter(Boolean).join(', ');
                    return (
                      <tr key={e.id}>
                        <td className="w-[7.5rem] whitespace-nowrap font-bold">
                          {multiDay && <>{day(e.start_time, tz)} </>}
                          {time(e.start_time, tz)}{e.end_time ? ` – ${time(e.end_time, tz)}` : ''}
                        </td>
                        <td>{item}{extra ? ` · ${extra}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <h2 className={H2}>Participants</h2>
          <table aria-label="Participants" className={TABLE}>
            <thead><tr><th className="w-20">Role</th><th>Organization</th><th>Contact</th><th>Phone</th><th>Email</th></tr></thead>
            <tbody>
              {participants.map((p) => {
                const c = primaryContact(p.organization_id);
                return (
                  <tr key={p.id}>
                    <td>{ORG_ROLE_CONFIG[p.role as keyof typeof ORG_ROLE_CONFIG]?.label ?? p.role}</td>
                    <td>{p.organization?.name}{p.is_client ? ' (client)' : ''}</td>
                    <td>{c ? `${fullName(c.user)}${c.title ? `, ${c.title}` : ''}` : ''}</td>
                    <td>{c?.user?.phone ?? ''}</td>
                    <td>{c?.user?.email ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className={H2}>Crew</h2>
          <table aria-label="Crew" className={TABLE}>
            <thead><tr><th>Role</th><th>Name</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>
              {crew.map((r) => (
                <tr key={r.key}>
                  <td>{r.role}</td>
                  <td>{r.name ?? '(open)'}</td>
                  <td>{r.phone ?? ''}</td>
                  <td>{r.email ?? ''}</td>
                  <td>{r.status === 'Open' ? '' : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className={H2}>Notes</h2>
          <div>{gig.notes ? <MarkdownContent>{gig.notes}</MarkdownContent> : 'No notes'}</div>
          <div className="text-[8.5pt] mt-1">
            {(attachments.data ?? []).length > 0 && <>Attachments: {(attachments.data ?? []).map((a: any) => a.file_name).join(' · ')} · </>}
            Equipment: see the packing list.
          </div>
        </div>
      </section>

      {includeFinancials && (
        <section aria-label="Gig financials" className="flex flex-col gap-3.5 break-before-page pt-2">
          <PageHeader
            kicker={`Gig financials · ${organization.name} · Confidential`}
            title={gig.title}
            detail={[day(gig.start, tz), venue?.name].filter(Boolean).join(' · ')}
            right={<>Page 2 of 2<br />{printed}</>}
          />
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Revenue', summary.data?.expectedIn, `Rcvd ${money(summary.data?.receivedIn ?? 0)} · Owed ${money(summary.data?.outstandingIn ?? 0)}`],
              ['Costs', summary.data?.totalCosts, `Paid ${money(summary.data?.paidOut ?? 0)} · Staff ${money(summary.data?.projectedStaffCosts ?? 0)}`],
              ['Profit', summary.data?.profit, `Margin ${(summary.data?.margin ?? 0).toFixed(1)}%`],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="border-[1.5px] border-black px-2.5 py-1.5">
                <div className="text-[8pt] font-bold uppercase">{label}</div>
                <div className="text-[14pt] font-bold">{money(Number(value ?? 0))}</div>
                <div className="text-[8.5pt]">{sub}</div>
              </div>
            ))}
          </div>

          <div>
            <h2 className={H2}>Money in</h2>
            <table aria-label="Money in" className={TABLE}>
              <thead><tr><th>Date</th><th>Stage</th><th>Description</th><th>Ref</th><th>Due / paid</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {revenueRows.map((f) => (
                  <tr key={f.id}>
                    <td>{shortDate(f.date)}</td><td>{stageLabel('in', f.stage)}</td><td>{f.description ?? ''}</td><td>{f.reference_number ?? ''}</td>
                    <td>{dueOrPaid(f)}</td><td className="text-right">{rowMoney(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className={H2}>Money out</h2>
            <table aria-label="Money out" className={TABLE}>
              <thead><tr><th>Date</th><th>Stage</th><th>Category</th><th>Description</th><th>Due / paid</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {expenseRows.map((f) => (
                  <tr key={f.id}>
                    <td>{shortDate(f.date)}</td><td>{stageLabel('out', f.stage)}</td><td>{f.category ?? ''}</td><td>{f.description ?? ''}</td>
                    <td>{dueOrPaid(f)}</td><td className="text-right">{rowMoney(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className={H2}>Staff costs</h2>
            <table aria-label="Staff costs" className={TABLE}>
              <thead><tr><th>Role</th><th>Name</th><th>Basis</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {staffCosts.map(({ id, role, name, a }) => {
                  // A booked, unfinalized assignment is shown at its estimate, like the summary above (#213, #219).
                  const est = !a.completed_at && (a.status === 'Confirmed' || a.status === 'Requested') ? projectedStaffCost(a, gig) : null;
                  return (
                    <tr key={id}>
                      <td>{role}</td><td>{name}</td>
                      <td>{est ? est.basis : rateBasis(a)}</td>
                      <td>{a.status}</td><td className="text-right">{money(est ? est.amount : assignmentCost(a))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
