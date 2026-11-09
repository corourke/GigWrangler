/**
 * Hook and invalidation tests for the organization and settings screens (A10).
 * Each screen reads through a co-located use<Screen>Data hook keyed by queryKeys, and each
 * write refreshes the caches named in the invalidation map.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../lib/queryKeys';
import { useOrganizationScreenData } from './useOrganizationScreenData';
import { useAdminOrganizationsData } from './useAdminOrganizationsData';
import { useTeamMemberDetailData } from './useTeamMemberDetailData';
import { useOrganizationSelectionData } from './useOrganizationSelectionData';
import { useOrganizationSearch } from './useOrganizationSelectorData';
import { useUserSelectorSearch } from './useUserSelectorData';
import { useTwoFactorSettingsData } from './security/useTwoFactorSettingsData';
import { useCalendarIntegrationData } from './useCalendarIntegrationData';

const org = vi.hoisted(() => ({
  getOrganizationEditPermissions: vi.fn(),
  hasSignedInSession: vi.fn(),
  getAdminOrganizationsOverview: vi.fn(),
  deleteOrganization: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  getOrganizationMember: vi.fn(),
  removeMember: vi.fn(),
  searchOrganizations: vi.fn(),
  joinOrganization: vi.fn(),
  signedInEmailConfirmed: vi.fn(),
}));
vi.mock('../services/organization.service', () => org);
const access = vi.hoisted(() => ({ createAccessRequest: vi.fn(), getMyPendingAccessRequests: vi.fn() }));
vi.mock('../services/accessRequest.service', () => access);
const users = vi.hoisted(() => ({ searchUsers: vi.fn() }));
vi.mock('../services/user.service', () => users);
const tfa = vi.hoisted(() => ({
  getTwoFactorStatus: vi.fn(), startTwoFactorSetup: vi.fn(), confirmTwoFactorSetup: vi.fn(), removeTwoFactor: vi.fn(),
}));
vi.mock('../services/twoFactor.service', () => tfa);
const cal = vi.hoisted(() => ({
  getUserGoogleCalendarSettings: vi.fn(), getUserCalendars: vi.fn(), getSyncLogs: vi.fn(), getSyncStatusSummary: vi.fn(),
  updateUserGoogleCalendarSettings: vi.fn(), disconnectGoogleCalendar: vi.fn(),
}));
vi.mock('../services/googleCalendar.service', () => cal);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const invalidated = () => vi.mocked(client.invalidateQueries).mock.calls.map(([f]) => f);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
});

describe('invalidation map (organizations and settings)', () => {
  it('names the caches each write refreshes', () => {
    expect(orgSettingsInvalidations.organizationSaved('org-1')).toEqual([
      { queryKey: ['organizationPermissions', 'org-1'] },
      { queryKey: ['adminOrganizations'] },
      { queryKey: ['organizationSearch'] },
    ]);
    expect(orgSettingsInvalidations.organizationDeleted()).toEqual([
      { queryKey: ['adminOrganizations'] },
      { queryKey: ['organizationSearch'] },
    ]);
    // Only the team list: the removed member's own detail must not refetch (it no longer exists).
    expect(orgSettingsInvalidations.memberRemoved('org-1')).toEqual([{ queryKey: queryKeys.team('org-1'), exact: true }]);
    expect(orgSettingsInvalidations.accessRequested('u1')).toEqual([
      { queryKey: queryKeys.myPendingAccessRequests('u1'), refetchType: 'none' },
    ]);
    expect(orgSettingsInvalidations.twoFactorChanged()).toEqual([{ queryKey: queryKeys.twoFactorStatus() }]);
    expect(orgSettingsInvalidations.calendarEnabled('u1')).toEqual([
      { queryKey: queryKeys.googleCalendars('u1') },
      { queryKey: queryKeys.calendarSyncData('u1') },
    ]);
    expect(orgSettingsInvalidations.calendarSynced('u1')).toEqual([{ queryKey: queryKeys.calendarSyncData('u1') }]);
  });
});

describe('useOrganizationScreenData', () => {
  it('loads edit permissions under organizationPermissions(org, user)', async () => {
    org.getOrganizationEditPermissions.mockResolvedValue({ isGlobalAdmin: false, isOrgAdmin: true, hasMembers: true });
    const { result } = renderHook(() => useOrganizationScreenData({ organizationId: 'org-1', userId: 'u1' }), { wrapper });
    await waitFor(() => expect(result.current.permissions).toEqual({ isGlobalAdmin: false, isOrgAdmin: true, hasMembers: true }));
    expect(org.getOrganizationEditPermissions).toHaveBeenCalledWith('org-1', 'u1');
    expect(client.getQueryData(queryKeys.organizationPermissions('org-1', 'u1'))).toBeTruthy();
  });

  it('makes no call when creating', () => {
    const { result } = renderHook(() => useOrganizationScreenData({ userId: 'u1' }), { wrapper });
    expect(result.current.permissions).toEqual({ isGlobalAdmin: false, isOrgAdmin: false, hasMembers: false });
    expect(org.getOrganizationEditPermissions).not.toHaveBeenCalled();
  });

  it('saving refreshes the organization caches', async () => {
    org.updateOrganization.mockResolvedValue({ id: 'org-1', name: 'Renamed' });
    const { result } = renderHook(() => useOrganizationScreenData({ organizationId: 'org-1', userId: 'u1' }), { wrapper });
    await act(() => result.current.saveOrganization.mutateAsync({ organizationId: 'org-1', body: { name: 'Renamed' } }));
    expect(org.updateOrganization).toHaveBeenCalledWith('org-1', { name: 'Renamed' });
    expect(invalidated()).toEqual(orgSettingsInvalidations.organizationSaved('org-1'));
  });

  it('creating passes the join choice to the service', async () => {
    org.createOrganization.mockResolvedValue({ id: 'org-2' });
    const { result } = renderHook(() => useOrganizationScreenData({ userId: 'u1' }), { wrapper });
    await act(() => result.current.saveOrganization.mutateAsync({ body: { name: 'New' }, autoJoin: false }));
    expect(org.createOrganization).toHaveBeenCalledWith({ name: 'New', autoJoin: false });
  });
});

describe('useAdminOrganizationsData', () => {
  const args = { userId: 'u1', memberOrgIds: ['org-a'], adminOrgIds: ['org-a'] };

  it('loads the overview under adminOrganizations(user)', async () => {
    org.getAdminOrganizationsOverview.mockResolvedValue([{ id: 'org-a', name: 'A', member_count: 2 }]);
    const { result } = renderHook(() => useAdminOrganizationsData(args), { wrapper });
    await waitFor(() => expect(result.current.organizationsQuery.data).toHaveLength(1));
    expect(org.getAdminOrganizationsOverview).toHaveBeenCalledWith(args);
    expect(client.getQueryData(queryKeys.adminOrganizations('u1'))).toHaveLength(1);
  });

  it('deleting drops the row from the cache and refreshes', async () => {
    org.getAdminOrganizationsOverview.mockResolvedValue([{ id: 'org-a' }, { id: 'org-b' }]);
    org.deleteOrganization.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminOrganizationsData(args), { wrapper });
    await waitFor(() => expect(result.current.organizationsQuery.data).toHaveLength(2));
    org.getAdminOrganizationsOverview.mockReturnValue(new Promise(() => {}));
    await act(() => result.current.deleteOrganization.mutateAsync('org-a'));
    expect(org.deleteOrganization).toHaveBeenCalledWith('org-a');
    expect(client.getQueryData<{ id: string }[]>(queryKeys.adminOrganizations('u1'))!.map((o) => o.id)).toEqual(['org-b']);
    expect(invalidated()).toEqual(orgSettingsInvalidations.organizationDeleted());
  });
});

describe('useTeamMemberDetailData', () => {
  it('loads the member under teamMember(org, member)', async () => {
    org.getOrganizationMember.mockResolvedValue({ id: 'm1' });
    const { result } = renderHook(() => useTeamMemberDetailData('org-1', 'm1'), { wrapper });
    await waitFor(() => expect(result.current.memberQuery.data).toEqual({ id: 'm1' }));
    expect(client.getQueryData(queryKeys.teamMember('org-1', 'm1'))).toEqual({ id: 'm1' });
  });

  it('removing refreshes only the team list', async () => {
    org.getOrganizationMember.mockResolvedValue({ id: 'm1' });
    org.removeMember.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTeamMemberDetailData('org-1', 'm1'), { wrapper });
    await act(() => result.current.removeMember.mutateAsync());
    expect(org.removeMember).toHaveBeenCalledWith('org-1', 'm1');
    expect(invalidated()).toEqual(orgSettingsInvalidations.memberRemoved('org-1'));
  });
});

describe('useOrganizationSelectionData', () => {
  it('loads pending requests and email confirmation per user', async () => {
    access.getMyPendingAccessRequests.mockResolvedValue([{ organization_id: 'org-1' }]);
    org.signedInEmailConfirmed.mockResolvedValue(true);
    const { result } = renderHook(() => useOrganizationSelectionData('u1'), { wrapper });
    await waitFor(() => expect(result.current.pendingOrgIds.has('org-1')).toBe(true));
    await waitFor(() => expect(result.current.emailConfirmed).toBe(true));
    expect(client.getQueryData(queryKeys.myPendingAccessRequests('u1'))).toHaveLength(1);
    expect(client.getQueryData(queryKeys.emailConfirmed('u1'))).toBe(true);
  });

  it('a request to join marks the org pending in the cache', async () => {
    access.getMyPendingAccessRequests.mockResolvedValue([]);
    org.signedInEmailConfirmed.mockResolvedValue(false);
    access.createAccessRequest.mockResolvedValue({ id: 'r1' });
    const { result } = renderHook(() => useOrganizationSelectionData('u1'), { wrapper });
    await waitFor(() => expect(access.getMyPendingAccessRequests).toHaveBeenCalled());
    await act(() => result.current.requestToJoin.mutateAsync('org-9'));
    expect(access.createAccessRequest).toHaveBeenCalledWith('org-9', 'Viewer');
    await waitFor(() => expect(result.current.pendingOrgIds.has('org-9')).toBe(true));
    expect(invalidated()).toEqual(orgSettingsInvalidations.accessRequested('u1'));
  });
});

describe('useOrganizationSearch (debounced)', () => {
  it('searches only the settled term, under organizationSearch(term, type)', async () => {
    org.searchOrganizations.mockResolvedValue([{ id: 'o1' }]);
    const { result, rerender } = renderHook(({ q }) => useOrganizationSearch(q, { type: 'Venue', delayMs: 20 }), {
      wrapper, initialProps: { q: '' },
    });
    expect(result.current.isSearching).toBe(false);
    rerender({ q: 'ac' });
    expect(result.current.isSearching).toBe(true);
    rerender({ q: 'acme' });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.isSearching).toBe(false);
    expect(org.searchOrganizations).toHaveBeenCalledTimes(1);
    expect(org.searchOrganizations).toHaveBeenCalledWith({ search: 'acme', type: 'Venue' });
    expect(client.getQueryData(queryKeys.organizationSearch('acme', 'Venue'))).toHaveLength(1);
  });

  it('a blank term makes no call and has no results', () => {
    const { result } = renderHook(() => useOrganizationSearch('  ', { delayMs: 0 }), { wrapper });
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(org.searchOrganizations).not.toHaveBeenCalled();
  });
});

describe('useUserSelectorSearch', () => {
  it('searches under userSelectorSearch(term, orgIds)', async () => {
    users.searchUsers.mockResolvedValue([{ id: 'p1' }]);
    const { result } = renderHook(() => useUserSelectorSearch('av', ['org-1']), { wrapper });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(users.searchUsers).toHaveBeenCalledWith('av', ['org-1']);
    expect(client.getQueryData(queryKeys.userSelectorSearch('av', ['org-1']))).toHaveLength(1);
  });
});

describe('useTwoFactorSettingsData', () => {
  it('loads status, and confirming waits for the refreshed status', async () => {
    tfa.getTwoFactorStatus.mockResolvedValue({ factors: [] });
    tfa.confirmTwoFactorSetup.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTwoFactorSettingsData(), { wrapper });
    await waitFor(() => expect(result.current.statusQuery.data).toEqual({ factors: [] }));
    expect(client.getQueryData(queryKeys.twoFactorStatus())).toEqual({ factors: [] });
    await act(() => result.current.confirmSetup.mutateAsync({ factorId: 'f1', code: '123456' }));
    expect(tfa.confirmTwoFactorSetup).toHaveBeenCalledWith('f1', '123456');
    expect(invalidated()).toEqual(orgSettingsInvalidations.twoFactorChanged());
  });

  it('removing refreshes the status', async () => {
    tfa.getTwoFactorStatus.mockResolvedValue({ factors: [] });
    tfa.removeTwoFactor.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTwoFactorSettingsData(), { wrapper });
    await act(() => result.current.removeFactor.mutateAsync('f1'));
    expect(tfa.removeTwoFactor).toHaveBeenCalledWith('f1');
    expect(invalidated()).toEqual(orgSettingsInvalidations.twoFactorChanged());
  });
});

describe('useCalendarIntegrationData', () => {
  const settings = { calendar_id: 'c1', is_enabled: true, token_expires_at: '2099-01-01T00:00:00Z' };

  it('loads settings, then calendars and sync data, each under its own key', async () => {
    cal.getUserGoogleCalendarSettings.mockResolvedValue(settings);
    cal.getUserCalendars.mockResolvedValue([{ id: 'c1' }]);
    cal.getSyncLogs.mockResolvedValue([]);
    cal.getSyncStatusSummary.mockResolvedValue({ total: 1 });
    const { result } = renderHook(() => useCalendarIntegrationData('u1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getQueryData(queryKeys.calendarSettings('u1'))).toEqual(settings);
    expect(client.getQueryData(queryKeys.googleCalendars('u1'))).toEqual([{ id: 'c1' }]);
    expect(client.getQueryData(queryKeys.calendarSyncData('u1'))).toEqual({ logs: [], summary: { total: 1 } });
  });

  it('a settings write stores the saved settings', async () => {
    cal.getUserGoogleCalendarSettings.mockResolvedValue({ ...settings, is_enabled: false, token_expires_at: '2000-01-01T00:00:00Z' });
    cal.updateUserGoogleCalendarSettings.mockResolvedValue({ ...settings, calendar_id: 'c2' });
    cal.getUserCalendars.mockResolvedValue([]);
    cal.getSyncLogs.mockResolvedValue([]);
    cal.getSyncStatusSummary.mockResolvedValue(null);
    const { result } = renderHook(() => useCalendarIntegrationData('u1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.updateSettings.mutateAsync({ calendar_id: 'c2' }));
    expect(client.getQueryData<{ calendar_id: string }>(queryKeys.calendarSettings('u1'))!.calendar_id).toBe('c2');
  });
});
