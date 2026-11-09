import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useCategoryListData } from './useCategoryListData'
import { queryKeys } from '../../lib/queryKeys'
import { listCategories, getScheduleCLines, getCategoryUsage } from '../../services/purchaseCategory.service'

vi.mock('../../services/purchaseCategory.service', () => ({
  listCategories: vi.fn(), getScheduleCLines: vi.fn(), getCategoryUsage: vi.fn(), addCategory: vi.fn(), updateCategory: vi.fn(),
}))

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useCategoryListData('expense', 'org-1'), { wrapper })
  return { client, invalidate, hook }
}

beforeEach(() => {
  vi.mocked(listCategories).mockReset().mockResolvedValue([{ id: 'c1', name: 'Supplies', active: true }] as any)
  vi.mocked(getScheduleCLines).mockReset().mockResolvedValue([{ code: '22', label: 'Supplies' }] as any)
  vi.mocked(getCategoryUsage).mockReset().mockResolvedValue({ supplies: 2 })
})

describe('useCategoryListData (A10)', () => {
  it('caches the list, the lines and the use under their keys', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.rows).not.toBeNull())
    await waitFor(() => expect(hook.result.current.usage).not.toBeNull())
    expect(client.getQueryData(queryKeys.categoryList('expense', 'org-1'))).toHaveLength(1)
    expect(client.getQueryData(queryKeys.scheduleCLines())).toHaveLength(1)
    expect(client.getQueryData(queryKeys.categoryUsage('expense', 'org-1'))).toEqual({ supplies: 2 })
  })

  it('setRows changes the cached list; afterCategoryChange refreshes the organization’s categories', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.rows).not.toBeNull())
    act(() => hook.result.current.setRows((rows) => rows.map((r) => ({ ...r, active: false }))))
    expect((client.getQueryData(queryKeys.categoryList('expense', 'org-1')) as any)[0].active).toBe(false)
    await act(() => hook.result.current.afterCategoryChange())
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: [...queryKeys.purchases('org-1'), 'categories'] }))
  })
})
