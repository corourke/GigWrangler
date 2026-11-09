/**
 * A10 characterization: how the kit page loads and refreshes its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import KitDetailScreen from './KitDetailScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getKit, getKitComponentTree, getKitFlattenedContents, getKitFlattenedItems, deleteKit, duplicateKit } from '../services/kit.service'
import { getEntityActivity } from '../services/activityLog.service'


vi.mock('../services/kit.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/kit.service')>()
  return {
    ...actual,
    getKit: vi.fn(),
    getKitFlattenedContents: vi.fn(),
    getKitComponentTree: vi.fn(),
    getKitFlattenedItems: vi.fn(),
    deleteKit: vi.fn(),
    duplicateKit: vi.fn(),
  }
})
vi.mock('../services/activityLog.service', () => ({ getEntityActivity: vi.fn() }))
vi.mock('./ActivityFeed', () => ({
  default: ({ entries, isLoading }: any) => <div>{isLoading ? 'activity loading' : `activity ${entries.length}`}</div>,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const kitOf = (id: string, name: string) => ({ id, name, category: 'Audio', rental_value: 0, is_container: false })
const leaf = (n: number) => ({ clientKey: `a${n}`, type: 'asset', quantity: 1, asset: { manufacturer_model: `Piece ${n}` }, children: [] })
const nested = (depth: number): any[] => (depth === 0 ? [leaf(1)] : [{
  clientKey: `k${depth}`, type: 'kit', quantity: 1, kit: { id: `k${depth}`, name: `Level ${depth}`, is_container: false }, children: nested(depth - 1),
}])

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  kitId: 'kit-1',
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
  vi.mocked(getKit).mockReset().mockImplementation((id: string) =>
    Promise.resolve((id === 'kit-2' ? kitOf('kit-2', 'Second Kit') : kitOf('kit-1', 'First Kit')) as any))
  vi.mocked(getKitFlattenedContents).mockReset().mockResolvedValue([])
  vi.mocked(getKitComponentTree).mockReset().mockResolvedValue([])
  vi.mocked(getKitFlattenedItems).mockReset().mockResolvedValue([])
  vi.mocked(getEntityActivity).mockReset().mockResolvedValue([{ id: 'e1' }] as any)
  vi.mocked(deleteKit).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateKit).mockReset().mockResolvedValue({ id: 'kit-copy' } as any)
  vi.mocked(toast.warning).mockReset()
  props.onBack.mockReset()
  props.onEdit.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('KitDetailScreen data (A10 characterization)', () => {
  it('first load: a spinner, then the kit and its activity', async () => {
    const kit = deferred<any>()
    vi.mocked(getKit).mockReturnValueOnce(kit.promise)
    render(<KitDetailScreen {...props} />)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    await act(async () => kit.resolve(kitOf('kit-1', 'First Kit')))
    expect(await screen.findByRole('heading', { level: 1, name: 'First Kit' })).toBeInTheDocument()
    expect(await screen.findByText('activity 1')).toBeInTheDocument()
    expect(getEntityActivity).toHaveBeenCalledWith('kit', 'kit-1')
    expect(getKitFlattenedContents).toHaveBeenCalledWith('kit-1')
    expect(getKitComponentTree).toHaveBeenCalledWith('kit-1')
    expect(getKitFlattenedItems).toHaveBeenCalledWith('kit-1')
  })

  it('a load error shows the message; Retry loads it', async () => {
    vi.mocked(getKitComponentTree).mockRejectedValueOnce(new Error('Network down'))
    render(<KitDetailScreen {...props} />)
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'First Kit' })).toBeInTheDocument()
  })

  it('an activity error still shows the kit', async () => {
    vi.mocked(getEntityActivity).mockRejectedValueOnce(new Error('activity down'))
    render(<KitDetailScreen {...props} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'First Kit' })).toBeInTheDocument()
    expect(await screen.findByText('activity 0')).toBeInTheDocument()
  })

  it('warns about a deeply nested kit once it loads', async () => {
    vi.mocked(getKitComponentTree).mockResolvedValue(nested(7) as any)
    render(<KitDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'First Kit' })
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/nested 7 levels deep/)))
  })

  it('switching kit loads the new one', async () => {
    const { rerender } = render(<KitDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'First Kit' })
    rerender(<KitDetailScreen {...props} kitId="kit-2" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Second Kit' })).toBeInTheDocument()
    expect(getKit).toHaveBeenLastCalledWith('kit-2')
  })

  it('a slow answer for the earlier kit never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getKit).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<KitDetailScreen {...props} />)
    rerender(<KitDetailScreen {...props} kitId="kit-2" />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Second Kit' })).toBeInTheDocument()
    await act(async () => slow.resolve(kitOf('kit-1', 'First Kit')))
    expect(screen.getByRole('heading', { level: 1, name: 'Second Kit' })).toBeInTheDocument()
  })

  it('Duplicate opens the copy; Delete goes back to the list', async () => {
    render(<KitDetailScreen {...props} />)
    await screen.findByRole('heading', { level: 1, name: 'First Kit' })
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(props.onEdit).toHaveBeenCalledWith('kit-copy'))
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(deleteKit).toHaveBeenCalledWith('kit-1'))
    await waitFor(() => expect(props.onBack).toHaveBeenCalled())
  })
})
