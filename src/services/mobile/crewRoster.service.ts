import { getSupabase } from '../base/dataAccess';

/** One line of the gig's crew roster (#466), as the `gig_crew_roster` function returns it. No pay. */
export interface RosterRow {
  assignment_id: string;
  slot_id: string;
  organization_id: string | null;
  organization_name: string | null;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  role_name: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
  arrived_at: string | null;
}

/** The crew of every organization on the gig, for an Admin or Manager of any of them; none for anyone else. */
export async function fetchGigCrewRoster(gigId: string): Promise<RosterRow[]> {
  const { data, error } = await getSupabase().rpc('gig_crew_roster', { p_gig_id: gigId });
  if (error) throw error;
  return (data ?? []) as RosterRow[];
}

/** Roster rows as day-sheet crew lines, leaving out assignments the sheet already lists. */
export function rosterToCrew(rows: readonly RosterRow[], knownAssignmentIds: ReadonlySet<string>) {
  return rows
    .filter((r) => !knownAssignmentIds.has(r.assignment_id))
    .map((r) => ({
      key: `roster-${r.assignment_id}`,
      name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      role: r.role_name ?? '',
      title: r.role_name,
      phone: r.phone,
      email: r.email,
      org_name: r.organization_name,
      user_id: r.user_id,
      status: r.status,
      organization_id: r.organization_id,
    }));
}
