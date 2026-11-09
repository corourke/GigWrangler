/** Round C: the gig's basic-info autosave writes only the fields this person changed. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../../test/renderWithQuery'
import { useGigBasicInfoForm } from './useGigBasicInfoForm'
import { getGig, updateGig } from '../../../services/gig.service'

vi.mock('../../../services/gig.service', () => ({ getGig: vi.fn(), updateGig: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// The stored gig: updateGig writes the keys it is given, as the service does.
let row: Record<string, any>
const opened = () => ({ id: 'g1', title: 'Spring show', start: '2026-07-12T16:00:00Z', end: '2026-07-12T20:00:00Z', all_day: false, timezone: 'America/New_York', status: 'Booked', tags: ['outdoor'], notes: 'Load in at noon' })

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useGigBasicInfoForm('g1', opened() as any), { wrapper })
}
const savedKeys = (call = -1) => Object.keys(vi.mocked(updateGig).mock.calls.at(call)![1]).sort()

beforeEach(() => {
  row = opened()
  vi.mocked(getGig).mockReset()
  vi.mocked(updateGig).mockReset().mockImplementation(async (_id: string, data: any) => { Object.assign(row, data); return {} as any })
})

describe('useGigBasicInfoForm autosave', () => {
  it("keeps another person's saved note when this person edits the title", async () => {
    const hook = setup()
    // Someone else saves a note after this person opened the gig.
    row.notes = 'Load in at 2pm (changed by someone else)'
    act(() => hook.result.current.form.setValue('title', 'Spring show (rain date)', { shouldDirty: true }))
    await waitFor(() => expect(updateGig).toHaveBeenCalled(), { timeout: 4000 })
    expect(row.title).toBe('Spring show (rain date)')
    expect(row.notes).toBe('Load in at 2pm (changed by someone else)')
  })

  it('saves only the title when only the title changed', async () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('title', 'New title', { shouldDirty: true }))
    await waitFor(() => expect(updateGig).toHaveBeenCalled(), { timeout: 4000 })
    expect(savedKeys()).toEqual(['title'])
  })

  it('saves the start, end, all-day and time zone together when the time changes', async () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('start_time', new Date('2026-07-12T17:00:00Z'), { shouldDirty: true }))
    await waitFor(() => expect(updateGig).toHaveBeenCalled(), { timeout: 4000 })
    expect(savedKeys()).toEqual(['all_day', 'end', 'start', 'timezone'])
    expect(row.start).toBe('2026-07-12T17:00:00.000Z')
    expect(row.notes).toBe('Load in at noon')
  })

  it('after a save, the next edit saves only its own field', async () => {
    const hook = setup()
    act(() => hook.result.current.form.setValue('title', 'New title', { shouldDirty: true }))
    await waitFor(() => expect(updateGig).toHaveBeenCalledTimes(1), { timeout: 4000 })
    act(() => hook.result.current.form.setValue('notes', 'Bring the long cables', { shouldDirty: true }))
    await waitFor(() => expect(updateGig).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(savedKeys()).toEqual(['notes'])
  })
})
