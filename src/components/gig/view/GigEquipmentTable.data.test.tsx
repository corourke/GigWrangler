/** A10 characterization: how the gig page's Equipment card loads. */
import { renderWithQuery as render } from '../../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, act, within } from '@testing-library/react'
import GigEquipmentTable from './GigEquipmentTable'
import { getGigKits } from '../../../services/gig.service'
import { getKitsFlattenedSummary } from '../../../services/kit.service'
import { getPackingListReport } from '../../../services/inventoryManagement.service'

vi.mock('../../../services/gig.service', () => ({ getGigKits: vi.fn() }))
vi.mock('../../../services/kit.service', () => ({ getKitsFlattenedSummary: vi.fn() }))
vi.mock('../../../services/inventoryManagement.service', () => ({ getPackingListReport: vi.fn() }))

const kit = (gigId: string) => ({ id: `a-${gigId}`, kit_id: `k-${gigId}`, kit: { id: `k-${gigId}`, name: `Kit for ${gigId}`, tag_number: null } })
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  localStorage.clear()
  vi.mocked(getGigKits).mockReset().mockImplementation(async (gigId: string) => [kit(gigId)] as any)
  vi.mocked(getKitsFlattenedSummary).mockReset().mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, { totalItems: 4 } as any])))
  vi.mocked(getPackingListReport).mockReset().mockResolvedValue([])
})

describe('GigEquipmentTable data (A10 characterization)', () => {
  it('loading, then the kits and what each holds', async () => {
    const kits = deferred<any>()
    vi.mocked(getGigKits).mockReturnValueOnce(kits.promise)
    render(<GigEquipmentTable gigId="g1" organizationId="org-1" showAmounts={false} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await act(async () => kits.resolve([kit('g1')]))
    const row = (await screen.findByText('Kit for g1')).closest('tr')!
    expect(await within(row).findByText('4 pieces')).toBeInTheDocument()
    expect(getGigKits).toHaveBeenCalledWith('g1', 'org-1')
  })

  it('a failed read shows no equipment', async () => {
    vi.mocked(getGigKits).mockRejectedValueOnce(new Error('down'))
    render(<GigEquipmentTable gigId="g1" organizationId="org-1" showAmounts={false} />)
    expect(await screen.findByText('No equipment assigned yet')).toBeInTheDocument()
  })

  it('another gig reads its kits; a slow earlier answer never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(getGigKits).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<GigEquipmentTable gigId="g1" organizationId="org-1" showAmounts={false} />)
    rerender(<GigEquipmentTable gigId="g2" organizationId="org-1" showAmounts={false} />)
    expect(await screen.findByText('Kit for g2')).toBeInTheDocument()
    await act(async () => slow.resolve([kit('g1')]))
    expect(screen.queryByText('Kit for g1')).not.toBeInTheDocument()
  })
})
