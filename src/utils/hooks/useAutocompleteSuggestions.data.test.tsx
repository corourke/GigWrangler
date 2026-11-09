/** A10 characterization: useAutocompleteSuggestions merges seed values with the values in use. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useAutocompleteSuggestions } from './useAutocompleteSuggestions'
import { getDistinctAssetValues } from '../../services/asset.service'
import { getDistinctKitValues } from '../../services/kit.service'

vi.mock('../../services/asset.service', () => ({ getDistinctAssetValues: vi.fn() }))
vi.mock('../../services/kit.service', () => ({ getDistinctKitValues: vi.fn() }))

function setup(initial: Parameters<typeof useAutocompleteSuggestions>[0]) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook((p: Parameters<typeof useAutocompleteSuggestions>[0]) => useAutocompleteSuggestions(p), { wrapper, initialProps: initial })
}
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getDistinctAssetValues).mockReset().mockImplementation(async (orgId: string, field: string) => [`${orgId} ${field}`, 'Seed A'])
  vi.mocked(getDistinctKitValues).mockReset().mockResolvedValue(['Kit Cat'])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAutocompleteSuggestions data (A10 characterization)', () => {
  it('seed values first, then the values in use (no repeats)', async () => {
    const hook = setup({ field: 'vendor', organizationId: 'org-1', seedValues: ['Seed A', 'Seed B'] })
    await waitFor(() => expect(hook.result.current.suggestions).toEqual(['Seed A', 'Seed B', 'org-1 vendor']))
    expect(getDistinctAssetValues).toHaveBeenCalledWith('org-1', 'vendor', undefined)
  })

  it('reads kit values for kits', async () => {
    const hook = setup({ field: 'category', organizationId: 'org-1', sourceTable: 'kits', seedValues: [] })
    await waitFor(() => expect(hook.result.current.suggestions).toEqual(['Kit Cat']))
    expect(getDistinctKitValues).toHaveBeenCalledWith('org-1', 'category')
  })

  it('disabled, or with no organization, it shows the seeds and reads nothing', async () => {
    const hook = setup({ field: 'vendor', organizationId: 'org-1', seedValues: ['Seed A'], enabled: false })
    await waitFor(() => expect(hook.result.current.suggestions).toEqual(['Seed A']))
    expect(getDistinctAssetValues).not.toHaveBeenCalled()
  })

  it('a failed read leaves the seeds', async () => {
    vi.mocked(getDistinctAssetValues).mockRejectedValueOnce(new Error('down'))
    const hook = setup({ field: 'vendor', organizationId: 'org-1', seedValues: ['Seed A'] })
    await waitFor(() => expect(getDistinctAssetValues).toHaveBeenCalled())
    await act(async () => {})
    expect(hook.result.current.suggestions).toEqual(['Seed A'])
  })

  it('another organization reads again; a slow answer for the earlier one never shows', async () => {
    const slow = deferred<string[]>()
    vi.mocked(getDistinctAssetValues).mockImplementationOnce(() => slow.promise)
    const hook = setup({ field: 'vendor', organizationId: 'org-1', seedValues: [] })
    hook.rerender({ field: 'vendor', organizationId: 'org-2', seedValues: [] })
    await waitFor(() => expect(hook.result.current.suggestions).toEqual(['org-2 vendor', 'Seed A']))
    await act(async () => slow.resolve(['org-1 vendor']))
    expect(hook.result.current.suggestions).toEqual(['org-2 vendor', 'Seed A'])
  })
})
