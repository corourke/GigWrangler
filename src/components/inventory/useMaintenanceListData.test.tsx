import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useMaintenanceListData } from './useMaintenanceListData'
import { queryKeys } from '../../lib/queryKeys'
import { getMaintenanceList, updateMaintenance, returnToService } from '../../services/maintenance.service'

vi.mock('../../services/maintenance.service', () => ({ getMaintenanceList: vi.fn(), updateMaintenance: vi.fn(), returnToService: vi.fn() }))

function setup() {
  const client = makeTestQueryClient()
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
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(client.getQueryData(queryKeys.maintenanceList('org-1'))).toEqual({ inMaintenance: [], flagged: [] })
    expect(hook.result.current.error).toBeNull()
    expect(client.getQueryCache().find({ queryKey: queryKeys.maintenanceList('org-1') })!.isStale()).toBe(true)
  })

  it('saving details and returning to service refresh the equipment, the record and the dashboard', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.updateDetails({ assetId: 'a1', details: { notes: '', location: '', expectedBack: null } }))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.asset('a1'), queryKeys.dashboard('org-1')]))
    invalidate.mockClear()
    await act(() => hook.result.current.returnToService('a2'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.asset('a2'), queryKeys.dashboard('org-1')]))
  })
})
