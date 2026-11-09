/**
 * A10 characterization: how the kit edit screen loads and saves its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import KitScreen from './KitScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getKit, getKits, getKitsFlattenedSummary, createKit, updateKit } from '../services/kit.service'
import { getAssets } from '../services/asset.service'
import { getItems, getContainerPieces } from '../services/equipmentItem.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../services/kit.service', () => ({
  getKit: vi.fn(),
  getKits: vi.fn(),
  getKitsFlattenedSummary: vi.fn(),
  getKitsThatWouldCycle: vi.fn().mockResolvedValue(new Set()),
  createKit: vi.fn(),
  updateKit: vi.fn(),
}))
vi.mock('../services/asset.service', () => ({ getAssets: vi.fn() }))
vi.mock('../services/equipmentItem.service', () => ({ getItems: vi.fn(), getContainerPieces: vi.fn() }))
vi.mock('../utils/hooks/useAutocompleteSuggestions', () => ({
  useAutocompleteSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false, error: null })),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const kitOf = (id: string, name: string, components: any[] = []) => ({ id, name, category: 'Audio', kit_components: components })
const cableLine = { id: 'kc-1', asset_id: 'a1', quantity: 2, asset: { id: 'a1', manufacturer_model: 'Cable Reel', replacement_value: 10, quantity: 5 } }
const subKitLine = { id: 'kc-2', child_kit_id: 'sub-1', quantity: 1, child_kit: { id: 'sub-1', name: 'Sub Rack' } }

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onCancel: vi.fn(),
  onKitCreated: vi.fn(),
  onKitUpdated: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getKit).mockReset().mockImplementation((id: string) =>
    Promise.resolve((id === 'kit-2' ? kitOf('kit-2', 'Second Kit') : kitOf('kit-1', 'First Kit', [cableLine, subKitLine])) as any))
  vi.mocked(getKits).mockReset().mockResolvedValue([])
  vi.mocked(getKitsFlattenedSummary).mockReset().mockImplementation(async (ids: string[]) =>
    new Map(ids.map((id) => [id, { totalValue: 1234, totalItems: 3, assetIds: new Set(), assetLabels: new Map(), itemQuantities: new Map() }])) as any)
  vi.mocked(createKit).mockReset().mockResolvedValue({ id: 'kit-new' } as any)
  vi.mocked(updateKit).mockReset().mockResolvedValue({} as any)
  vi.mocked(getAssets).mockReset().mockResolvedValue([{ id: 'a7', manufacturer_model: 'Wireless Mic', quantity: 1, status: 'Active' }] as any)
  vi.mocked(getItems).mockReset().mockResolvedValue([])
  vi.mocked(getContainerPieces).mockReset().mockResolvedValue({ all: new Map(), active: new Map() } as any)
  props.onCancel.mockReset()
  props.onKitCreated.mockReset()
  props.onKitUpdated.mockReset()
  vi.mocked(toast.error).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('KitScreen data (A10 characterization)', () => {
  it('edit mode, first load: a spinner, then the kit in the form', async () => {
    const kit = deferred<any>()
    vi.mocked(getKit).mockReturnValueOnce(kit.promise)
    render(<KitScreen {...props} kitId="kit-1" />)
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeNull())
    await act(async () => kit.resolve(kitOf('kit-1', 'First Kit', [cableLine])))
    expect(await screen.findByDisplayValue('First Kit')).toBeInTheDocument()
    expect(screen.getByText('Cable Reel')).toBeInTheDocument()
    expect(getItems).toHaveBeenCalledWith('org-1')
    expect(getContainerPieces).toHaveBeenCalledWith('org-1', [], 'kit-1')
  })

  it('a sub-kit line is valued at its flattened contents', async () => {
    render(<KitScreen {...props} kitId="kit-1" />)
    await screen.findByText('Sub Rack')
    await waitFor(() => expect(getKitsFlattenedSummary).toHaveBeenCalledWith(['sub-1']))
    expect((await screen.findAllByText('$1,234.00')).length).toBeGreaterThan(0)
  })

  it('a load error says why and leaves the screen', async () => {
    vi.mocked(getKit).mockRejectedValueOnce(new Error('Kit not found'))
    render(<KitScreen {...props} kitId="kit-1" />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kit not found'))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('switching kit loads the new one into the form', async () => {
    const { rerender } = render(<KitScreen {...props} kitId="kit-1" />)
    await screen.findByDisplayValue('First Kit')
    rerender(<KitScreen {...props} kitId="kit-2" />)
    expect(await screen.findByDisplayValue('Second Kit')).toBeInTheDocument()
    expect(getKit).toHaveBeenLastCalledWith('kit-2')
  })

  it('switching organization reloads its items', async () => {
    const { rerender } = render(<KitScreen {...props} />)
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-1'))
    rerender(<KitScreen {...props} organization={makeOrganization({ id: 'org-2' })} />)
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-2'))
  })

  it('the picker loads candidates when opened, and again for a search', async () => {
    render(<KitScreen {...props} />)
    fireEvent.click(screen.getByText('Add Components'))
    expect(await screen.findByText('Wireless Mic')).toBeInTheDocument()
    expect(getAssets).toHaveBeenCalledWith('org-1', { search: undefined })
    fireEvent.change(screen.getByPlaceholderText('Search items, units and kits...'), { target: { value: 'mic' } })
    await waitFor(() => expect(getAssets).toHaveBeenCalledWith('org-1', { search: 'mic' }))
    await waitFor(() => expect(getKits).toHaveBeenCalledWith('org-1', { search: 'mic' }))
  })

  it('saving an edit updates the kit and reports it', async () => {
    render(<KitScreen {...props} kitId="kit-1" />)
    const name = await screen.findByDisplayValue('First Kit')
    fireEvent.change(name, { target: { value: 'Renamed Kit' } })
    fireEvent.click(screen.getByRole('button', { name: /update kit/i }))
    await waitFor(() => expect(updateKit).toHaveBeenCalledWith('kit-1', expect.objectContaining({ name: 'Renamed Kit' }), ['kc-1', 'kc-2']))
    await waitFor(() => expect(props.onKitUpdated).toHaveBeenCalled())
    expect(screen.getByDisplayValue('Renamed Kit')).toBeInTheDocument()
  })

  it('a failed save says why and stays on the form', async () => {
    vi.mocked(updateKit).mockRejectedValueOnce(new Error('Would make a loop'))
    render(<KitScreen {...props} kitId="kit-1" />)
    fireEvent.change(await screen.findByDisplayValue('First Kit'), { target: { value: 'Renamed Kit' } })
    fireEvent.click(screen.getByRole('button', { name: /update kit/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Would make a loop'))
    expect(props.onKitUpdated).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Renamed Kit')).toBeInTheDocument()
  })

  it('creating a kit opens the new one', async () => {
    render(<KitScreen {...props} />)
    fireEvent.change(screen.getByLabelText(/Kit Name/), { target: { value: 'New Kit' } })
    fireEvent.click(screen.getByText('Add Components'))
    fireEvent.click(await screen.findByText('Wireless Mic'))
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Selected/ }))
    fireEvent.click(screen.getByRole('button', { name: /create kit/i }))
    await waitFor(() => expect(createKit).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Kit', organization_id: 'org-1' })))
    await waitFor(() => expect(props.onKitCreated).toHaveBeenCalledWith('kit-new'))
  })
})
