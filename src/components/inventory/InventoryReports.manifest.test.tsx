import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { ManifestReport } from './InventoryReports';
import type { ManifestLine } from '../../services/inventoryManagement.service';

vi.mock('../../services/inventoryManagement.service', () => ({
  getGigsForReportPicker: vi.fn().mockResolvedValue([]),
  getInventoryConflictFlags: vi.fn().mockResolvedValue(new Set()),
  getManifestReport: vi.fn(),
  getPackingListReport: vi.fn(),
}));
// A plain box: choosing the place is what matters here, not its suggestions.
vi.mock('./LocationCombobox', () => ({
  LocationCombobox: ({ value, onChange }: any) => (
    <input aria-label="Location" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { getManifestReport } from '../../services/inventoryManagement.service';

const at = { status: 'In Transit', location: 'Truck', gig_id: 'gig-1', gig_title: 'Harvest Gala', scanned_at: '2026-10-20T17:00:00Z',
  scanned_by_name: 'Sam Roadie', notes: null };
const LINES: ManifestLine[] = [
  { ...at, kit_id: 'pack', kit_name: 'Small Gig Pack', is_container: false, asset_id: 'cables', asset_name: 'XLR Cable, 25 ft',
    tag_number: null, quantity: 4, lot_of: 10, notes: 'Bundled' },
  { ...at, kit_id: 'pack', kit_name: 'Small Gig Pack', is_container: false, asset_id: 'amp', asset_name: 'Amp', tag_number: 'A-1', quantity: 1, lot_of: null },
  { ...at, kit_id: '', kit_name: null, is_container: false, asset_id: 'di', asset_name: 'DI Box', tag_number: 'DI-1', quantity: 1, lot_of: null },
  { ...at, kit_id: 'case', kit_name: 'Mic Case', kit_tag_number: 'CASE-1', is_container: true, asset_id: null, asset_name: null,
    tag_number: null, quantity: 1, lot_of: null, contents: ['2 × Shure SM58', '1 × Mic Clip Bag'] },
];

async function openAt(place: string) {
  render(<ManifestReport organizationId="org-1" organizationName="Test Org" />);
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: place } });
  await waitFor(() => expect(getManifestReport).toHaveBeenCalledWith('org-1', { location: place, gigId: undefined }));
}
const names = () => screen.getAllByTestId('manifest-name').map((n) => n.textContent);
const rowOf = (name: string) => screen.getAllByTestId('manifest-name').find((n) => n.textContent === name)!.closest('tr')!;

describe('Print manifest (#327)', () => {
  beforeEach(() => vi.mocked(getManifestReport).mockResolvedValue(LINES));

  it('lists kits and cases A to Z with their contents under them, then what is not in a kit', async () => {
    await openAt('Truck');
    await waitFor(() => expect(names()).toEqual(['Mic Case', 'Small Gig Pack', 'Amp', 'XLR Cable, 25 ft', 'Not in a kit', 'DI Box']));
    expect(rowOf('Amp')).toHaveAttribute('data-depth', '1');
    expect(rowOf('Small Gig Pack')).toHaveAttribute('data-depth', '0');
  });

  it('names the columns Name, Tag #, Qty, then Status and the rest', async () => {
    await openAt('Truck');
    await waitFor(() => expect(names().length).toBeGreaterThan(0));
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['✓', 'Name', 'Tag #', 'Qty', 'Status', 'Gig', 'Last Scanned', 'Scanned By', 'Notes']);
    expect(screen.queryByText('Asset / Kit')).not.toBeInTheDocument();
  });

  it('shows a lot as "4 of 10" with its pieces in Qty and a blank Tag #', async () => {
    await openAt('Truck');
    await waitFor(() => expect(names()).toContain('XLR Cable, 25 ft'));
    const cells = within(rowOf('XLR Cable, 25 ft')).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('4 of 10');
    expect(cells[2]).toHaveTextContent(/^$/);
    expect(cells[3]).toHaveTextContent('4');
    expect(cells[8]).toHaveTextContent('Bundled');
  });

  it('shows a unit\'s tag, and a case with its tag and what it holds', async () => {
    await openAt('Truck');
    await waitFor(() => expect(names()).toContain('Mic Case'));
    expect(within(rowOf('Amp')).getAllByRole('cell')[2]).toHaveTextContent('A-1');
    const caseRow = rowOf('Mic Case');
    expect(within(caseRow).getAllByRole('cell')[2]).toHaveTextContent('CASE-1');
    expect(caseRow).toHaveTextContent('2 × Shure SM58 · 1 × Mic Clip Bag');
  });

  it('prints "Manifest", the place as the title, and its kits and pieces', async () => {
    await openAt('Truck');
    await waitFor(() => expect(names().length).toBeGreaterThan(0));
    const header = screen.getByTestId('manifest-print-header');
    expect(header).toHaveTextContent('Manifest · Test Org');
    expect(within(header).getByText('Truck')).toBeInTheDocument();
    // 2 kits (the case and Small Gig Pack); pieces: case 1 + Amp 1 + 4 cables + DI Box 1.
    expect(header).toHaveTextContent('2 kits · 7 pieces');
    expect(screen.queryByText('Truck Manifest')).not.toBeInTheDocument();
  });

  it('counts one kit and one piece in the singular', async () => {
    vi.mocked(getManifestReport).mockResolvedValue([LINES[3]]);
    await openAt('Truck');
    await waitFor(() => expect(names()).toEqual(['Mic Case']));
    expect(screen.getByTestId('manifest-print-header')).toHaveTextContent('1 kit · 1 piece');
  });

  it('says when nothing is there', async () => {
    vi.mocked(getManifestReport).mockResolvedValue([]);
    await openAt('Garage');
    expect(await screen.findByText('Nothing is at Garage now.')).toBeInTheDocument();
  });
});
