import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react'

// #240 re-review: the "Whole kit" override of a logical kit moves the kit's own row and the
// units listed under it. Before, it passed neither, so it was refused as "only any lines".
vi.mock('../../services/inventoryManagement.service', () => ({
  getItemsByLocation: vi.fn(),
  getActiveGigsWithTracking: vi.fn().mockResolvedValue([]),
  getLocationSuggestions: vi.fn().mockResolvedValue([]),
  createManualTrackingRecord: vi.fn(),
}));
const dialog = vi.hoisted(() => ({ props: null as any }));
vi.mock('./ManualTrackingOverrideDialog', () => ({
  ManualTrackingOverrideDialog: (p: any) => { dialog.props = p; return <div>override open</div>; },
}));

import { getItemsByLocation } from '../../services/inventoryManagement.service';
import { LocationExplorer } from './LocationExplorer';



const at = { status: 'On Site', location: 'Stage Left', gig_id: 'gig-1', gig_title: 'Summer Festival', scanned_at: '2026-06-01T10:00:00Z', scanned_by_name: 'J' };

describe('LocationExplorer: whole-kit override', () => {
  it('passes the kit\'s units shown under it and keeps its kit row', async () => {
    (getItemsByLocation as any).mockResolvedValue([
      { kit_id: 'kit-1', kit_name: 'Sound Kit A', is_container: false, asset_id: null, asset_name: null, tag_number: null, ...at },
      { kit_id: 'kit-1', kit_name: 'Sound Kit A', is_container: false, asset_id: 'a1', asset_name: 'Main Speaker', tag_number: 'SP-1', ...at },
      { kit_id: 'kit-1', kit_name: 'Sound Kit A', is_container: false, asset_id: 'a2', asset_name: 'Sub', tag_number: 'SB-1', ...at },
    ]);
    render(<LocationExplorer organizationId="org-1" userId="u1" userRole="Admin" />);
    fireEvent.change(screen.getByPlaceholderText('Filter by location...'), { target: { value: 'Stage Left' } });
    await waitFor(() => expect(screen.getByText('Whole kit')).toBeInTheDocument(), { timeout: 3000 });

    const row = screen.getByText('Whole kit').closest('tr')!;
    fireEvent.click(row.querySelector('button')!);

    await screen.findByText('override open');
    expect(dialog.props).toMatchObject({ kitId: 'kit-1', assetIds: ['a1', 'a2'], keepKitRow: true });
    expect(dialog.props.assetId).toBeUndefined();
  });
});
