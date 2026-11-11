// The day-of-show sheet's contents (§3e), moved from MobileToday.test when Today became the home
// screen and the sheet its own screen (#445).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileDaySheet from './MobileDaySheet'

const auth = { isLoading: false, user: { id: 'u1' }, selectedOrganization: { id: 'org-1' }, userRole: 'Staff' }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('../../services/mobile/dayOfShow.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, loadDayOfShowSheet: vi.fn() }
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

import { loadDayOfShowSheet, type DayOfShowSheet } from '../../services/mobile/dayOfShow.service'
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

describe('The day sheet (DaySheet, via MobileDaySheet)', () => {
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
  it("shows today's gig: schedule, venue, contacts, crew and documents", async () => {
    render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)

    expect(await screen.findByText('Tonight Show')).toBeInTheDocument()
    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getByText('2:00 PM')).toBeInTheDocument() // load-in, in the gig's time zone
    expect(screen.getByText('7:00 PM')).toBeInTheDocument() // doors
    expect(screen.getByText('Test Hall', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Town, CA 90000')).toBeInTheDocument()
    expect(screen.getByText('Pat Venue')).toBeInTheDocument()
    expect(screen.getByText('Sam Crew')).toBeInTheDocument()
    expect(screen.getByText('stage-plot.pdf')).toBeInTheDocument()
  })

  it('makes contacts one tap (call, text, email) and shows the number as text too', async () => {
    render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
    await screen.findByText('Pat Venue')

    expect(screen.getByRole('link', { name: 'Call Pat Venue' })).toHaveAttribute('href', 'tel:5550100109')
    expect(screen.getByRole('link', { name: 'Text Pat Venue' })).toHaveAttribute('href', 'sms:5550100109')
    expect(screen.getByRole('link', { name: 'Email Pat Venue' })).toHaveAttribute('href', 'mailto:p@example.com')
    const number = screen.getByText('(555) 010-0109')
    expect(number.className).toContain('select-text')
    expect(screen.getByRole('link', { name: 'Call Test Hall' })).toHaveAttribute('href', 'tel:5550100')
    expect(screen.getByRole('link', { name: /Directions/ }).getAttribute('href')).toMatch(/maps/)
  })

  it('offline: a cached sheet says when it was updated, not that it was saved, and a document needs a connection', async () => {
    setOnline(false)
    render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
    expect(await screen.findByText(/Updated .*9:00 AM/)).toBeInTheDocument()
    expect(screen.queryByText(/Saved .*9:00 AM/)).not.toBeInTheDocument()
    expect(screen.getByText('Not saved on this phone – connect to open')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stage-plot\.pdf/ })).toBeDisabled()
  })

  it('a sheet the person saved says Saved on this phone with the time; a cached one never does', async () => {
    setOnline(false)
    vi.mocked(loadDayOfShowSheet).mockImplementation(async (id: string) => ({ ...sheetFor(TODAY), kept: true }))
    render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
    expect(await screen.findByText(/Saved on this phone · .*9:00 AM/)).toBeInTheDocument()
    expect(screen.queryByText(/Updated /)).not.toBeInTheDocument()
  })

  it('offline with no saved sheet, says it is not saved', async () => {
    setOnline(false)
    vi.mocked(loadDayOfShowSheet).mockResolvedValue(null)
    render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/isn't saved on this phone/)).toBeInTheDocument())
  })


  describe('documents saved on the phone (PR 2)', () => {
    beforeEach(() => {
      vi.mocked(listSavedDocuments).mockResolvedValue({})
      ;(URL as any).createObjectURL = vi.fn(() => 'blob:local/1')
      ;(URL as any).revokeObjectURL = vi.fn()
    })

    it("saves the gig's PDFs and images ahead when the sheet loads online", async () => {
      render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
      await screen.findByText('stage-plot.pdf')
      await waitFor(() => expect(saveGigDocumentsAhead).toHaveBeenCalledWith(expect.objectContaining({ gig_id: 'g1' })))
    })

    it('offline, opens a saved document in the app', async () => {
      setOnline(false)
      vi.mocked(listSavedDocuments).mockResolvedValue({ 'att-1': { size: 2 * 1024 * 1024, type: 'application/pdf' } })
      vi.mocked(getSavedDocument).mockResolvedValue({
        id: 'att-1', gig_id: 'g1', file_name: 'stage-plot.pdf', type: 'application/pdf', size: 1, saved_at: 1,
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
      })
      render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
      expect(await screen.findByText('Saved on this phone · 2.0 MB')).toBeInTheDocument()
      expect(saveGigDocumentsAhead).not.toHaveBeenCalled()
      const open = screen.getByRole('button', { name: /stage-plot\.pdf/ })
      expect(open).toBeEnabled()
      fireEvent.click(open)
      const viewer = await screen.findByRole('dialog', { name: 'stage-plot.pdf' })
      expect(viewer.querySelector('iframe')?.getAttribute('src')).toBe('blob:local/1')
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local/1')
    })

    it('online, saves a document that is not saved yet when asked', async () => {
      vi.mocked(saveDayOfShowDocument).mockResolvedValue({ saved: true })
      render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
      await screen.findByText('stage-plot.pdf')
      vi.mocked(listSavedDocuments).mockResolvedValue({ 'att-1': { size: 1024 * 1024, type: 'application/pdf' } })
      fireEvent.click(await screen.findByRole('button', { name: 'Save stage-plot.pdf for offline' }))
      await waitFor(() => expect(saveDayOfShowDocument).toHaveBeenCalledWith('g1', expect.objectContaining({ id: 'att-1' }), { manual: true }))
      expect(await screen.findByText('Saved on this phone · 1.0 MB')).toBeInTheDocument()
    })

    it('shows a small saved file in KB, not 0.0 MB', async () => {
      setOnline(false)
      vi.mocked(listSavedDocuments).mockResolvedValue({ 'att-1': { size: 240 * 1024, type: 'image/png' } })
      render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
      expect(await screen.findByText('Saved on this phone · 240 KB')).toBeInTheDocument()
    })

    it('says why a document could not be saved', async () => {
      vi.mocked(saveDayOfShowDocument).mockResolvedValue({ saved: false, reason: 'gig-full' })
      render(<MobileDaySheet gigId="g1" onBack={vi.fn()} onViewGigDetail={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Save stage-plot.pdf for offline' }))
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("This gig's saved documents would pass 50 MB"))
    })
  })
})
