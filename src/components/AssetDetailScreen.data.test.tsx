/**
 * A10 characterization: how a unit or lot page loads and refreshes its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AssetDetailScreen from './AssetDetailScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getAsset, getAssetHistory, getAssetInventoryTracking, deleteAsset, duplicateAsset } from '../services/asset.service'
import { undoWriteOff } from '../services/writeOff.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../services/asset.service', () => ({
  getAsset: vi.fn(),
  deleteAsset: vi.fn(),
  duplicateAsset: vi.fn(),
  getAssetHistory: vi.fn(),
  getAssetInventoryTracking: vi.fn(),
}))
vi.mock('./AttachmentManager', () => ({ default: () => null }))
vi.mock('./ActivityFeed', () => ({
  default: ({ entries, isLoading }: any) => <div>{isLoading ? 'activity loading' : `activity ${entries.length}`}</div>,
}))
vi.mock('../services/writeOff.service', () => ({ undoWriteOff: vi.fn() }))
vi.mock('../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn().mockResolvedValue(new Set()) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const record = (id: string, model: string, over: Record<string, unknown> = {}) => ({
  id, equipment_item_id: 'item-1', manufacturer_model: model, category: 'Audio', status: 'Active', ...over,
})

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  assetId: 'a1',
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getAsset).mockReset().mockImplementation((id: string) =>
    Promise.resolve(record(id, id === 'a2' ? 'Mixer Two' : 'Speaker One') as any))
  vi.mocked(getAssetHistory).mockReset().mockResolvedValue([{ id: 'h1' }, { id: 'h2' }] as any)
  vi.mocked(getAssetInventoryTracking).mockReset().mockResolvedValue([])
  vi.mocked(deleteAsset).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateAsset).mockReset().mockResolvedValue({ id: 'a9' } as any)
  vi.mocked(undoWriteOff).mockReset().mockResolvedValue('a1')
  props.onBack.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('AssetDetailScreen data (A10 characterization)', () => {
  it('first load: a spinner, then the record and its history', async () => {
    const asset = deferred<any>()
    vi.mocked(getAsset).mockReturnValueOnce(asset.promise)
    render(<AssetDetailScreen {...props} />)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    await act(async () => asset.resolve(record('a1', 'Speaker One')))
    expect(await screen.findByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
    expect(await screen.findByText('activity 2')).toBeInTheDocument()
    expect(getAssetHistory).toHaveBeenCalledWith('a1')
    expect(getAssetInventoryTracking).toHaveBeenCalledWith('a1')
  })

  it('a load error shows the message; Retry loads it', async () => {
    vi.mocked(getAsset).mockRejectedValueOnce(new Error('Network down'))
    render(<AssetDetailScreen {...props} />)
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
  })

  it('a history error still shows the record, with an empty history', async () => {
    vi.mocked(getAssetHistory).mockRejectedValueOnce(new Error('history down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AssetDetailScreen {...props} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
    expect(await screen.findByText('activity 0')).toBeInTheDocument()
  })

  it('switching record loads the new one', async () => {
    const { rerender } = render(<AssetDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'Speaker One' })
    rerender(<AssetDetailScreen {...props} assetId="a2" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mixer Two' })).toBeInTheDocument()
    expect(getAsset).toHaveBeenLastCalledWith('a2')
  })

  it('a slow answer for the earlier record never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getAsset).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<AssetDetailScreen {...props} />)
    rerender(<AssetDetailScreen {...props} assetId="a2" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mixer Two' })).toBeInTheDocument()
    await act(async () => slow.resolve(record('a1', 'Speaker One')))
    expect(screen.getByRole('heading', { level: 1, name: 'Mixer Two' })).toBeInTheDocument()
  })

  it('after Undo write-off the page shows the reloaded record', async () => {
    vi.mocked(getAsset).mockResolvedValueOnce(record('a1', 'Speaker One', { status: 'Missing', retired_on: '2026-01-05' }) as any)
    render(<AssetDetailScreen {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo write-off' }))
    await waitFor(() => expect(undoWriteOff).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo write-off' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
  })

  it('Duplicate and Delete go back to the list', async () => {
    render(<AssetDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'Speaker One' })
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(duplicateAsset).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(props.onBack).toHaveBeenCalledTimes(2))
  })
})
