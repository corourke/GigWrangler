/**
 * A10 characterization: how the item page loads and refreshes its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ItemDetailScreen from './ItemDetailScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getItem, getItemKitLines, getContainerPieces, updateItem } from '../services/equipmentItem.service'
import { getAssetTrackingSummary, getItemWhereabouts } from '../services/inventoryManagement.service'


vi.mock('../services/equipmentItem.service', () => ({
  getItem: vi.fn(),
  getContainerPieces: vi.fn(),
  getItemKitLines: vi.fn(),
  updateItem: vi.fn(),
}))
vi.mock('../services/inventoryManagement.service', () => ({
  getAssetTrackingSummary: vi.fn(),
  getItemWhereabouts: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const itemOf = (id: string, model: string) => ({
  id, organization_id: 'org-1', manufacturer_model: model, category: 'Audio', type: 'Speaker',
  description: '', insurance_class: 'Class B',
  records: [{ id: `${id}-u1`, equipment_item_id: id, manufacturer_model: model, category: 'Audio', quantity: 1, tag_number: `TAG-${id}`, status: 'Active', replacement_value: 100 }],
})

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  itemId: 'i1',
  onBack: vi.fn(),
  onViewAsset: vi.fn(),
  onAddRecord: vi.fn(),
  onViewKit: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getItem).mockReset().mockImplementation((id: string) =>
    Promise.resolve(itemOf(id, id === 'i2' ? 'Mixer Two' : 'Speaker One') as any))
  vi.mocked(getContainerPieces).mockReset().mockResolvedValue({ all: new Map(), active: new Map() } as any)
  vi.mocked(getItemKitLines).mockReset().mockResolvedValue([])
  vi.mocked(updateItem).mockReset().mockResolvedValue({} as any)
  vi.mocked(getAssetTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getItemWhereabouts).mockReset().mockResolvedValue([])
})

describe('ItemDetailScreen data (A10 characterization)', () => {
  it('first load: a spinner, then the item', async () => {
    const item = deferred<any>()
    vi.mocked(getItem).mockReturnValueOnce(item.promise)
    render(<ItemDetailScreen {...props} />)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    await act(async () => item.resolve(itemOf('i1', 'Speaker One')))
    expect(await screen.findByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
    await waitFor(() => expect(getItemKitLines).toHaveBeenCalledWith('i1', ['i1-u1']))
    expect(getAssetTrackingSummary).toHaveBeenCalledWith('org-1')
    expect(getItemWhereabouts).toHaveBeenCalledWith('org-1', expect.any(Array))
  })

  it('a load error shows the message; Retry loads it', async () => {
    vi.mocked(getItem).mockRejectedValueOnce(new Error('Network down'))
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    await ue.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Speaker One' })).toBeInTheDocument()
    expect(screen.queryByText('Network down')).not.toBeInTheDocument()
  })

  it('an error in the item’s details shows the message too', async () => {
    vi.mocked(getItemKitLines).mockRejectedValueOnce(new Error('Kits down'))
    render(<ItemDetailScreen {...props} />)
    expect(await screen.findByText('Kits down')).toBeInTheDocument()
  })

  it('switching item loads the new one', async () => {
    const { rerender } = render(<ItemDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'Speaker One' })
    rerender(<ItemDetailScreen {...props} itemId="i2" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Mixer Two' })).toBeInTheDocument()
    expect(getItem).toHaveBeenLastCalledWith('i2')
  })

  it('a saved edit shows on the page without a reload', async () => {
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    await screen.findByText('TAG-i1')
    await ue.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Insurance class')
    await ue.clear(field)
    await ue.type(field, 'Class A')
    await ue.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument())
    expect(screen.getByText('Class A')).toBeInTheDocument()
    expect(updateItem).toHaveBeenCalledWith('i1', expect.objectContaining({ insurance_class: 'Class A' }))
  })
})
