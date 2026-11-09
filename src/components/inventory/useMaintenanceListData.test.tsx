import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMaintenanceListData } from './useMaintenanceListData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getMaintenanceList, updateMaintenance, returnToService } from '../../services/maintenance.service'

vi.mock('../../services/maintenance.service', () => ({ getMaintenanceList: vi.fn(), updateMaintenance: vi.fn(), returnToService: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useMaintenanceListData('org-1'), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getMaintenanceList).mockReset().mockResolvedValue({ inMaintenance: [], flagged: [] } as any)
  vi.mocked(updateMaintenance).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(returnToService).mockReset().mockResolvedValue('x' as any)
})

describe('useMaintenanceListData (A10)', () => {
  it('caches the list under the organization’s key, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.listQuery.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.maintenanceList('org-1'))).toEqual({ inMaintenance: [], flagged: [] })
    expect(client.getQueryCache().find({ queryKey: queryKeys.maintenanceList('org-1') })!.isStale()).toBe(true)
  })

  it('saving details and returning to service invalidate through the map', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.listQuery.isSuccess).toBe(true))
    await act(() => hook.result.current.updateDetails.mutateAsync({ assetId: 'a1', details: { notes: '', location: '', expectedBack: null } }))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.maintenance('org-1', 'a1')))
    invalidate.mockClear()
    await act(() => hook.result.current.returnToService.mutateAsync('a2'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.maintenance('org-1', 'a2')))
  })
})
