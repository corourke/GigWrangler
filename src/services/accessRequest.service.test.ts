import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAccessRequest, getOrgAccessRequests, decideAccessRequest, getModeratorAccessRequests, getMyPendingAccessRequests } from './accessRequest.service';
import { getMyNotifications, markNotificationRead } from './notification.service';

const invoke = vi.fn();
vi.mock('./base/dataAccess', () => ({ getSupabase: () => ({ functions: { invoke } }) }));

beforeEach(() => vi.clearAllMocks());

describe('access request service', () => {
  it('posts a request for the role', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'r1' }, error: null });
    expect(await createAccessRequest('org-1', 'Admin', 'hi')).toEqual({ id: 'r1' });
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-1/access-requests', { method: 'POST', body: { requested_role: 'Admin', message: 'hi' } });
  });

  it('lists an organization\'s requests, empty when there are none', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: null });
    expect(await getOrgAccessRequests('org-1')).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-1/access-requests', { method: 'GET' });
  });

  it('sends the decision and response message', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'r1' }, error: null });
    await decideAccessRequest('org-1', 'r1', 'approved', 'ok');
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-1/access-requests/r1', { method: 'PUT', body: { decision: 'approved', response_message: 'ok' } });
  });

  it('asks to join as Viewer', async () => {
    invoke.mockResolvedValueOnce({ data: { id: 'r2' }, error: null });
    await createAccessRequest('org-1', 'Viewer');
    expect(invoke).toHaveBeenCalledWith('server/organizations/org-1/access-requests', { method: 'POST', body: { requested_role: 'Viewer', message: undefined } });
  });

  it('reads the caller\'s own pending requests, empty when there are none', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: null });
    expect(await getMyPendingAccessRequests()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('server/me/access-requests', { method: 'GET' });
  });

  it('reads the moderator queue', async () => {
    invoke.mockResolvedValueOnce({ data: [{ id: 'r1' }], error: null });
    expect(await getModeratorAccessRequests()).toEqual([{ id: 'r1' }]);
    expect(invoke).toHaveBeenCalledWith('server/moderator/access-requests', { method: 'GET' });
  });
});

describe('notification service', () => {
  it('fetches the caller\'s notifications', async () => {
    invoke.mockResolvedValueOnce({ data: [{ id: 'n1' }], error: null });
    expect(await getMyNotifications()).toEqual([{ id: 'n1' }]);
    expect(invoke).toHaveBeenCalledWith('server/me/notifications', { method: 'GET' });
  });

  it('marks one read with PUT', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: null });
    await markNotificationRead('n1');
    expect(invoke).toHaveBeenCalledWith('server/notifications/n1/read', { method: 'PUT' });
  });
});
