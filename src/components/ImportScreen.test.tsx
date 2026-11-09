import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQuery as render } from '../test/renderWithQuery'
import micKitCsv from '../config/import-examples/mic-kit-purchase.csv?raw'
import ImportScreen from './ImportScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'
import { getItems } from '../services/equipmentItem.service'
import { importPurchases } from '../services/purchase.service'
import { createClient } from '../utils/supabase/client'
import { getKitOptions } from '../services/kit.service'
import { createGig } from '../services/gig.service'
import { toast } from 'sonner'

// Lets a test make the preview's planning fail (#183 D review).
const planControl = vi.hoisted(() => ({ fail: null as string | null }))
vi.mock('../utils/csvAssetImportPlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csvAssetImportPlan')>()
  return {
    ...actual,
    buildAssetImportPlan: (...args: Parameters<typeof actual.buildAssetImportPlan>) => {
      if (planControl.fail) throw new Error(planControl.fail)
      return actual.buildAssetImportPlan(...args)
    },
  }
})

vi.mock('../services/gig.service', () => ({ createGig: vi.fn() }))
vi.mock('../services/purchase.service', () => ({ importPurchases: vi.fn() }))
vi.mock('../services/organization.service', () => ({ searchOrganizations: vi.fn(), createOrganization: vi.fn() }))
vi.mock('../services/equipmentItem.service', () => ({ getItems: vi.fn(async () => []) }))
vi.mock('../services/kit.service', () => ({ getKitOptions: vi.fn(async () => []) }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }))

const props = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onCancel: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('ImportScreen page header (#39)', () => {
  it('names Back for the Gigs list by default and puts it in the header slot', () => {
    const onCancel = vi.fn()
    render(<ImportScreen {...props} onCancel={onCancel} />)
    expect(screen.getByRole('heading', { level: 1, name: 'CSV Import' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Gigs'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('opened from Assets: Back says so and the import type starts on Assets', () => {
    render(<ImportScreen {...props} backLabel="Back to Assets" initialImportType="assets" />)
    expect(getBackInHeaderSlot('Back to Assets')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('Assets')
  })
})

describe('ImportScreen assets import (#183 D)', () => {
  const upload = (container: HTMLElement, lines: string[]) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([lines.join('\n')], 'purchases.csv', { type: 'text/csv' })] } })
  }
  const assetsProps = { ...props, backLabel: 'Back to Assets', initialImportType: 'assets' as const }

  it('offers the microphone example next to the template', () => {
    render(<ImportScreen {...assetsProps} />)
    expect(screen.getByRole('button', { name: 'Download Example' })).toBeInTheDocument()
  })

  it('lets an invalid row’s quantity, serial numbers, tags and kit be fixed on screen', async () => {
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      'source,acquisition_date,vendor,category,manufacturer_model,quantity,serial_number,item_price',
      '1,2025-11-03,Sweetwater,Audio,Halden HX-8M,4,HX8M-55120,250',
    ])
    expect(await screen.findByText(/1 serial number for quantity 4/)).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity')).toHaveValue('4')
    expect(screen.getByLabelText('Serial numbers')).toHaveValue('HX8M-55120')
    expect(screen.getByLabelText('Tags')).toHaveValue('')
    expect(screen.getByLabelText('Kit')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } })
    expect(await screen.findByText('Fixed')).toBeInTheDocument()
  })

  it('shows a notice for an old file’s retired_on and liquidation_amt columns', async () => {
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      'source,acquisition_date,vendor,category,manufacturer_model,quantity,item_price,retired_on,liquidation_amt',
      '1,2025-11-03,Sweetwater,Audio,Shure SM58,1,99,2026-01-01,40',
    ])
    expect(await screen.findByText(/Record sales and retirements on the equipment page/)).toBeInTheDocument()
  })

  it('notes a quantity taken from the serials, a stored item that differs, and the kit', async () => {
    vi.mocked(getItems).mockResolvedValue([
      { id: 'item-58', organization_id: 'org-1', manufacturer_model: 'Shure SM58', category: 'Audio', type: 'Dynamic Microphone', description: null, insurance_class: null, records: [] } as any,
    ])
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      'source,acquisition_date,vendor,category,manufacturer_model,type,quantity,serial_number,kit,item_price',
      '1,2025-11-03,Sweetwater,Audio,Shure SM58,Vocal Mic,,A;B;C;D,Mic Kit 1,99',
    ])
    expect(await screen.findByText('Quantity read as 4 from the serial list.')).toBeInTheDocument()
    expect(await screen.findByText('Differs from the stored item (type). The stored item’s details are kept.')).toBeInTheDocument()
    expect(screen.getByText('Mic Kit 1 (new kit)')).toBeInTheDocument()
  })
})

// #183 D2: the preview's summary cards, its notes, and the grouped column guide (mockup 11).
describe('ImportScreen assets preview (#183 D2)', () => {
  const upload = (container: HTMLElement, content: string) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([content], 'purchases.csv', { type: 'text/csv' })] } })
  }
  const assetsProps = { ...props, backLabel: 'Back to Assets', initialImportType: 'assets' as const }
  const card = (name: string) => within(screen.getByRole('group', { name }))

  beforeEach(() => {
    vi.mocked(getItems).mockReset().mockResolvedValue([])
  })

  it('shows what the microphone example will create, before anything is saved', async () => {
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, micKitCsv)
    await screen.findByRole('group', { name: 'Items' })

    expect(card('Valid rows').getByText('5')).toBeInTheDocument()
    expect(card('Invalid rows').getByText('0')).toBeInTheDocument()
    expect(card('Items').getByText('3')).toBeInTheDocument()
    expect(card('Items').getByText('3 new · 0 existing')).toBeInTheDocument()
    expect(card('Creates').getByText('6 units, 1 lot')).toBeInTheDocument()
    expect(card('Creates').getByText('16 pieces on 4 purchase lines in 1 purchase')).toBeInTheDocument()
    expect(card('Kits').getByText('1')).toBeInTheDocument()
    expect(card('Kits').getByText('New: Mic Kit 1')).toBeInTheDocument()
    expect(importPurchases).not.toHaveBeenCalled()
  })

  it('counts a stored item as existing and lists the preview’s notes by row', async () => {
    vi.mocked(getItems).mockResolvedValue([
      { id: 'item-58', organization_id: 'org-1', manufacturer_model: 'Shure SM58', category: 'Audio', type: 'Dynamic Microphone', description: null, insurance_class: null, records: [] } as any,
    ])
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      'source,acquisition_date,vendor,category,manufacturer_model,type,quantity,serial_number,item_price',
      '1,2025-11-03,Sweetwater,Audio,Shure SM58,Vocal Mic,,A;B;C;D,99',
    ].join('\n'))
    expect(await screen.findByText('Row 2: Quantity read as 4 from the serial list.')).toBeInTheDocument()
    expect(screen.getByText('Row 2: Differs from the stored item (type). The stored item’s details are kept.')).toBeInTheDocument()
    expect(card('Items').getByText('0 new · 1 existing')).toBeInTheDocument()
  })

  it('counts the rows held back with an invalid row', async () => {
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      'source,acquisition_date,vendor,total_inv_amount,manufacturer_model,category,quantity,serial_number,item_price',
      '0,2025-02-01,Vendor B,300,,,,,',
      '1,,,,Item B1,Audio,1,,100',
      '1,,,,Item B2,Audio,4,S1,50',
    ].join('\n'))
    await screen.findByRole('group', { name: 'Invalid rows' })
    expect(card('Invalid rows').getByText('1')).toBeInTheDocument()
    expect(card('Invalid rows').getByText('2 more rows held with it')).toBeInTheDocument()
  })

  it('has a grouped column guide next to the template download', async () => {
    render(<ImportScreen {...assetsProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Template columns/ }))
    for (const name of ['What it is', 'What we own: unit or lot', 'Purchase line']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument()
    }
    const unitGroup = within(screen.getByRole('region', { name: 'What we own: unit or lot' }))
    expect(unitGroup.getByText('kit')).toBeInTheDocument()
    expect(unitGroup.getByText('serial_number')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'What it is' })).getByText('manufacturer_model')).toBeInTheDocument()
  })

  it('has no column guide for gigs', () => {
    render(<ImportScreen {...props} />)
    expect(screen.queryByRole('button', { name: /Template columns/ })).not.toBeInTheDocument()
  })
})

// Review of #183 D: only complete purchases import; a failed purchase can be retried alone.
describe('ImportScreen assets import: held, failed and broken purchases (#183 D)', () => {
  const upload = (container: HTMLElement, lines: string[]) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([lines.join('\n')], 'purchases.csv', { type: 'text/csv' })] } })
  }
  const assetsProps = { ...props, backLabel: 'Back to Assets', initialImportType: 'assets' as const }
  const COLS = 'source,acquisition_date,vendor,total_inv_amount,manufacturer_model,category,quantity,serial_number,kit,item_price'
  const signedIn = () => vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  } as any)
  const sentRows = (call: number) => (vi.mocked(importPurchases).mock.calls[call][1].purchases).map((p) => p.rowIndexes)

  afterEach(() => {
    planControl.fail = null
    vi.mocked(importPurchases).mockReset()
  })

  it('imports only complete purchases, and says which row holds the others back', async () => {
    signedIn()
    vi.mocked(importPurchases).mockResolvedValue({ successCount: 2, errors: [], results: [{ rowIndexes: [2, 3], status: 'success' }] })
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      COLS,
      '0,2025-01-01,Vendor A,110,,,,,,',
      '1,,,,Item A1,Audio,1,,,100',
      '0,2025-02-01,Vendor B,,,,,,,', // no total: invalid
      '1,,,,Item B1,Audio,1,s1,K,100',
    ])
    expect(await screen.findByText('Held: fix row 4')).toBeInTheDocument()
    expect(screen.getByText('1 purchase held back until its invalid rows are fixed.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 Complete Purchase(s)' }))
    await waitFor(() => expect(importPurchases).toHaveBeenCalledTimes(1))
    expect(sentRows(0)).toEqual([[2, 3]])
    expect(await screen.findByText(/Purchases with an invalid row are held back and aren’t imported/)).toBeInTheDocument()
  })

  it('retries only the purchase that failed', async () => {
    signedIn()
    vi.mocked(importPurchases)
      .mockResolvedValueOnce({ successCount: 2, errors: ['Purchase on 2025-01-01 from Vendor A: boom'], results: [
        { rowIndexes: [2, 3], status: 'failed', error: 'boom' },
        { rowIndexes: [4, 5], status: 'success' },
      ] })
      .mockResolvedValueOnce({ successCount: 2, errors: [], results: [{ rowIndexes: [2, 3], status: 'success' }] })
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [
      COLS,
      '0,2025-01-01,Vendor A,100,,,,,,',
      '1,,,,Item A1,Audio,1,,,100',
      '0,2025-02-01,Vendor B,100,,,,,,',
      '1,,,,Item B1,Audio,1,,,100',
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 Complete Purchase(s)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry 1 Failed Purchase(s)' }))
    await waitFor(() => expect(importPurchases).toHaveBeenCalledTimes(2))
    expect(sentRows(1)).toEqual([[2, 3]])
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Complete Purchase/ })).not.toBeInTheDocument()
  })

  it('shows a planning error inline instead of crashing the screen', async () => {
    planControl.fail = 'boom'
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [COLS, '1,2025-01-01,Vendor A,,Item A1,Audio,1,,,100'])
    expect(await screen.findByText('Couldn’t build the import preview: boom')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'CSV Import' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Complete Purchase/ })).not.toBeInTheDocument()
  })

  it('refuses a quantity of 1e1 with one serial instead of crashing', async () => {
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, [COLS, '1,2025-01-01,Vendor A,,Item A1,Audio,1e1,S1,,100'])
    expect(await screen.findByText('Invalid quantity "1e1". Must be a whole number.')).toBeInTheDocument()
  })
})

// A10 characterization: the items and kits an assets file is matched against are read for the
// organization when a file is chosen, again after an import, and a failed read is said once.
describe('ImportScreen: loading and refreshing (A10)', () => {
  const upload = (container: HTMLElement, lines: string[], name = 'purchases.csv') => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([lines.join('\n')], name, { type: 'text/csv' })] } })
  }
  const assetsProps = { ...props, backLabel: 'Back to Assets', initialImportType: 'assets' as const }
  const COLS = 'source,acquisition_date,vendor,total_inv_amount,manufacturer_model,category,quantity,serial_number,kit,item_price'
  const FILE = [COLS, '0,2025-01-01,Vendor A,100,,,,,,', '1,,,,Shure SM58,Audio,1,,,100']
  const card = (name: string) => within(screen.getByRole('group', { name }))
  const stored = { id: 'item-58', organization_id: 'org-1', manufacturer_model: 'Shure SM58', category: 'Audio', type: null, description: null, insurance_class: null, records: [] } as any
  const signedIn = () => vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) },
  } as any)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getItems).mockReset().mockResolvedValue([])
    vi.mocked(getKitOptions).mockReset().mockResolvedValue([])
    vi.mocked(importPurchases).mockReset()
    vi.mocked(createGig).mockReset()
  })

  it('reads nothing until a file is chosen, then the organization\'s items and kits, before the preview', async () => {
    let resolve!: (v: any) => void
    vi.mocked(getItems).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const { container } = render(<ImportScreen {...assetsProps} />)
    expect(getItems).not.toHaveBeenCalled()
    upload(container, FILE)
    expect(await screen.findByText('Processing CSV file...')).toBeInTheDocument()
    await waitFor(() => expect(getItems).toHaveBeenCalledWith(props.organization.id))
    expect(getKitOptions).toHaveBeenCalledWith(props.organization.id)
    resolve([stored])
    await screen.findByRole('group', { name: 'Items' })
    expect(card('Items').getByText('0 new · 1 existing')).toBeInTheDocument()
  })

  it('a gigs file reads no items or kits', async () => {
    const { container } = render(<ImportScreen {...props} />)
    upload(container, ['title,start,end,timezone,status', 'Spring Show,2026-05-01T18:00:00,2026-05-01T22:00:00,America/Los_Angeles,Booked'], 'gigs.csv')
    expect(await screen.findByText('Spring Show')).toBeInTheDocument()
    expect(getItems).not.toHaveBeenCalled()
  })

  it('when the items and kits can\'t be read, says so, and the preview counts every item as new; choosing again reads them', async () => {
    vi.mocked(getItems).mockRejectedValueOnce(new Error('offline'))
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, FILE)
    await screen.findByRole('group', { name: 'Items' })
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/Couldn’t load your items and kits/)))
    expect(card('Items').getByText('1 new · 0 existing')).toBeInTheDocument()
    vi.mocked(getItems).mockResolvedValue([stored])
    upload(container, FILE, 'again.csv')
    await waitFor(() => expect(card('Items').getByText('0 new · 1 existing')).toBeInTheDocument())
  })

  it('another organization\'s file is matched against that organization\'s items', async () => {
    vi.mocked(getItems).mockImplementation(async (orgId: string) => (orgId === 'org-2' ? [stored] : []) as any)
    const { container, rerender } = render(<ImportScreen {...assetsProps} />)
    upload(container, FILE)
    await screen.findByRole('group', { name: 'Items' })
    expect(card('Items').getByText('1 new · 0 existing')).toBeInTheDocument()
    rerender(<ImportScreen {...assetsProps} organization={makeOrganization({ id: 'org-2', name: 'Other' })} />)
    upload(container, FILE, 'again.csv')
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-2'))
    await waitFor(() => expect(card('Items').getByText('0 new · 1 existing')).toBeInTheDocument())
  })

  it('after an import, the items and kits are read again, so the next file matches what it made', async () => {
    signedIn()
    vi.mocked(importPurchases).mockResolvedValue({ successCount: 2, errors: [], results: [{ rowIndexes: [2, 3], status: 'success' }] })
    const { container } = render(<ImportScreen {...assetsProps} />)
    upload(container, FILE)
    await screen.findByRole('group', { name: 'Items' })
    const reads = vi.mocked(getItems).mock.calls.length
    vi.mocked(getItems).mockResolvedValue([stored])
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 Complete Purchase(s)' }))
    await waitFor(() => expect(importPurchases).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(getItems).mock.calls.length).toBeGreaterThan(reads))
    expect(toast.success).toHaveBeenCalledWith('Successfully imported 2 row(s)')
    upload(container, FILE, 'next.csv')
    await waitFor(() => expect(card('Items').getByText('0 new · 1 existing')).toBeInTheDocument())
  })

  it('imports a gigs file row by row, showing each row\'s result', async () => {
    signedIn()
    vi.mocked(createGig).mockResolvedValueOnce({ id: 'g1' } as any).mockRejectedValueOnce(new Error('duplicate key value violates'))
    const { container } = render(<ImportScreen {...props} />)
    upload(container, [
      'title,start,end,timezone,status',
      'Spring Show,2026-05-01T18:00:00,2026-05-01T22:00:00,America/Los_Angeles,Booked',
      'Summer Show,2026-06-01T18:00:00,2026-06-01T22:00:00,America/Los_Angeles,Booked',
    ], 'gigs.csv')
    fireEvent.click(await screen.findByRole('button', { name: /Import 2/ }))
    await waitFor(() => expect(createGig).toHaveBeenCalledTimes(2))
    expect(createGig).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spring Show', primary_organization_id: props.organization.id }), { skipActivityLog: true })
    expect(await screen.findByText(/A gig with similar data already exists/)).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Successfully imported 1 gig(s)')
    expect(toast.error).toHaveBeenCalledWith('Failed to import 1 row(s). Check errors below.')
  })
})
