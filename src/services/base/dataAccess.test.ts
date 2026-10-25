import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../../utils/supabase/client';
import { requireAuth } from '../../utils/supabase/auth-utils';
import {
  listRecords,
  listAllRecords,
  countRecords,
  deleteOne,
  PAGE_SIZE,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  getCurrentUser,
  getSession,
} from './dataAccess';

vi.mock('../../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'ilike', 'gt', 'gte', 'lt', 'lte', 'is', 'or', 'order', 'limit', 'range'];
  chainMethods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('dataAccess', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  describe('listRecords', () => {
    it('selects everything with no options', async () => {
      const chain = makeChain({ data: [{ id: '1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await listRecords('organizations', { context: 'test' });

      expect(mockSupabase.from).toHaveBeenCalledWith('organizations');
      expect(chain.select).toHaveBeenCalledWith('*');
      expect(result).toEqual([{ id: '1' }]);
    });

    it('returns [] rather than null when the query has no rows', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      expect(await listRecords('organizations', { context: 'test' })).toEqual([]);
    });

    it('applies each typed filter with its operator', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await listRecords('organizations', {
        context: 'test',
        select: 'id, name',
        filters: [
          { column: 'organization_id', operator: 'eq', value: 'org-1' },
          { column: 'status', operator: 'in', value: ['active', 'pending'] },
        ],
        order: { column: 'name', ascending: false },
        limit: 10,
      });

      expect(chain.select).toHaveBeenCalledWith('id, name');
      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(chain.in).toHaveBeenCalledWith('status', ['active', 'pending']);
      expect(chain.order).toHaveBeenCalledWith('name', { ascending: false });
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it('normalizes a thrown Supabase error through handleApiError', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'boom' } }));
      await expect(listRecords('organizations', { context: 'test' })).rejects.toThrow('boom');
    });
  });

  describe('getRecord', () => {
    it('fetches a single row by id', async () => {
      const chain = makeChain({ data: { id: '1', name: 'Widget' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getRecord('organizations', '1', { context: 'test' });

      expect(chain.eq).toHaveBeenCalledWith('id', '1');
      expect(result).toEqual({ id: '1', name: 'Widget' });
    });

    it('returns null when nothing matches', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      expect(await getRecord('organizations', 'missing', { context: 'test' })).toBeNull();
    });
  });

  describe('createRecord', () => {
    it('inserts and returns the created row', async () => {
      const chain = makeChain({ data: { id: '1' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await createRecord('organizations', { name: 'New' }, { context: 'test' });

      expect(chain.insert).toHaveBeenCalledWith({ name: 'New' });
      expect(result).toEqual({ id: '1' });
    });
  });

  describe('updateRecord', () => {
    it('updates by id and returns the updated row', async () => {
      const chain = makeChain({ data: { id: '1', name: 'Updated' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await updateRecord('organizations', '1', { name: 'Updated' }, { context: 'test' });

      expect(chain.update).toHaveBeenCalledWith({ name: 'Updated' });
      expect(chain.eq).toHaveBeenCalledWith('id', '1');
      expect(result).toEqual({ id: '1', name: 'Updated' });
    });
  });

  describe('deleteRecord', () => {
    it('deletes by id', async () => {
      const chain = makeChain({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      await deleteRecord('organizations', '1', { context: 'test' });

      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', '1');
    });

    it('throws on a delete error', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'nope' } }));
      await expect(deleteRecord('organizations', '1', { context: 'test' })).rejects.toThrow('nope');
    });
  });

  // #20 PR A: what the helpers add so services can move onto them unchanged.
  describe('context', () => {
    it("names what couldn't be done when the connection is lost", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: { message: 'TypeError: Failed to fetch' } }));
      await expect(listRecords('gigs', { context: 'fetch gigs' }))
        .rejects.toThrow('Network error: Unable to fetch gigs. Please check your internet connection.');
    });

    it('passes a database error through untouched, code and all', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const dbError = { message: 'tax year is locked', code: '42501' };
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));
      await expect(updateRecord('purchases', '1', {}, { context: 'update purchase' })).rejects.toBe(dbError);
    });
  });

  describe('listRecords options', () => {
    it('applies an or filter and several orders, with nullsFirst only when given', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);
      await listRecords('assets', {
        context: 'test',
        or: 'status.eq.Maintenance,maintenance_pending.eq.true',
        order: [{ column: 'maintenance_since', ascending: false, nullsFirst: false }, { column: 'id' }],
      });
      expect(chain.or).toHaveBeenCalledWith('status.eq.Maintenance,maintenance_pending.eq.true');
      expect(chain.order).toHaveBeenNthCalledWith(1, 'maintenance_since', { ascending: false, nullsFirst: false });
      expect(chain.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    });
  });

  describe('listAllRecords', () => {
    it('reads page after page until a short one', async () => {
      const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
      const first = makeChain({ data: full, error: null });
      const second = makeChain({ data: [{ id: 'last' }], error: null });
      first.range = vi.fn().mockResolvedValue({ data: full, error: null });
      second.range = vi.fn().mockResolvedValue({ data: [{ id: 'last' }], error: null });
      mockSupabase.from.mockReturnValueOnce(first).mockReturnValueOnce(second);

      const rows = await listAllRecords('assets', { context: 'test', filters: [{ column: 'organization_id', operator: 'eq', value: 'o1' }], order: { column: 'id' } });
      expect(rows).toHaveLength(PAGE_SIZE + 1);
      expect(first.range).toHaveBeenCalledWith(0, PAGE_SIZE - 1);
      expect(second.range).toHaveBeenCalledWith(PAGE_SIZE, 2 * PAGE_SIZE - 1);
      expect(second.eq).toHaveBeenCalledWith('organization_id', 'o1');
    });
  });

  describe('countRecords', () => {
    it('counts without reading rows; no count is 0', async () => {
      const chain = makeChain({ data: null, error: null });
      (chain as any).then = (resolve: any) => Promise.resolve({ count: 4, error: null }).then(resolve);
      mockSupabase.from.mockReturnValue(chain);
      expect(await countRecords('gigs', { context: 'test', filters: [{ column: 'parent_gig_id', operator: 'eq', value: 'g1' }] })).toBe(4);
      expect(chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });

      (chain as any).then = (resolve: any) => Promise.resolve({ count: null, error: null }).then(resolve);
      expect(await countRecords('gigs', { context: 'test' })).toBe(0);
    });
  });

  describe('getRecord mode', () => {
    it("'single' makes a missing row an error", async () => {
      const chain = makeChain({ data: null, error: { message: 'no rows', code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(getRecord('kits', 'k1', { context: 'test', mode: 'single' })).rejects.toMatchObject({ code: 'PGRST116' });
      expect(chain.single).toHaveBeenCalled();
      expect(chain.maybeSingle).not.toHaveBeenCalled();
    });
  });

  describe('updateRecord audit', () => {
    it('stamps who and when only when asked', async () => {
      const chain = makeChain({ data: { id: '1' }, error: null });
      mockSupabase.from.mockReturnValue(chain);
      await updateRecord('kits', '1', { name: 'A' }, { context: 'test', audit: { updatedBy: 'u1', updatedAt: true } });
      expect(chain.update).toHaveBeenCalledWith({ name: 'A', updated_by: 'u1', updated_at: expect.any(String) });
      await updateRecord('kits', '1', { name: 'B' }, { context: 'test' });
      expect(chain.update).toHaveBeenLastCalledWith({ name: 'B' });
    });
  });

  describe('deleteOne', () => {
    it('confirms a row went', async () => {
      const chain = makeChain({ data: [{ id: '1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);
      await deleteOne('kits', '1', { context: 'delete kit', notFound: 'Kit not found.' });
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', '1');
      expect(chain.select).toHaveBeenCalled();
    });

    it("throws the service's own words when nothing was removed", async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      await expect(deleteOne('kits', '1', { context: 'delete kit', notFound: 'Kit not found, or you do not have permission to delete it.' }))
        .rejects.toThrow('Kit not found, or you do not have permission to delete it.');
    });
  });

  describe('getCurrentUser / getSession', () => {
    it('resolve through the existing requireAuth() path', async () => {
      const user = { id: 'user-1' };
      const session = { user, access_token: 'tok' };
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, session, user });

      expect(await getCurrentUser()).toEqual(user);
      expect(await getSession()).toEqual(session);
    });

    it('propagates the not-authenticated error', async () => {
      (requireAuth as any).mockRejectedValue(new Error('Not authenticated'));
      await expect(getCurrentUser()).rejects.toThrow('Not authenticated');
    });
  });
});
