import { getSupabase } from '../base/dataAccess';
import { handleApiError } from '../../utils/api-error-utils';
import type { GigStatus, GigScheduleEntry } from '../../utils/supabase/types';

export interface StaffDashboardGig {
  gig: {
    id: string;
    title: string;
    start: string;
    end: string;
    timezone: string;
    all_day?: boolean | null;
    status: GigStatus;
  };
  assignment: {
    id: string;
    status: string;
    rate: number | null;
    fee: number | null;
    confirmed_at: string | null;
  };
  role_name: string;
  venue?: {
    name: string;
    address_line1?: string;
    phone_number?: string;
  };
  schedule_entries?: GigScheduleEntry[];
}

export async function fetchMyUpcomingAssignments(): Promise<StaffDashboardGig[]> {
  const supabase = getSupabase();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const plus7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: assignments, error } = await supabase
      .from('gig_staff_assignments')
      .select(`
        id,
        status,
        rate,
        fee,
        confirmed_at,
        slot:gig_staff_slots!inner(
          gig_id,
          staff_role:staff_roles(name),
          gig:gigs!inner(
            id,
            title,
            start,
            end,
            timezone,
            all_day,
            status
          )
        )
      `)
      .eq('user_id', user.id)
      .neq('status', 'Declined')
      .gte('slot.gig.start', past24h)
      .lte('slot.gig.start', plus7d)
      .not('slot.gig.status', 'in', '(Cancelled,Settled)');

    if (error) throw error;
    if (!assignments || assignments.length === 0) return [];

    const gigIds = [...new Set(assignments.map(a => (a.slot as any)?.gig?.id).filter(Boolean))];

    const [venueResult, scheduleResult] = await Promise.all([
      supabase
        .from('gig_participants')
        .select('gig_id, organization:organization_id(name, address_line1, phone_number)')
        .in('gig_id', gigIds)
        .eq('role', 'Venue'),
      supabase
        .from('gig_schedule_entries')
        .select(`
          *,
          act_participant:act_participant_id(
            id,
            role,
            organization:organization_id(id, name)
          )
        `)
        .in('gig_id', gigIds)
        .order('sort_order', { ascending: true })
        .order('start_time', { ascending: true }),
    ]);

    const venuesByGig = new Map<string, any>();
    for (const v of venueResult.data || []) {
      if (!venuesByGig.has(v.gig_id)) venuesByGig.set(v.gig_id, (v as any).organization);
    }

    const scheduleByGig = new Map<string, GigScheduleEntry[]>();
    for (const s of (scheduleResult.data || []) as unknown as (GigScheduleEntry & { gig_id: string })[]) {
      const arr = scheduleByGig.get(s.gig_id) || [];
      arr.push(s);
      scheduleByGig.set(s.gig_id, arr);
    }

    const results: StaffDashboardGig[] = [];

    for (const a of assignments) {
      const slot = a.slot as any;
      const gig = slot?.gig;
      if (!gig) continue;

      const venueOrg = venuesByGig.get(gig.id);

      results.push({
        gig: {
          id: gig.id,
          title: gig.title,
          start: gig.start,
          end: gig.end,
          timezone: gig.timezone,
          all_day: gig.all_day,
          status: gig.status as GigStatus,
        },
        assignment: {
          id: a.id,
          status: a.status,
          rate: a.rate,
          fee: a.fee,
          confirmed_at: a.confirmed_at,
        },
        role_name: (slot?.staff_role as any)?.name || 'Staff',
        venue: venueOrg
          ? {
              name: venueOrg.name,
              address_line1: venueOrg.address_line1 || undefined,
              phone_number: venueOrg.phone_number || undefined,
            }
          : undefined,
        schedule_entries: scheduleByGig.get(gig.id) || [],
      });
    }

    results.sort((a, b) => new Date(a.gig.start).getTime() - new Date(b.gig.start).getTime());

    return results;
  } catch (err) {
    return handleApiError(err, 'fetch upcoming assignments') as never;
  }
}
