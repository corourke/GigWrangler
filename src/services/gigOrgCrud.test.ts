import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { getGig, countChildGigs } from './gig.service';
import { getGigParticipants } from './gigParticipant.service';
import { getGigParticipantContacts } from './gigParticipantContacts.service';
import { getGigScheduleEntries } from './gigSchedule.service';
import { getOrganizationMembers, getOrganizationContacts } from './organization.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));

// #20: characterization of the plain gig and organization reads before they move onto the
// shared base helpers. Each test pins the exact query (table, every chained call and its
// arguments, in order), the value returned, a database error passed on unchanged, and the
// message a lost connection shows.

const METHODS = ['select', 'eq', 'neq', 'in', 'or', 'order', 'limit', 'range', 'insert', 'update', 'delete'];

let calls: unknown[][];
let result: any;
let consoleError: ReturnType<typeof vi.spyOn>;

function fakeSupabase() {
  const chain: any = {};
  for (const m of METHODS) {
    chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return chain; };
  }
  for (const m of ['single', 'maybeSingle']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return Promise.resolve(result); };
  }
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return { from: (table: string) => { calls.push(['from', table]); return chain; } };
}

const DB_ERROR = { code: '42501', message: 'permission denied', details: null, hint: null };
const NET_ERROR = { message: 'Failed to fetch' };
const networkMessage = (context: string) =>
  `Network error: Unable to ${context}. Please check your internet connection.`;

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  result = { data: null, error: null };
  (createClient as any).mockImplementation(() => fakeSupabase());
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/** The DB error comes back as the same object, logged once; a lost connection gets the context's words. */
function pinsErrors(context: string, run: () => Promise<unknown>, errorResult: (e: any) => object = (e) => ({ data: null, error: e })) {
  it('passes a database error on unchanged, logged once', async () => {
    result = errorResult(DB_ERROR);
    const err = await run().then(() => null, (e) => e);
    expect(err).toBe(DB_ERROR);
    expect(err.code).toBe('42501');
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(`Error ${context}:`, DB_ERROR);
  });

  it('turns a lost connection into a NetworkError with its own words', async () => {
    result = errorResult(NET_ERROR);
    const err = await run().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe(networkMessage(context));
    expect(consoleError).not.toHaveBeenCalled();
  });
}

const GIG_SELECT = "\n        *,\n        participants:gig_participants(\n          *,\n          organization:organization_id(*)\n        ),\n        schedule_entries:gig_schedule_entries(\n          *,\n          act_participant:act_participant_id(\n            id,\n            role,\n            organization:organization_id(id, name)\n          )\n        ),\n        staff_slots:gig_staff_slots(\n          *,\n          role_info:staff_roles(name),\n          assignments:gig_staff_assignments(\n            *,\n            user:user_id(id, email, first_name, last_name, phone)\n          )\n        ),\n        kit_assignments:gig_kit_assignments(*),\n        financials:gig_financials(*)\n      ";
const GPC_SELECT = "\n        id,\n        gig_id,\n        organization_id,\n        user_id,\n        is_primary_contact,\n        title,\n        created_at,\n        user:users(id, first_name, last_name, email, phone)\n      ";
const SCHEDULE_SELECT = "\n        *,\n        act_participant:act_participant_id(\n          id,\n          role,\n          organization:organization_id(id, name)\n        )\n      ";
const MEMBERS_SELECT = "\n        *,\n        user:users(\n          id,\n          first_name,\n          last_name,\n          email,\n          phone,\n          avatar_url,\n          address_line1,\n          address_line2,\n          city,\n          state,\n          postal_code,\n          country,\n          user_status\n        )\n      ";
const CONTACTS_SELECT = "\n        id,\n        organization_id,\n        user_id,\n        role,\n        contact_title,\n        is_primary_contact,\n        created_at,\n        user:users(\n          id,\n          first_name,\n          last_name,\n          email,\n          phone,\n          user_status\n        )\n      ";

describe('getGig', () => {
  it('reads one gig by id with .single(), and shapes its slots and schedule', async () => {
    result = {
      data: {
        id: 'g1',
        tags: null,
        staff_slots: [{ id: 's1', role_info: { name: 'Audio' }, required_count: 2, assignments: [{ id: 'a1', user: { id: 'u1' } }] }],
        schedule_entries: [
          { id: 'e2', sort_order: 1, start_time: '2026-01-01T10:00:00Z' },
          { id: 'e1', sort_order: 0, start_time: '2026-01-01T12:00:00Z' },
        ],
      },
      error: null,
    };
    const gig: any = await getGig('g1');
    expect(calls).toEqual([
      ['from', 'gigs'],
      ['select', GIG_SELECT],
      ['eq', 'id', 'g1'],
      ['single'],
    ]);
    expect(gig).toEqual({
      id: 'g1',
      tags: [],
      staff_slots: [{
        id: 's1', role_info: { name: 'Audio' }, required_count: 2,
        assignments: [{ id: 'a1', user: { id: 'u1' } }],
        role: 'Audio', count: 2,
        staff_assignments: [{ id: 'a1', user: { id: 'u1' } }],
      }],
      schedule_entries: [
        { id: 'e1', sort_order: 0, start_time: '2026-01-01T12:00:00Z' },
        { id: 'e2', sort_order: 1, start_time: '2026-01-01T10:00:00Z' },
      ],
    });
  });

  it('throws "Gig not found" when no row comes back without an error', async () => {
    result = { data: null, error: null };
    await expect(getGig('g1')).rejects.toThrow('Gig not found');
  });

  pinsErrors('fetch gig details', () => getGig('g1'));
});

describe('countChildGigs', () => {
  it('counts the child gigs in one head request', async () => {
    result = { count: 4, error: null };
    expect(await countChildGigs('g1')).toBe(4);
    expect(calls).toEqual([
      ['from', 'gigs'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'parent_gig_id', 'g1'],
    ]);
  });

  it('reads no count as 0', async () => {
    result = { count: null, error: null };
    expect(await countChildGigs('g1')).toBe(0);
  });

  pinsErrors('count child gigs', () => countChildGigs('g1'), (e) => ({ count: null, error: e }));
});

describe('getGigParticipants', () => {
  it("lists the gig's participants with their organizations", async () => {
    const rows = [{ id: 'p1', role: 'Venue', organization: { id: 'o1', name: 'Hall' } }];
    result = { data: rows, error: null };
    expect(await getGigParticipants('g1')).toBe(rows);
    expect(calls).toEqual([
      ['from', 'gig_participants'],
      ['select', 'id, role, organization:organization_id(id, name)'],
      ['eq', 'gig_id', 'g1'],
    ]);
  });

  it('reads no rows as []', async () => {
    result = { data: null, error: null };
    expect(await getGigParticipants('g1')).toEqual([]);
  });

  pinsErrors('fetch gig participants', () => getGigParticipants('g1'));
});

describe('getGigParticipantContacts', () => {
  it('lists the contacts for one organization on one gig, primary first then oldest', async () => {
    const rows = [{ id: 'c1' }];
    result = { data: rows, error: null };
    expect(await getGigParticipantContacts('g1', 'o1')).toBe(rows);
    expect(calls).toEqual([
      ['from', 'gig_participant_contacts'],
      ['select', GPC_SELECT],
      ['eq', 'gig_id', 'g1'],
      ['eq', 'organization_id', 'o1'],
      ['order', 'is_primary_contact', { ascending: false }],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('reads no rows as []', async () => {
    result = { data: null, error: null };
    expect(await getGigParticipantContacts('g1', 'o1')).toEqual([]);
  });

  pinsErrors('fetch gig participant contacts', () => getGigParticipantContacts('g1', 'o1'));
});

describe('getGigScheduleEntries', () => {
  it("lists the gig's schedule in sort order, then start time", async () => {
    const rows = [{ id: 'e1' }];
    result = { data: rows, error: null };
    expect(await getGigScheduleEntries('g1')).toBe(rows);
    expect(calls).toEqual([
      ['from', 'gig_schedule_entries'],
      ['select', SCHEDULE_SELECT],
      ['eq', 'gig_id', 'g1'],
      ['order', 'sort_order', { ascending: true }],
      ['order', 'start_time', { ascending: true }],
    ]);
  });

  it('reads no rows as []', async () => {
    result = { data: null, error: null };
    expect(await getGigScheduleEntries('g1')).toEqual([]);
  });

  pinsErrors('fetch schedule entries', () => getGigScheduleEntries('g1'));
});

describe('getOrganizationMembers', () => {
  it("lists the organization's members, oldest first", async () => {
    const rows = [{ id: 'm1' }];
    result = { data: rows, error: null };
    expect(await getOrganizationMembers('o1')).toBe(rows);
    expect(calls).toEqual([
      ['from', 'organization_members'],
      ['select', MEMBERS_SELECT],
      ['eq', 'organization_id', 'o1'],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('reads no rows as []', async () => {
    result = { data: null, error: null };
    expect(await getOrganizationMembers('o1')).toEqual([]);
  });

  pinsErrors('fetch organization members', () => getOrganizationMembers('o1'));
});

describe('getOrganizationContacts', () => {
  it("lists the organization's contacts, primary first then oldest", async () => {
    const rows = [{ id: 'm1' }];
    result = { data: rows, error: null };
    expect(await getOrganizationContacts('o1')).toBe(rows);
    expect(calls).toEqual([
      ['from', 'organization_members'],
      ['select', CONTACTS_SELECT],
      ['eq', 'organization_id', 'o1'],
      ['order', 'is_primary_contact', { ascending: false }],
      ['order', 'created_at', { ascending: true }],
    ]);
  });

  it('reads no rows as []', async () => {
    result = { data: null, error: null };
    expect(await getOrganizationContacts('o1')).toEqual([]);
  });

  pinsErrors('fetch organization contacts', () => getOrganizationContacts('o1'));
});
