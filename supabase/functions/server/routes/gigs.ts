import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { requireOrgRole } from '../lib/orgRole.ts';
import { requireGigAccess } from '../lib/gigAccess.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { DASHBOARD_ASSET_COLUMNS, sumAssetValues } from '../lib/pure/dashboard.ts';

export function registerGigs(app: App) {
  // List gigs for an org the caller belongs to
  app.get('/gigs', requireUser, requireOrgRole({ getOrgId: (c) => c.req.query('organization_id') }), async (c) => {
    const organizationId = c.req.query('organization_id')!;

    const { data: gigParticipants, error } = await supabaseAdmin
      .from('gig_participants').select('*, gig:gigs(*)').eq('organization_id', organizationId);
    if (error) {
      console.error('Error fetching gigs:', error);
      return c.json({ error: error.message }, 400);
    }

    const gigsMap = new Map();
    for (const gp of gigParticipants || []) {
      if (gp.gig) gigsMap.set(gp.gig.id, gp.gig);
    }
    const gigs = Array.from(gigsMap.values());

    const gigsWithParticipants = await Promise.all(
      gigs.map(async (gig) => {
        const { data: participants } = await supabaseAdmin
          .from('gig_participants').select('*, organization:organization_id(*)').eq('gig_id', gig.id);
        const venue = participants?.find((p: any) => p.role === 'Venue')?.organization;
        const act = participants?.find((p: any) => p.role === 'Act')?.organization;
        return { ...gig, venue, act };
      })
    );
    gigsWithParticipants.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
    return c.json(gigsWithParticipants);
  });

  // Get a single gig (any member of a participant org — intersection)
  app.get('/gigs/:id', requireUser, requireGigAccess(), async (c) => {
    const gigId = c.req.param('id');
    const { data: gig, error } = await supabaseAdmin
      .from('gigs').select('*').eq('id', gigId).single();
    if (error) {
      console.error('Error fetching gig:', error);
      return c.json({ error: error.message }, 400);
    }
    const { data: participants } = await supabaseAdmin
      .from('gig_participants').select('*, organization:organization_id(*)').eq('gig_id', gig.id);
    return c.json({ ...gig, participants: participants || [] });
  });

  // Gigs are created with the create_gig_complex RPC and edited and deleted
  // through RLS-guarded table writes; the server's old create, update and
  // delete routes were unused, so they were removed (delete: #175).

  // Organization dashboard stats (Admin/Manager/Staff)
  app.get('/organizations/:id/dashboard', requireUser, requireOrgRole({ roles: ['Admin', 'Manager', 'Staff'] }), async (c) => {
    const orgId = c.req.param('id');
    const membership = c.get('membership')!;
    const isAdminOrManager = ['Admin', 'Manager'].includes(membership.role);

    const { data: gigsByStatus } = await supabaseAdmin
      .from('gig_participants').select('gig_id, gigs!inner(id, status)').eq('organization_id', orgId);
    const statusCounts: Record<string, number> = { DateHold: 0, Proposed: 0, Booked: 0, Completed: 0, Cancelled: 0, Settled: 0 };
    (gigsByStatus || []).forEach((gp: any) => {
      const status = gp.gigs?.status;
      if (status && Object.prototype.hasOwnProperty.call(statusCounts, status)) statusCounts[status]++;
    });

    const { data: assets, error: assetsError } = await supabaseAdmin
      .from('assets').select(DASHBOARD_ASSET_COLUMNS).eq('organization_id', orgId);
    if (assetsError) {
      console.error('Error fetching assets for dashboard:', assetsError);
      return c.json({ error: assetsError.message }, 500);
    }
    const equipment = sumAssetValues(assets);
    // Values are for Admins and Managers; what is owned is shown to Staff too.
    const { totalAssetValue, totalInsuredValue } = isAdminOrManager
      ? equipment
      : { totalAssetValue: 0, totalInsuredValue: 0 };
    const { ownedItems, ownedPieces } = equipment;

    const { data: kits, error: kitsError } = await supabaseAdmin.from('kits').select('rental_value').eq('organization_id', orgId);
    if (kitsError) {
      console.error('Error fetching kits for dashboard:', kitsError);
      return c.json({ error: kitsError.message }, 500);
    }
    let totalRentalValue = 0;
    if (isAdminOrManager) {
      (kits || []).forEach((kit: any) => { if (kit.rental_value) totalRentalValue += parseFloat(kit.rental_value); });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let revenueThisYear = 0;
    if (isAdminOrManager) {
      // Revenue = money received, by when it arrived.
      const received = () => supabaseAdmin
        .from('gig_financials').select('amount_settled')
        .eq('organization_id', orgId).eq('direction', 'in').eq('stage', 'paid');
      const total = (rows: any[] | null) =>
        (rows || []).reduce((sum: number, f: any) => sum + parseFloat(f.amount_settled), 0);

      // By tax date, a calendar day (B1): compare with calendar days, not instants.
      const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const { data: thisMonthFin } = await received().gte('tax_date', day(startOfMonth));
      revenueThisMonth = total(thisMonthFin);

      const { data: lastMonthFin } = await received()
        .gte('tax_date', day(startOfLastMonth)).lt('tax_date', day(startOfMonth));
      revenueLastMonth = total(lastMonthFin);

      const { data: thisYearFin } = await received().gte('tax_date', day(startOfYear));
      revenueThisYear = total(thisYearFin);
    }

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const { data: upcomingGigsData } = await supabaseAdmin
      .from('gig_participants')
      .select(`gig_id, gigs!inner(id, title, start, status)`)
      .eq('organization_id', orgId)
      .gte('gigs.start', now.toISOString())
      .lte('gigs.start', thirtyDaysFromNow.toISOString())
      .in('gigs.status', ['DateHold', 'Proposed', 'Booked'])
      .order('gigs(start)', { ascending: true })
      .limit(10);

    const upcomingGigs = await Promise.all(
      (upcomingGigsData || []).map(async (gp: any) => {
        const gigId = gp.gigs.id;
        const { data: actParticipant } = await supabaseAdmin
          .from('gig_participants').select('organization:organizations(name)').eq('gig_id', gigId).eq('role', 'Act').maybeSingle();
        const { data: venueParticipant } = await supabaseAdmin
          .from('gig_participants').select('organization:organizations(name)').eq('gig_id', gigId).eq('role', 'Venue').maybeSingle();
        const { data: slots } = await supabaseAdmin
          .from('gig_staff_slots').select(`id, required_count, gig_staff_assignments(id, status)`).eq('gig_id', gigId)
          .eq('organization_id', orgId); // this org's staffing only (#61)

        let unfilledSlots = 0, unconfirmedAssignments = 0, rejectedAssignments = 0, confirmedAssignments = 0;
        (slots || []).forEach((slot: any) => {
          const assignments = slot.gig_staff_assignments || [];
          const confirmedCount = assignments.filter((a: any) => a.status === 'Confirmed').length;
          const unconfirmedCount = assignments.filter((a: any) => a.status !== 'Confirmed' && a.status !== 'Rejected').length;
          const rejectedCount = assignments.filter((a: any) => a.status === 'Rejected').length;
          confirmedAssignments += confirmedCount;
          unconfirmedAssignments += unconfirmedCount;
          rejectedAssignments += rejectedCount;
          if (confirmedCount < slot.required_count) unfilledSlots += (slot.required_count - confirmedCount);
        });

        return {
          id: gp.gigs.id, title: gp.gigs.title, start: gp.gigs.start, status: gp.gigs.status,
          // A to-one embed: an object at runtime, typed as a list without generated types.
          act: (actParticipant?.organization as unknown as { name?: string } | null)?.name || 'N/A',
          venue: (venueParticipant?.organization as unknown as { name?: string } | null)?.name || 'N/A',
          staffing: { unfilledSlots, unconfirmedAssignments, rejectedAssignments, confirmedAssignments },
        };
      })
    );

    return c.json({
      gigsByStatus: statusCounts,
      assetValues: { totalAssetValue, totalInsuredValue, totalRentalValue, ownedItems, ownedPieces },
      revenue: { thisMonth: revenueThisMonth, lastMonth: revenueLastMonth, thisYear: revenueThisYear },
      upcomingGigs,
    });
  });
}
