/**
 * A10 characterization: how the kit list loads and refreshes its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import KitListScreen from './KitListScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getKits, getKitsFlattenedSummary, deleteKit, duplicateKit, updateKit } from '../services/kit.service'
import { getKitTrackingSummary, getPackingListReport } from '../services/inventoryManagement.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../services/kit.service', () => ({
  getKits: vi.fn(),
  deleteKit: vi.fn(),
  duplicateKit: vi.fn(),
  updateKit: vi.fn(),
  getKitsFlattenedSummary: vi.fn(),
}))
vi.mock('../services/inventoryManagement.service', () => ({
  getKitTrackingSummary: vi.fn(),
  getPackingListReport: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// A plain stand-in for the table: one line per row, with its actions and an inline edit.
vi.mock('./tables/SmartDataTable', () => ({
  SmartDataTable: ({ data, rowActions, onRowUpdate, isLoading }: any) => (
    <div>
      {isLoading && <span>table loading</span>}
      {!isLoading && data.map((row: any) => (
        <div key={row.id}>
          <span>{`row ${row.id} ${row.name} ${row.category ?? ''}`}</span>
          {rowActions?.map((a: any) => (
            <button key={a.id} onClick={() => a.onClick(row)}>{`${a.id} ${row.id}`}</button>
          ))}
          <button onClick={() => onRowUpdate?.(row.id, { category: 'Lighting' })}>{`inline-edit ${row.id}`}</button>
        </div>
      ))}
    </div>
  ),
}))

const kit = (id: string, name: string, org = 'org-1', over: Record<string, unknown> = {}) => ({
  id, organization_id: org, name, category: 'Audio', is_container: false, kit_components: [], ...over,
})
const org1Kits = () => [kit('k1', 'Stage Left'), kit('k2', 'Stage Right')]
const org2Kits = () => [kit('k9', 'Drum Kit', 'org-2')]

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onBack: vi.fn(),
  onCreateKit: vi.fn(),
  onViewKit: vi.fn(),
  onEditKit: vi.fn(),
  onNavigateToDashboard: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onNavigateToAssets: vi.fn(),
  onNavigateToKits: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getKits).mockReset().mockImplementation((orgId: string) =>
    Promise.resolve((orgId === 'org-2' ? org2Kits() : org1Kits()) as any))
  vi.mocked(getKitTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getKitsFlattenedSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getPackingListReport).mockReset().mockResolvedValue([])
  vi.mocked(deleteKit).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateKit).mockReset().mockResolvedValue({ id: 'k3' } as any)
  vi.mocked(updateKit).mockReset().mockResolvedValue({} as any)
  vi.mocked(toast.error).mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('KitListScreen data (A10 characterization)', () => {
  it('first load: the table loads, then shows the kits', async () => {
    const kits = deferred<any>()
    vi.mocked(getKits).mockReturnValueOnce(kits.promise)
    render(<KitListScreen {...props} />)
    expect(screen.getByText('table loading')).toBeInTheDocument()
    await act(async () => kits.resolve(org1Kits()))
    expect(await screen.findByText(/^row k1 Stage Left/)).toBeInTheDocument()
    expect(getKitsFlattenedSummary).toHaveBeenCalledWith(['k1', 'k2'])
    expect(getKitTrackingSummary).toHaveBeenCalledWith('org-1')
  })

  it('a load error shows the message; Try Again loads it', async () => {
    vi.mocked(getKits).mockRejectedValueOnce(new Error('Network down'))
    render(<KitListScreen {...props} />)
    expect(await screen.findByText('Error loading kits')).toBeInTheDocument()
    expect(screen.getByText('Network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText(/^row k1 Stage Left/)).toBeInTheDocument()
  })

  it('switching organization loads that organization’s kits', async () => {
    const { rerender } = render(<KitListScreen {...props} />)
    await screen.findByText(/^row k1 /)
    rerender(<KitListScreen {...props} organization={makeOrganization({ id: 'org-2' })} />)
    expect(await screen.findByText(/^row k9 Drum Kit/)).toBeInTheDocument()
    expect(screen.queryByText(/^row k1 /)).not.toBeInTheDocument()
  })

  it('after Duplicate the list is reloaded and shows the copy', async () => {
    render(<KitListScreen {...props} />)
    await screen.findByText(/^row k1 /)
    vi.mocked(getKits).mockResolvedValue([...org1Kits(), kit('k3', 'Stage Left (copy)')] as any)
    fireEvent.click(screen.getByRole('button', { name: 'duplicate k1' }))
    await waitFor(() => expect(duplicateKit).toHaveBeenCalledWith('k1'))
    expect(await screen.findByText(/^row k3 Stage Left \(copy\)/)).toBeInTheDocument()
  })

  it('after Delete the list is reloaded', async () => {
    render(<KitListScreen {...props} />)
    await screen.findByText(/^row k2 /)
    vi.mocked(getKits).mockResolvedValue([kit('k1', 'Stage Left')] as any)
    fireEvent.click(screen.getByRole('button', { name: 'delete k2' }))
    await waitFor(() => expect(deleteKit).toHaveBeenCalledWith('k2'))
    await waitFor(() => expect(screen.queryByText(/^row k2 /)).not.toBeInTheDocument())
  })

  it('a failed Delete says why and reloads the list', async () => {
    vi.mocked(deleteKit).mockRejectedValueOnce(new Error('Kit is on a gig'))
    render(<KitListScreen {...props} />)
    await screen.findByText(/^row k2 /)
    const loads = vi.mocked(getKits).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'delete k2' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kit is on a gig'))
    await waitFor(() => expect(vi.mocked(getKits).mock.calls.length).toBeGreaterThan(loads))
    expect(await screen.findByText(/^row k2 /)).toBeInTheDocument()
  })

  it('an inline edit shows the new value once saved', async () => {
    render(<KitListScreen {...props} />)
    await screen.findByText(/^row k1 /)
    fireEvent.click(screen.getByRole('button', { name: 'inline-edit k1' }))
    await waitFor(() => expect(updateKit).toHaveBeenCalledWith('k1', { category: 'Lighting' }))
    expect(await screen.findByText('row k1 Stage Left Lighting')).toBeInTheDocument()
  })

  it('a failed inline edit says why and reloads the list', async () => {
    vi.mocked(updateKit).mockRejectedValueOnce(new Error('Not allowed'))
    render(<KitListScreen {...props} />)
    await screen.findByText(/^row k1 /)
    const loads = vi.mocked(getKits).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'inline-edit k1' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not allowed'))
    await waitFor(() => expect(vi.mocked(getKits).mock.calls.length).toBeGreaterThan(loads))
    expect(await screen.findByText('row k1 Stage Left Audio')).toBeInTheDocument()
  })
})
