import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileToday from './MobileToday'

const auth = { isLoading: false, user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Staff' }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('../../services/mobile/dayOfShow.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, loadTodayCandidates: vi.fn(), loadDayOfShowSheet: vi.fn() }
})
vi.mock('../../services/attachment.service', () => ({ getAttachmentUrl: vi.fn() }))
vi.mock('../../services/mobile/dayOfShowFiles.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    saveGigDocumentsAhead: vi.fn(async () => {}),
    listSavedDocuments: vi.fn(async () => ({})),
    saveDayOfShowDocument: vi.fn(),
    getSavedDocument: vi.fn(),
  }
})
const toastError = vi.fn()
vi.mock('./DaySheetGigPicker', () => ({
  default: ({ onChoose, onClose }: any) => (
    <div>
      <span>Gig picker</span>
      <button onClick={() => onChoose('g9')}>pick g9</button>
      <button onClick={onClose}>close picker</button>
    </div>
  ),
}))
vi.mock('sonner', () => ({ toast: { error: (...a: any[]) => toastError(...a), success: vi.fn() } }))

import { loadTodayCandidates, loadDayOfShowSheet, type DayOfShowSheet } from '../../services/mobile/dayOfShow.service'
import { saveGigDocumentsAhead, listSavedDocuments, saveDayOfShowDocument, getSavedDocument } from '../../services/mobile/dayOfShowFiles.service'

const NOW = new Date('2026-11-10T17:00:00Z') // 9 AM in Los Angeles
const gig = (id: string, start: string, end: string, title = id) =>
  ({ id, title, start, end, timezone: 'America/Los_Angeles', all_day: false, status: 'Booked' })
const TODAY = gig('g1', '2026-11-10T22:00:00Z', '2026-11-11T06:00:00Z', 'Tonight Show')

const sheetFor = (g: any): DayOfShowSheet => ({
  gig_id: g.id,
  saved_at: NOW.getTime(),
  gig: g,
  venue: { name: 'Test Hall', address_line1: '1 Main St', city: 'Town', state: 'CA', postal_code: '90000', phone_number: '555-0100' },
  schedule: [
    { id: 's1', activity_type: 'LoadIn', label: null, start_time: '2026-11-10T22:00:00Z', end_time: null },
    { id: 's2', activity_type: 'Doors', label: null, start_time: '2026-11-11T03:00:00Z', end_time: null },
  ],
  contacts: [{ key: 'c1', name: 'Pat Venue', title: 'Production', phone: '(555) 010-0109', email: 'p@example.com', org_name: 'Test Hall', org_role: 'Venue' }],
  crew: [{ key: 'a1', name: 'Sam Crew', role: 'FOH Engineer', title: 'FOH Engineer', phone: '555-0101', email: null }],
  documents: [{ id: 'att-1', file_name: 'stage-plot.pdf', file_path: 'org/att-1.pdf' }],
})

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })

describe('MobileToday (day-of-show sheet)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    setOnline(true)
    vi.mocked(loadDayOfShowSheet).mockImplementation(async (id: string) =>
      sheetFor([TODAY].find((g) => g.id === id) ?? gig(id, '2026-11-12T22:00:00Z', '2026-11-13T02:00:00Z')))
  })
  afterEach(() => {
    vi.useRealTimers()
    setOnline(true)
  })

  // Plan #445 (A2a): Today is a home screen. Today's gig (or the next) is a card that opens its
  // day sheet; This week lists the rest of the next 7 days.
  it("shows today's gig as a card with its time and venue, opening its day sheet", async () => {
    vi.mocked(loadTodayCandidates).mockResolvedValue([TODAY])
    const onOpenDaySheet = vi.fn()
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={onOpenDaySheet} />)
    const card = await screen.findByRole('region', { name: 'Tonight Show' })
    expect(card).toHaveTextContent('Today')
    expect(card).toHaveTextContent('2:00 PM')
    expect(await within(card).findByText('Test Hall')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Open day sheet' }))
    expect(onOpenDaySheet).toHaveBeenCalledWith('g1')
    // The sheet itself is its own screen now.
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument()
  })

  it("loads today's sheet, so it is saved on the phone ahead of the show", async () => {
    vi.mocked(loadTodayCandidates).mockResolvedValue([TODAY])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    await screen.findByRole('region', { name: 'Tonight Show' })
    await waitFor(() => expect(loadDayOfShowSheet).toHaveBeenCalledWith('g1', expect.any(Function)))
  })

  it('shows one card for each gig today', async () => {
    const matinee = gig('g2', '2026-11-10T19:00:00Z', '2026-11-10T21:00:00Z', 'Matinee')
    vi.mocked(loadTodayCandidates).mockResolvedValue([TODAY, matinee])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'Matinee' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tonight Show' })).toBeInTheDocument()
  })

  it('shows the next gig, marked as next, when none is today', async () => {
    const later = gig('g9', '2026-11-12T22:00:00Z', '2026-11-13T02:00:00Z', 'Friday Show')
    vi.mocked(loadTodayCandidates).mockResolvedValue([later])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    const card = await screen.findByRole('region', { name: 'Friday Show' })
    expect(card).toHaveTextContent('Next up')
    expect(card).toHaveTextContent('Thu, Nov 12')
  })

  it('says so when there is no gig in the next 7 days', async () => {
    vi.mocked(loadTodayCandidates).mockResolvedValue([])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    expect(await screen.findByText('No gigs in the next 7 days')).toBeInTheDocument()
    expect(loadDayOfShowSheet).not.toHaveBeenCalled()
  })

  it('lists the rest of the next 7 days under This week, each opening its gig', async () => {
    const fri = gig('g3', '2026-11-13T03:00:00Z', '2026-11-13T06:00:00Z', 'Friday Late')
    const sun = { ...gig('g4', '2026-11-15T12:00:00Z', '2026-11-15T12:00:00Z', 'Sunday Fair'), all_day: true, status: 'DateHold' }
    vi.mocked(loadTodayCandidates).mockResolvedValue([TODAY, fri, sun])
    const onViewGigDetail = vi.fn()
    render(<MobileToday onViewGigDetail={onViewGigDetail} onOpenDaySheet={vi.fn()} />)
    const week = await screen.findByRole('list', { name: 'This week' })
    const rows = within(week).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Thu, Nov 12.*Friday Late.*Booked/),
      expect.stringMatching(/Sun, Nov 15.*Sunday Fair.*Date Hold/),
    ])
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(onViewGigDetail).toHaveBeenCalledWith('g3')
  })

  it('offline: the cards come from the phone', async () => {
    setOnline(false)
    vi.mocked(loadTodayCandidates).mockResolvedValue([TODAY])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'Tonight Show' })).toBeInTheDocument()
    expect(screen.getByText(/Offline/i)).toBeInTheDocument()
  })
})

// Plan #445 (A1): any gig's day sheet from Today.
describe('MobileToday: Choose another gig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOnline(true)
    vi.mocked(loadDayOfShowSheet).mockImplementation(async (id: string) => sheetFor(gig(id, '2026-11-12T22:00:00Z', '2026-11-13T02:00:00Z')))
  })

  it('opens the gig picker, and the day sheet of the gig chosen', async () => {
    vi.mocked(loadTodayCandidates).mockResolvedValue([])
    const onOpenDaySheet = vi.fn()
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={onOpenDaySheet} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another gig' }))
    expect(screen.getByText('Gig picker')).toBeInTheDocument()
    fireEvent.click(screen.getByText('pick g9'))
    expect(onOpenDaySheet).toHaveBeenCalledWith('g9')
  })

  it('closes the picker', async () => {
    vi.mocked(loadTodayCandidates).mockResolvedValue([])
    render(<MobileToday onViewGigDetail={vi.fn()} onOpenDaySheet={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another gig' }))
    fireEvent.click(screen.getByText('close picker'))
    expect(screen.queryByText('Gig picker')).not.toBeInTheDocument()
  })
})
