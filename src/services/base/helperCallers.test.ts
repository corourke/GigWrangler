import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../../utils/supabase/client';
import { requireAuth } from '../../utils/supabase/auth-utils';
import { updateUserProfile } from '../user.service';
import { linkAttachmentToEntity, getEntityAttachments, unlinkAttachmentFromEntity } from '../attachment.service';

vi.mock('../../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));

// #20 PR A: the messages a lost connection shows today for the services already on the base
// helpers. The helpers' `context` becomes required; these must read exactly the same after.
describe('network-error messages from the base helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const offline = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const q: any = {};
    for (const m of ['select', 'eq', 'insert', 'update', 'delete', 'order', 'limit']) q[m] = vi.fn(() => q);
    q.single = vi.fn().mockResolvedValue(offline);
    q.maybeSingle = vi.fn().mockResolvedValue(offline);
    q.then = (resolve: any, reject: any) => Promise.resolve(offline).then(resolve, reject);
    const supabase = { from: vi.fn(() => q) };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1' } });
  });

  const net = (what: string) => `Network error: Unable to ${what}. Please check your internet connection.`;

  it('updateUserProfile', async () => {
    await expect(updateUserProfile('u1', { first_name: 'Sam' })).rejects.toThrow(net("update record in 'users'"));
  });

  it('linkAttachmentToEntity', async () => {
    await expect(linkAttachmentToEntity('a1', 'purchase' as any, 'p1')).rejects.toThrow(net("create record in 'entity_attachments'"));
  });

  it('getEntityAttachments', async () => {
    await expect(getEntityAttachments('purchase' as any, 'p1')).rejects.toThrow(net("list records from 'entity_attachments'"));
  });

  it('unlinkAttachmentFromEntity', async () => {
    await expect(unlinkAttachmentFromEntity('ea1')).rejects.toThrow(net("delete record from 'entity_attachments'"));
  });

  it('the thrown error is named NetworkError', async () => {
    await expect(getEntityAttachments('purchase' as any, 'p1')).rejects.toMatchObject({ name: 'NetworkError' });
  });
});
