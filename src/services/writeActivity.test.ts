import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logActivity } from './activityLog.service';
import { writeActivity, actorNameOf } from './writeActivity';

vi.mock('./activityLog.service', () => ({ logActivity: vi.fn() }));

describe('writeActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  const entry = {
    organization_id: 'o1', event_type: 'kit.updated' as const, entity_type: 'kit', entity_id: 'k1', gig_id: null,
    actor_display_name: 'Sam Ruiz', actor_org_name: 'Org', context: { kit_name: 'FOH', field_changes: [] },
  };

  it('writes the entry with the version and actor first, then the event fields, in that key order', async () => {
    (logActivity as any).mockResolvedValue(undefined);
    await writeActivity(entry);
    expect(JSON.stringify((logActivity as any).mock.calls[0][0])).toBe(JSON.stringify({
      organization_id: 'o1', event_type: 'kit.updated', entity_type: 'kit', entity_id: 'k1', gig_id: null,
      context: { context_version: 1, actor_display_name: 'Sam Ruiz', actor_org_name: 'Org', kit_name: 'FOH', field_changes: [] },
    }));
  });

  it('a failed write is logged and never thrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (logActivity as any).mockRejectedValue(new Error('down'));
    await expect(writeActivity(entry)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Activity log failed:', expect.any(Error));
  });
});

describe('actorNameOf', () => {
  it('is first and last name, else email, else empty', () => {
    expect(actorNameOf({ email: 'a@b.c', user_metadata: { first_name: 'Sam', last_name: 'Ruiz' } })).toBe('Sam Ruiz');
    expect(actorNameOf({ email: 'a@b.c', user_metadata: { first_name: 'Sam' } })).toBe('Sam');
    expect(actorNameOf({ email: 'a@b.c', user_metadata: {} })).toBe('a@b.c');
    expect(actorNameOf({})).toBe('');
  });
});
