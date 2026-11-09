/**
 * Hook tests for Inventory Mode's server state (A10). The packing list is local-first: the device
 * copy shows at once, a fresh one replaces it online, and after a scan the screen re-reads the
 * device copy into the cache (no server call).
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { queryKeys } from '../../../lib/queryKeys'
import { useMobileInventoryData } from './useMobileInventoryData'

const data = vi.hoisted(() => ({
  loadGigPackingList: vi.fn(), readPackingListOnDevice: vi.fn(), getGigTitleOnDevice: vi.fn(),
  loadOrgIndex: vi.fn(), getOrgMemberNames: vi.fn(),
}))
vi.mock('../../../services/mobile/inventoryData.service', () => data)

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const setOnline = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  vi.clearAllMocks()
  setOnline(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  data.loadGigPackingList.mockResolvedValue({ gig_title: 'Fresh', kits: [] })
  data.getGigTitleOnDevice.mockResolvedValue('On Device')
  data.loadOrgIndex.mockResolvedValue({ records: [] })
  data.getOrgMemberNames.mockResolvedValue(new Map([['u1', 'Pat Lee']]))
})
afterEach(() => { setOnline(true); onlineManager.setOnline(true) })

describe('useMobileInventoryData', () => {
  it('loads the packing list, index and names under their keys', async () => {
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.packingList).toEqual({ gig_title: 'Fresh', kits: [] })
    expect(result.current.gigTitle).toBe('Fresh')
    expect(client.getQueryData(queryKeys.packingList('g1'))).toEqual({ gig_title: 'Fresh', kits: [] })
    await waitFor(() => expect(client.getQueryData(queryKeys.orgIndex('org-1'))).toEqual({ records: [] }))
    await waitFor(() => expect(result.current.memberNames.get('u1')).toBe('Pat Lee'))
    expect(client.getQueryData(queryKeys.orgMemberNames('org-1'))).toBeTruthy()
  })

  it('shows the device copy handed over before the fresh one arrives', async () => {
    let finish!: (v: unknown) => void
    data.loadGigPackingList.mockImplementation(async (_id: string, onCached: (c: unknown) => void) => {
      onCached({ gig_title: 'Cached', kits: [] })
      return new Promise((r) => { finish = r })
    })
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.packingList?.gig_title).toBe('Cached'))
    expect(result.current.loading).toBe(true)
    await act(async () => finish({ gig_title: 'Fresh', kits: [] }))
    await waitFor(() => expect(result.current.packingList?.gig_title).toBe('Fresh'))
  })

  it('falls back to the title of the gig on the device', async () => {
    data.loadGigPackingList.mockResolvedValue(null)
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.gigTitle).toBe('On Device'))
  })

  it('refreshPackingList re-reads the device copy into the cache, without a server load', async () => {
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    data.readPackingListOnDevice.mockResolvedValue({ gig_title: 'Fresh', kits: [{ id: 'k' }] })
    await act(() => result.current.refreshPackingList('g1'))
    await waitFor(() => expect(result.current.packingList?.kits).toHaveLength(1))
    expect(data.loadGigPackingList).toHaveBeenCalledTimes(1)
  })

  it('reloadPackingList loads it again and resolves when done', async () => {
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    data.loadGigPackingList.mockResolvedValue({ gig_title: 'Again', kits: [] })
    await act(() => result.current.reloadPackingList('g1'))
    await waitFor(() => expect(result.current.packingList?.gig_title).toBe('Again'))
  })

  it('runs while react-query thinks it is offline (the service decides), and skips member names offline', async () => {
    setOnline(false)
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useMobileInventoryData('g1', 'org-1'), { wrapper })
    await waitFor(() => expect(result.current.packingList).toBeTruthy())
    await waitFor(() => expect(data.loadOrgIndex).toHaveBeenCalled())
    expect(data.getOrgMemberNames).not.toHaveBeenCalled()
  })
})
