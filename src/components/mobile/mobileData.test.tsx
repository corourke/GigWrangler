/**
 * Hook and invalidation tests for the mobile screens (A10). Mobile queries and writes use
 * networkMode 'always': the services decide the offline fallback, as before.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { queryKeys, mobileInvalidations } from '../../lib/queryKeys'
import { useMobileGigListData } from './useMobileGigListData'
import { useMobileGigDetailData } from './useMobileGigDetailData'
import { useMobileDashboardData } from './useMobileDashboardData'
import { useMobileSettingsData } from './useMobileSettingsData'

const gigs = vi.hoisted(() => ({
  getGigsForOrganization: vi.fn(), createGig: vi.fn(), updateGig: vi.fn(), getGig: vi.fn(),
  updateGigParticipants: vi.fn(), updateStaffAssignmentStatus: vi.fn(),
}))
vi.mock('../../services/gig.service', () => gigs)
const mine = vi.hoisted(() => ({ loadMyUpcomingAssignments: vi.fn(), setMyAssignmentStatus: vi.fn() }))
vi.mock('../../services/mobile/myAssignments.service', () => mine)
const devices = vi.hoisted(() => ({
  listMyDevices: vi.fn(), removeMyDevice: vi.fn(), getDeviceRegistrationOptions: vi.fn(), verifyDeviceRegistration: vi.fn(),
}))
vi.mock('../../services/mobile/devices.service', () => devices)
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn().mockResolvedValue({ id: 'cred' }) }))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const invalidated = () => vi.mocked(client.invalidateQueries).mock.calls.map(([f]) => f)

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.spyOn(client, 'invalidateQueries')
})
afterEach(() => onlineManager.setOnline(true))

describe('invalidation map (mobile)', () => {
  it('names the caches each write refreshes', () => {
    expect(mobileInvalidations.assignmentAnswered('g1')).toEqual([
      { queryKey: queryKeys.gig('g1') },
      { queryKey: ['myUpcomingAssignments'], refetchType: 'none' },
    ])
    // Not refetched at once: offline, the service would answer with the device copy, undoing the change on screen.
    expect(mobileInvalidations.myAssignmentAnswered()).toEqual([{ queryKey: ['myUpcomingAssignments'], refetchType: 'none' }])
    expect(mobileInvalidations.devicesChanged()).toEqual([{ queryKey: queryKeys.myDevices() }])
  })

  it('mobile keys sit under the shared gig keys, so a desktop write refreshes them too', () => {
    expect(queryKeys.mobileGigs('org-1').slice(0, 2)).toEqual(queryKeys.gigs('org-1'))
    expect(queryKeys.mobileGig('g1').slice(0, 2)).toEqual(queryKeys.gig('g1'))
  })
})

describe('useMobileGigListData', () => {
  it('loads the org’s gigs under mobileGigs(org), even when react-query thinks it is offline', async () => {
    onlineManager.setOnline(false)
    gigs.getGigsForOrganization.mockResolvedValue([{ id: 'g1' }])
    const { result } = renderHook(() => useMobileGigListData('org-1'), { wrapper })
    await waitFor(() => expect(result.current.gigs).toHaveLength(1))
    expect(client.getQueryData(queryKeys.mobileGigs('org-1'))).toHaveLength(1)
  })

  it('a status change refreshes the gig caches and resolves after the reload', async () => {
    gigs.getGigsForOrganization.mockResolvedValue([])
    gigs.updateGig.mockResolvedValue(undefined)
    const { result } = renderHook(() => useMobileGigListData('org-1'), { wrapper })
    await act(() => result.current.changeStatus.mutateAsync({ gigId: 'g1', status: 'Completed' }))
    expect(gigs.updateGig).toHaveBeenCalledWith('g1', { status: 'Completed' })
    // The shared map: the gig, the org's gig lists and the dashboard.
    expect(invalidated()).toEqual([
      { queryKey: queryKeys.gig('g1') },
      { queryKey: queryKeys.gigs('org-1') },
      { queryKey: queryKeys.dashboard('org-1') },
    ])
  })
})

describe('useMobileGigDetailData', () => {
  it('loads the gig with its venue and act under mobileGig(gig)', async () => {
    gigs.getGig.mockResolvedValue({ id: 'g1', participants: [{ role: 'Venue', organization: { name: 'Hall' } }] })
    const { result } = renderHook(() => useMobileGigDetailData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.gigQuery.data?.venue).toEqual({ name: 'Hall' }))
    expect(client.getQueryData(queryKeys.mobileGig('g1'))).toBeTruthy()
  })

  it('answering an assignment refreshes the gig and marks My Schedule stale', async () => {
    gigs.getGig.mockResolvedValue({ id: 'g1', participants: [] })
    gigs.updateStaffAssignmentStatus.mockResolvedValue(undefined)
    const { result } = renderHook(() => useMobileGigDetailData('g1', 'org-1'), { wrapper })
    await act(() => result.current.answerAssignment.mutateAsync({ assignmentId: 'a1', status: 'Confirmed' }))
    expect(invalidated()).toEqual(mobileInvalidations.assignmentAnswered('g1'))
  })
})

describe('useMobileDashboardData', () => {
  it('loads My Schedule under myUpcomingAssignments(user, org)', async () => {
    mine.loadMyUpcomingAssignments.mockResolvedValue([{ assignment: { id: 'a1', status: 'Invited' } }])
    const { result } = renderHook(() => useMobileDashboardData({ userId: 'u1', orgId: 'org-1', enabled: true }), { wrapper })
    await waitFor(() => expect(result.current.assignments).toHaveLength(1))
    expect(client.getQueryData(queryKeys.myUpcomingAssignments('u1', 'org-1'))).toHaveLength(1)
  })

  it('confirming updates the cache at once and rolls back on failure', async () => {
    mine.loadMyUpcomingAssignments.mockResolvedValue([{ assignment: { id: 'a1', status: 'Invited' } }])
    mine.setMyAssignmentStatus.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useMobileDashboardData({ userId: 'u1', orgId: 'org-1', enabled: true }), { wrapper })
    await waitFor(() => expect(result.current.assignments).toHaveLength(1))
    await act(async () => {
      await result.current.answer.mutateAsync({ assignmentId: 'a1', status: 'Confirmed' }).catch(() => {})
    })
    expect(mine.setMyAssignmentStatus).toHaveBeenCalledWith('a1', 'Confirmed')
    expect(result.current.assignments[0].assignment.status).toBe('Invited')
  })
})

describe('useMobileSettingsData', () => {
  it('lists devices under myDevices, and removing one drops it and refreshes', async () => {
    devices.listMyDevices.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }])
    devices.removeMyDevice.mockResolvedValue(undefined)
    const { result } = renderHook(() => useMobileSettingsData(), { wrapper })
    await waitFor(() => expect(result.current.devicesQuery.data).toHaveLength(2))
    devices.listMyDevices.mockReturnValue(new Promise(() => {}))
    await act(() => result.current.removeDevice.mutateAsync('d1'))
    expect(client.getQueryData<{ id: string }[]>(queryKeys.myDevices())!.map((d) => d.id)).toEqual(['d2'])
    expect(invalidated()).toEqual(mobileInvalidations.devicesChanged())
  })
})
