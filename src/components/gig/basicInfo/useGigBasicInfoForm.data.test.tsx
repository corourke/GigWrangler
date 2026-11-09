/** A10 characterization: the gig's basic info form loads the gig unless one is passed in. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../../test/renderWithQuery'
import { toast } from 'sonner'
import { useGigBasicInfoForm } from './useGigBasicInfoForm'
import { getGig } from '../../../services/gig.service'

vi.mock('../../../services/gig.service', () => ({ getGig: vi.fn(), updateGig: vi.fn().mockResolvedValue({}) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const gig = (id: string) => ({ id, title: `Title of ${id}`, start: '2026-07-12T16:00:00Z', end: '2026-07-12T20:00:00Z', timezone: 'America/New_York', status: 'Booked', tags: [], notes: '' })
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

function setup(initial: { gigId?: string; loaded?: any }) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook((p: { gigId?: string; loaded?: any }) => useGigBasicInfoForm(p.gigId, p.loaded), { wrapper, initialProps: initial })
}

beforeEach(() => {
  vi.mocked(getGig).mockReset().mockImplementation(async (id: string) => gig(id) as any)
  vi.mocked(toast.error).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useGigBasicInfoForm data (A10 characterization)', () => {
  it('loads the gig into the form', async () => {
    const g = deferred<any>()
    vi.mocked(getGig).mockReturnValueOnce(g.promise)
    const hook = setup({ gigId: 'g1' })
    expect(hook.result.current.isLoading).toBe(true)
    await act(async () => g.resolve(gig('g1')))
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.form.getValues('title')).toBe('Title of g1')
  })

  it('a gig passed in seeds the form without a read', async () => {
    const hook = setup({ gigId: 'g1', loaded: gig('g1') })
    expect(hook.result.current.isLoading).toBe(false)
    expect(hook.result.current.form.getValues('title')).toBe('Title of g1')
    await act(async () => {})
    expect(getGig).not.toHaveBeenCalled()
  })

  it('the create form reads nothing', async () => {
    const hook = setup({})
    await act(async () => {})
    expect(getGig).not.toHaveBeenCalled()
    expect(hook.result.current.isLoading).toBe(false)
  })

  it('a failed load says why', async () => {
    vi.mocked(getGig).mockRejectedValueOnce(new Error('Network down'))
    const hook = setup({ gigId: 'g1' })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'))
    expect(hook.result.current.isLoading).toBe(false)
  })

  it('another gig loads into the form', async () => {
    const hook = setup({ gigId: 'g1' })
    await waitFor(() => expect(hook.result.current.form.getValues('title')).toBe('Title of g1'))
    hook.rerender({ gigId: 'g2' })
    await waitFor(() => expect(hook.result.current.form.getValues('title')).toBe('Title of g2'))
  })
})
