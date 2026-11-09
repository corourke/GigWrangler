/**
 * Characterization tests (A10): how Inventory Mode loads its packing list, the org's equipment
 * index and member names, online and offline, and that a scan re-reads the device copy.
 */
import type { ReactElement } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MobileInventoryMode from './MobileInventoryMode'
import { idbStore } from '../../utils/idb/store'
import { packingListService } from '../../services/mobile/packingList.service'
import { orgIndexService } from '../../services/mobile/orgIndex.service'
import { inventoryTrackingService } from '../../services/mobile/inventoryTracking.service'
import { toast } from 'sonner'

const auth = vi.hoisted(() => ({ orgId: 'org-1' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test' },
    selectedOrganization: { id: auth.orgId },
    userRole: 'Admin',
  }),
}))
vi.mock('../../services/mobile/orgIndex.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { orgIndexService: { ...actual.orgIndexService, get: vi.fn(async () => null), refresh: vi.fn(async () => null) } }
})
const members = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../services/organization.service', () => ({ getOrganizationMembers: members.list }))
vi.mock('../../services/conflictDetection.service', () => ({ additionWarnings: vi.fn(async () => []) }))
vi.mock('../../services/writeOff.service', () => ({ writeOffPieces: vi.fn() }))
vi.mock('../../utils/idb/store', () => ({ idbStore: { getPackingList: vi.fn(), getGigs: vi.fn(), putPackingList: vi.fn(), getOutbox: vi.fn(async () => []) } }))
vi.mock('../../services/mobile/packingList.service', () => ({ packingListService: { fetchGigPackingList: vi.fn() } }))
vi.mock('../../services/mobile/inventoryTracking.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { inventoryTrackingService: { ...actual.inventoryTrackingService, submitScan: vi.fn(), clearTracking: vi.fn() } }
})
vi.mock('./MobileBarcodeScanner', () => ({ MobileBarcodeScanner: () => null }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }))

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { ...utils, rerender: (next: ReactElement) => utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) }
}

const list = (gigId: string, title: string, kitName: string, tracking: any[] = []) => ({
  gig_id: gigId,
  gig_title: title,
  kits: [{ kit: { id: `kit-${gigId}`, name: kitName, tag_number: 'K-1', is_container: true, assets: [] } }],
  tracking,
})
const setOnline = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  vi.clearAllMocks()
  auth.orgId = 'org-1'
  setOnline(true)
  vi.mocked(idbStore.getGigs).mockResolvedValue([])
  vi.mocked(idbStore.getPackingList).mockImplementation(async (id: string) => list(id, 'Cached Title', `Cached Case ${id}`))
  vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async (id: string) => list(id, `Fresh Title ${id}`, `Fresh Case ${id}`) as any)
  members.list.mockResolvedValue([])
})
afterEach(() => setOnline(true))

describe('MobileInventoryMode: loading the packing list', () => {
  it('online: shows placeholders, then the fresh list and its gig title', async () => {
    const { container } = render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeInTheDocument())
    expect(await screen.findByText('Fresh Case g1')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument()
    expect(packingListService.fetchGigPackingList).toHaveBeenCalledWith('g1')
  })

  it('offline: shows the device copy without asking the server', async () => {
    setOnline(false)
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    expect(await screen.findByText('Cached Case g1')).toBeInTheDocument()
    expect(screen.getByText('Cached Title')).toBeInTheDocument()
    expect(packingListService.fetchGigPackingList).not.toHaveBeenCalled()
  })

  it('offline with no device copy: the title comes from the cached gigs', async () => {
    setOnline(false)
    vi.mocked(idbStore.getPackingList).mockResolvedValue(undefined as any)
    vi.mocked(idbStore.getGigs).mockResolvedValue([{ id: 'g1', title: 'Gig From Cache' }] as any)
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    expect(await screen.findByText('Gig From Cache')).toBeInTheDocument()
    expect(await screen.findByText('No items on this packing list.')).toBeInTheDocument()
  })

  it('a failed load says so and keeps the device copy', async () => {
    vi.mocked(packingListService.fetchGigPackingList).mockRejectedValue(new Error('Server unavailable'))
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load packing list'))
    expect(await screen.findByText('Cached Case g1')).toBeInTheDocument()
  })

  it('switching gig loads that gig’s list', async () => {
    const { rerender } = render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    expect(await screen.findByText('Fresh Case g1')).toBeInTheDocument()
    rerender(<MobileInventoryMode gigId="g2" onSelectGig={vi.fn()} />)
    expect(await screen.findByText('Fresh Case g2')).toBeInTheDocument()
    expect(screen.queryByText('Fresh Case g1')).not.toBeInTheDocument()
  })

  it('coming back online does not reload the list by itself', async () => {
    setOnline(false)
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    expect(await screen.findByText('Cached Case g1')).toBeInTheDocument()
    setOnline(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(packingListService.fetchGigPackingList).not.toHaveBeenCalled()
    expect(screen.getByText('Cached Case g1')).toBeInTheDocument()
  })
})

describe('MobileInventoryMode: after a scan', () => {
  it('re-reads the device copy (no server reload) and shows it', async () => {
    setOnline(false)
    vi.mocked(inventoryTrackingService.submitScan).mockImplementation(async () => {
      vi.mocked(idbStore.getPackingList).mockResolvedValue(list('g1', 'Cached Title', 'Cached Case g1', [
        { gig_id: 'g1', kit_id: 'kit-g1', asset_id: null, status: 'Checked Out', scanned_at: '2030-01-01T00:00:00Z', scanned_by: 'user-1' },
      ]) as any)
      return undefined as any
    })
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await screen.findByText('Cached Case g1')
    const reads = vi.mocked(idbStore.getPackingList).mock.calls.length
    const kitRow = () => screen.getByText('Cached Case g1').closest('.flex.items-stretch') as HTMLElement
    expect(kitRow().querySelector('.bg-emerald-100')).not.toBeInTheDocument()
    fireEvent.click(kitRow().querySelector('button')!)
    await waitFor(() => expect(inventoryTrackingService.submitScan).toHaveBeenCalled())
    await waitFor(() => expect(vi.mocked(idbStore.getPackingList).mock.calls.length).toBeGreaterThan(reads))
    await waitFor(() => expect(kitRow().querySelector('.bg-emerald-100')).toBeInTheDocument())
    expect(packingListService.fetchGigPackingList).not.toHaveBeenCalled()
  })
})

describe('MobileInventoryMode: equipment index and names', () => {
  it('reads the cached index and refreshes it when online, per organization', async () => {
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await waitFor(() => expect(orgIndexService.refresh).toHaveBeenCalledWith('org-1'))
    expect(orgIndexService.get).toHaveBeenCalledWith('org-1')
  })

  it('offline: only the cached index, and no member lookup', async () => {
    setOnline(false)
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await waitFor(() => expect(orgIndexService.get).toHaveBeenCalledWith('org-1'))
    await screen.findByText('Cached Case g1')
    expect(orgIndexService.refresh).not.toHaveBeenCalled()
    expect(members.list).not.toHaveBeenCalled()
  })

  it('online: looks up the organization’s members for names', async () => {
    render(<MobileInventoryMode gigId="g1" onSelectGig={vi.fn()} />)
    await waitFor(() => expect(members.list).toHaveBeenCalledWith('org-1'))
  })
})
