/** A10 characterization: how the gig's schedule editor loads. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, act, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import GigScheduleEditor from './GigScheduleEditor'
import { getGigScheduleEntries } from '../../services/gigSchedule.service'
import { getGigParticipants } from '../../services/gig.service'

vi.mock('../../services/gigSchedule.service', () => ({
  getGigScheduleEntries: vi.fn(),
  updateGigScheduleEntries: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../services/gig.service', () => ({ getGigParticipants: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const entry = (gigId: string, item: string) => ({
  id: `e-${gigId}`, gig_id: gigId, activity_type: item, label: null, start_time: '2026-07-12T16:00:00Z', end_time: null,
  act_participant_id: null, notes: null, sort_order: 0,
})
const NY = 'America/New_York'
const items = () => screen.getAllByLabelText('Item').map((i) => (i as HTMLInputElement).value)
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getGigScheduleEntries).mockReset().mockImplementation(async (gigId: string) => [entry(gigId, `Item of ${gigId}`)] as any)
  vi.mocked(getGigParticipants).mockReset().mockResolvedValue([
    { id: 'p1', role: 'Act', organization: { name: 'The Headliners' } },
    { id: 'p2', role: 'Venue', organization: { name: 'The Hall' } },
  ] as any)
  vi.mocked(toast.error).mockReset()
})

describe('GigScheduleEditor data (A10 characterization)', () => {
  it('loading, then the rows, with the gig’s acts to choose from', async () => {
    const rows = deferred<any>()
    vi.mocked(getGigScheduleEntries).mockReturnValueOnce(rows.promise)
    render(<GigScheduleEditor gigId="g1" gigStart="2026-07-12T16:00:00Z" timeZone={NY} />)
    expect(screen.getByText('Loading schedule...')).toBeInTheDocument()
    await act(async () => rows.resolve([entry('g1', 'Item of g1')]))
    await waitFor(() => expect(items()).toEqual(['Item of g1']))
    const acts = within(screen.getAllByLabelText('Act')[0]).getAllByRole('option').map((o) => o.textContent)
    expect(acts).toEqual(['—', 'The Headliners'])
  })

  it('a failed load says why', async () => {
    vi.mocked(getGigScheduleEntries).mockRejectedValueOnce(new Error('Network down'))
    render(<GigScheduleEditor gigId="g1" gigStart="2026-07-12T16:00:00Z" timeZone={NY} />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'))
  })

  it('a failed participants read keeps the acts passed in', async () => {
    vi.mocked(getGigParticipants).mockRejectedValueOnce(new Error('down'))
    render(<GigScheduleEditor gigId="g1" gigStart="2026-07-12T16:00:00Z" timeZone={NY}
      actParticipants={[{ id: 'p9', organization: { name: 'Given Act' } } as any]} />)
    await waitFor(() => expect(items()).toEqual(['Item of g1']))
    expect(within(screen.getAllByLabelText('Act')[0]).getByRole('option', { name: 'Given Act' })).toBeInTheDocument()
  })

  it('another gig loads its rows', async () => {
    const { rerender } = render(<GigScheduleEditor gigId="g1" gigStart="2026-07-12T16:00:00Z" timeZone={NY} />)
    await waitFor(() => expect(items()).toEqual(['Item of g1']))
    rerender(<GigScheduleEditor gigId="g2" gigStart="2026-07-12T16:00:00Z" timeZone={NY} />)
    await waitFor(() => expect(items()).toEqual(['Item of g2']))
  })
})

describe('GigScheduleEditor: seeds once per open (A10)', () => {
  it('a later read of the schedule never replaces the rows being edited', async () => {
    const { queryClient } = render(<GigScheduleEditor gigId="g1" gigStart="2026-07-12T16:00:00Z" timeZone={NY} />)
    await waitFor(() => expect(items()).toEqual(['Item of g1']))
    vi.mocked(getGigScheduleEntries).mockResolvedValue([entry('g1', 'From the server')] as any)
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['gig', 'g1'] }) })
    await waitFor(() => expect(getGigScheduleEntries).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(items()).toEqual(['Item of g1'])
  })
})
