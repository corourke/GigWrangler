import { renderWithQuery as render } from '../../../test/renderWithQuery';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import GigEquipmentTable from './GigEquipmentTable';
import { getGigKits } from '../../../services/gig.service';
import { getKitsFlattenedSummary } from '../../../services/kit.service';
import { getPackingListReport, type PackingListRow } from '../../../services/inventoryManagement.service';

vi.mock('../../../services/gig.service', () => ({ getGigKits: vi.fn() }));
vi.mock('../../../services/kit.service', () => ({ getKitsFlattenedSummary: vi.fn() }));
vi.mock('../../../services/inventoryManagement.service', () => ({ getPackingListReport: vi.fn() }));

const KITS = [
  { id: 'a1', kit_id: 'pa', kit: { id: 'pa', name: 'Main PA', tag_number: 'KIT-005' } },
  { id: 'a2', kit_id: 'case', kit: { id: 'case', name: 'Mic Case', tag_number: null } },
];
const line = (over: Partial<PackingListRow>): PackingListRow => ({
  kit_id: 'pa', is_container: false, kind: 'unit', quantity: 1, packed: 0, has_conflict: false,
  group_kit_id: 'pa', group_kit_name: 'Main PA', group_is_container: false, group_tag_number: null, ...over,
});
const PACKING: PackingListRow[] = [
  line({ asset_id: 'k1', packed: 1, status: 'On Site', location: 'Stage Left' }),
  line({ asset_id: 'k2', packed: 1, status: 'In Transit', location: 'Truck' }),
  line({ asset_id: 'k3' }),
  line({ kit_id: 'case', kind: 'container', is_container: true, group_kit_id: 'case', group_kit_name: 'Mic Case', group_is_container: true }),
];

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
const pick = (label: string) => fireEvent.click(within(screen.getByText(label, { selector: 'label' })).getByRole('checkbox'));

// #185: the gig's Equipment card says how many pieces each kit holds.
describe('GigEquipmentTable', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getGigKits).mockResolvedValue(KITS as any);
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map([
      ['pa', { totalItems: 12 } as any],
      ['case', { totalItems: 1 } as any],
    ]));
    vi.mocked(getPackingListReport).mockResolvedValue(PACKING);
  });

  it('has a Holds column: the pieces in each kit, "any" lines included', async () => {
    render(<GigEquipmentTable gigId="gig-1" organizationId="org-1" showAmounts={false} />);
    expect(await screen.findByRole('columnheader', { name: 'Holds' })).toBeInTheDocument();
    expect(within((await screen.findByText('Main PA')).closest('tr')!).getByText('12 pieces')).toBeInTheDocument();
    expect(within(screen.getByText('Mic Case').closest('tr')!).getByText('1 piece')).toBeInTheDocument();
    expect(getKitsFlattenedSummary).toHaveBeenCalledWith(['pa', 'case']);
  });

  // Cameron, 10-09: Status and Location per kit, from the packing list's counts.
  it('Status and Location start hidden, and the packing list is not read for them', async () => {
    render(<GigEquipmentTable gigId="gig-1" organizationId="org-1" showAmounts={false} />);
    await screen.findByText('Main PA');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument();
    expect(getPackingListReport).not.toHaveBeenCalled();
  });

  it('the picker shows and hides Status and Location', async () => {
    render(<GigEquipmentTable gigId="gig-1" organizationId="org-1" showAmounts={false} />);
    await screen.findByText('Main PA');
    openPicker();
    pick('Status');
    pick('Location');

    expect(await screen.findByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Location' })).toBeInTheDocument();
    expect(getPackingListReport).toHaveBeenCalledTimes(1);
    expect(getPackingListReport).toHaveBeenCalledWith('org-1', 'gig-1');

    const pa = screen.getByText('Main PA').closest('tr')!;
    const status = await within(pa).findByText('On Site 1 of 3 · In Transit 1');
    expect(status).toHaveAttribute('title', 'On Site 1 · In Transit 1 · Not packed 1');
    expect(within(pa).getByText('Mixed')).toHaveAttribute('title', 'Stage Left 1 · Truck 1');
    const mics = screen.getByText('Mic Case').closest('tr')!;
    expect(within(mics).getByText('Not packed')).toHaveClass('text-muted-foreground');

    pick('Status');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByText('On Site 1 of 3 · In Transit 1')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Location' })).toBeInTheDocument();
    pick('Location');
    expect(screen.queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument();
    // Turning a column back on reuses what was read.
    pick('Status');
    expect(await screen.findByText('On Site 1 of 3 · In Transit 1')).toBeInTheDocument();
    expect(getPackingListReport).toHaveBeenCalledTimes(1);
  });

  // #185 PR 2: a kit added on the phone at pack-out says so.
  it('labels a kit added at pack-out', async () => {
    vi.mocked(getGigKits).mockResolvedValue([{ ...KITS[0], added_at_pack_out: true }, KITS[1]] as any);
    render(<GigEquipmentTable gigId="gig-1" organizationId="org-1" showAmounts={false} />);
    expect(within((await screen.findByText('Main PA')).closest('tr')!).getByText('Added at pack-out')).toBeInTheDocument();
    expect(within(screen.getByText('Mic Case').closest('tr')!).queryByText('Added at pack-out')).not.toBeInTheDocument();
  });
});
