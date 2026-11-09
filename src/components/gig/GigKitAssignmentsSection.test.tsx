import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GigKitAssignmentsSection from './GigKitAssignmentsSection';
import { renderWithQuery } from '../../test/renderWithQuery';
import { getGigKits, updateGigKitAssignments } from '../../services/gig.service';
import { getKitsFlattenedSummary } from '../../services/kit.service';
import { checkEquipmentConflicts } from '../../services/conflictDetection.service';

vi.mock('../../services/gig.service', () => ({
  getGigKits: vi.fn().mockResolvedValue([
    {
      id: 'assignment-1',
      kit_id: 'kit-1',
      kit: {
        id: 'kit-1',
        name: 'Test Kit',
        tag_number: 'TK-001',
        category: 'Sound',
        rental_value: '500',
        organization_id: 'current-org-id',
      },
      notes: '',
      assigned_at: '2024-01-15T10:00:00',
    },
  ]),
  updateGigKitAssignments: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/kit.service', () => ({
  getKits: vi.fn().mockResolvedValue([
    {
      id: 'kit-1',
      name: 'Test Kit',
      tag_number: 'TK-001',
      category: 'Sound',
      rental_value: '500',
      organization_id: 'current-org-id',
    },
    {
      id: 'kit-2',
      name: 'Another Kit',
      tag_number: 'TK-002',
      category: 'Lighting',
      rental_value: '300',
      organization_id: 'current-org-id',
    },
  ]),
  getKitsFlattenedSummary: vi.fn().mockResolvedValue(new Map()),
}));

// Radix Select doesn't open in jsdom; a native <select> lets tests assign a kit.
vi.mock('../ui/select', () => ({
  Select: ({ onValueChange, disabled, children }: any) => (
    <select aria-label="Assign kit" value="" disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

vi.mock('./EquipmentNeededTable', () => ({ default: () => <div data-testid="equipment-needed" /> }));

vi.mock('../../services/conflictDetection.service', () => ({
  checkEquipmentConflicts: vi.fn().mockResolvedValue({ conflicts: [], warnings: [] }),
}));

vi.mock('../../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'test-user' } } },
        error: null,
      }),
    },
  })),
}));

describe('GigKitAssignmentsSection', () => {
  const mockProps = {
    gigId: 'test-gig-id',
    currentOrganizationId: 'current-org-id',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigKits).mockResolvedValue([
      {
        id: 'assignment-1',
        kit_id: 'kit-1',
        kit: {
          id: 'kit-1',
          name: 'Test Kit',
          tag_number: 'TK-001',
          category: 'Sound',
          rental_value: '500',
          organization_id: 'current-org-id',
        },
        notes: '',
        assigned_at: '2024-01-15T10:00:00',
      },
    ] as any);
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map());
    vi.mocked(checkEquipmentConflicts).mockResolvedValue({ conflicts: [], warnings: [] });
  });

  it('renders without throwing errors', () => {
    expect(() => {
      render(<GigKitAssignmentsSection {...mockProps} />);
    }).not.toThrow();
  });

  it('displays loading state initially', () => {
    render(<GigKitAssignmentsSection {...mockProps} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders kit selector', async () => {
    render(<GigKitAssignmentsSection {...mockProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('Select kit to assign...')).toBeInTheDocument();
    });
  });

  it('does not render manual save button', async () => {
    render(<GigKitAssignmentsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });
  });

  // Regression: previously there was no indication anywhere in the gig
  // editor that two assigned kits share the same physical equipment.
  it('flags two assigned kits that share a physical asset', async () => {
    vi.mocked(getGigKits).mockResolvedValue([
      {
        id: 'assignment-1', kit_id: 'kit-1', notes: '', assigned_at: '2024-01-15T10:00:00',
        kit: { id: 'kit-1', name: 'Mic Case', tag_number: 'TK-001', category: 'Sound', rental_value: '500', organization_id: 'current-org-id' },
      },
      {
        id: 'assignment-2', kit_id: 'kit-2', notes: '', assigned_at: '2024-01-15T10:00:00',
        kit: { id: 'kit-2', name: 'Vocal Rig', tag_number: 'TK-002', category: 'Sound', rental_value: '300', organization_id: 'current-org-id' },
      },
    ] as any);
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map([
      ['kit-1', { totalValue: 0, totalItems: 2, assetIds: new Set(['asset-sm58', 'asset-stand']),
        assetLabels: new Map([['asset-sm58', 'Shure SM58 (#M-12)'], ['asset-stand', 'Mic stand']]) }],
      ['kit-2', { totalValue: 0, totalItems: 1, assetIds: new Set(['asset-sm58']),
        assetLabels: new Map([['asset-sm58', 'Shure SM58 (#M-12)']]) }],
    ]));

    render(<GigKitAssignmentsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Overlapping equipment')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Mic Case').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vocal Rig').length).toBeGreaterThan(0);
    // Says WHAT overlaps, not just that something does.
    const pair = screen.getByTestId('overlap-kit-1-kit-2');
    expect(pair).toHaveTextContent('Mic Case and Vocal Rig both contain Shure SM58 (#M-12)');
    expect(pair).not.toHaveTextContent('Mic stand');
  });

  it('does not flag kits with no shared assets', async () => {
    vi.mocked(getGigKits).mockResolvedValue([
      {
        id: 'assignment-1', kit_id: 'kit-1', notes: '', assigned_at: '2024-01-15T10:00:00',
        kit: { id: 'kit-1', name: 'Mic Case', tag_number: 'TK-001', category: 'Sound', rental_value: '500', organization_id: 'current-org-id' },
      },
      {
        id: 'assignment-2', kit_id: 'kit-2', notes: '', assigned_at: '2024-01-15T10:00:00',
        kit: { id: 'kit-2', name: 'Lighting Rig', tag_number: 'TK-002', category: 'Lighting', rental_value: '300', organization_id: 'current-org-id' },
      },
    ] as any);
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map([
      ['kit-1', { totalValue: 0, totalItems: 1, assetIds: new Set(['asset-sm58']), assetLabels: new Map() }],
      ['kit-2', { totalValue: 0, totalItems: 1, assetIds: new Set(['asset-par-can']), assetLabels: new Map() }],
    ]));

    render(<GigKitAssignmentsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Mic Case')).toBeInTheDocument();
    });
    expect(screen.queryByText('Overlapping equipment')).not.toBeInTheDocument();
  });

  // Regression: cross-gig equipment conflicts were only ever surfaced on a
  // separate read-only gig detail screen, checked once on mount — never in
  // the editor where kits are actually assigned.
  it('shows a cross-gig equipment conflict once gig dates are known', async () => {
    vi.mocked(checkEquipmentConflicts).mockResolvedValue({
      conflicts: [{
        level: 'conflict',
        type: 'equipment',
        gig_id: 'other-gig',
        gig_title: 'Other Show',
        start: '2024-02-01T00:00:00Z',
        end: '2024-02-01T04:00:00Z',
        details: { conflicting_kits: [{ kit_id: 'kit-9', kit_name: 'Their Kit', shared_assets: ['Shure SM58 (#M-12)'] }] },
      }],
      warnings: [],
    });

    render(<GigKitAssignmentsSection {...mockProps} gigStart="2024-02-01T00:00:00Z" gigEnd="2024-02-01T04:00:00Z" />);

    await waitFor(() => {
      expect(checkEquipmentConflicts).toHaveBeenCalledWith('test-gig-id', '2024-02-01T00:00:00Z', '2024-02-01T04:00:00Z', undefined, 'current-org-id', undefined, undefined);
    });
    await waitFor(() => {
      expect(screen.getByText(/Other Show/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Their Kit \(Shure SM58 \(#M-12\)\)/)).toBeInTheDocument();
  });

  it('does not check for cross-gig conflicts when gig dates are not yet known', async () => {
    render(<GigKitAssignmentsSection {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByText('Select kit to assign...')).toBeInTheDocument();
    });
    expect(checkEquipmentConflicts).not.toHaveBeenCalled();
  });
});

describe('GigKitAssignmentsSection deletes only rows it loaded (#92)', () => {
  const mockProps = { gigId: 'test-gig-id', currentOrganizationId: 'current-org-id' };
  const kit = (id: string, name: string) => ({ id, name, tag_number: null, category: 'Sound', rental_value: '1', organization_id: 'current-org-id' });
  const calls = () => vi.mocked(updateGigKitAssignments).mock.calls;
  const removeButtons = (container: HTMLElement) => [...container.querySelectorAll('tbody button.text-red-600')] as HTMLElement[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigKits).mockResolvedValue([
      { id: 'assignment-1', kit_id: 'kit-1', notes: '', kit: kit('kit-1', 'Test Kit') },
      { id: 'assignment-2', kit_id: 'kit-2', notes: '', kit: kit('kit-2', 'Another Kit') },
    ] as any);
    vi.mocked(updateGigKitAssignments).mockImplementation(async (_gigId, _orgId, assignments) => ({
      success: true,
      ids: assignments.map((a) => a.id ?? 'assignment-new'),
    }));
  });

  it('passes the rows it loaded, so a removed one is deleted and rows added elsewhere are not', async () => {
    const { container } = render(<GigKitAssignmentsSection {...mockProps} />);
    await waitFor(() => expect(screen.getByText('Another Kit')).toBeInTheDocument());

    fireEvent.click(removeButtons(container)[0]);

    await waitFor(() => expect(updateGigKitAssignments).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(calls()[0][2].map((a) => a.id)).toEqual(['assignment-2']);
    expect(calls()[0][3]).toEqual(['assignment-1', 'assignment-2']);
  });

  it('gives a new row the id its save returned, and deletes it if it is then removed', async () => {
    vi.mocked(getGigKits).mockResolvedValue([
      { id: 'assignment-1', kit_id: 'kit-1', notes: '', kit: kit('kit-1', 'Test Kit') },
    ] as any);
    const { container } = render(<GigKitAssignmentsSection {...mockProps} />);
    await waitFor(() => expect(screen.getByText('Test Kit')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Assign kit'), { target: { value: 'kit-2' } });
    await waitFor(() => expect(updateGigKitAssignments).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(calls()[0][2].find((a) => a.kit_id === 'kit-2')?.id).toBeUndefined();

    await waitFor(() => expect(removeButtons(container)).toHaveLength(2));
    await waitFor(() => expect(removeButtons(container)[1]).not.toBeDisabled());
    fireEvent.click(removeButtons(container)[1]);

    await waitFor(() => expect(calls().at(-1)![2].map((a) => a.kit_id)).toEqual(['kit-1']), { timeout: 3000 });
    expect(calls().at(-1)![3]).toEqual(['assignment-1', 'assignment-new']);
    // No save after the first inserted kit-2 again.
    expect(calls().slice(1).some((c) => c[2].some((a) => a.kit_id === 'kit-2' && !a.id))).toBe(false);
  });
});

// A10: how the kit section loads, fails, follows the gig and drops a late answer. These hold
// before and after the move to react-query.
describe('GigKitAssignmentsSection: data loading (A10)', () => {
  const props = { gigId: 'test-gig-id', currentOrganizationId: 'current-org-id' };
  const assignment = (gigId: string, name: string) => ({
    id: `as-${gigId}`, kit_id: `kit-${gigId}`, notes: '', assigned_at: '2024-01-15T10:00:00',
    kit: { id: `kit-${gigId}`, name, tag_number: 'T', category: 'Sound', rental_value: '0', organization_id: 'current-org-id' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigKits).mockImplementation(async (id: string) => [assignment(id, id === 'gig-2' ? 'Second Kit' : 'Test Kit')] as any);
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map());
    vi.mocked(checkEquipmentConflicts).mockResolvedValue({ conflicts: [], warnings: [] });
  });

  it('says the kits failed to load', async () => {
    const { toast } = await import('sonner');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const errorSpy = vi.spyOn(toast, 'error');
    vi.mocked(getGigKits).mockRejectedValueOnce(new Error('down'));
    renderWithQuery(<GigKitAssignmentsSection {...props} />);
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to load kits'));
  });

  it("loads the other gig's kits when the gig changes", async () => {
    const { rerender } = renderWithQuery(<GigKitAssignmentsSection {...props} />);
    expect(await screen.findByText('Test Kit')).toBeInTheDocument();
    rerender(<GigKitAssignmentsSection {...props} gigId="gig-2" />);
    expect(await screen.findByText('Second Kit')).toBeInTheDocument();
    expect(getGigKits).toHaveBeenCalledWith('gig-2');
  });

  it('keeps the kits of the gig it is on when an earlier answer comes late (B12)', async () => {
    let resolveFirst!: (v: unknown) => void;
    vi.mocked(getGigKits).mockImplementation((id: string) =>
      id === 'test-gig-id' ? new Promise((r) => { resolveFirst = r; }) as any : Promise.resolve([assignment(id, 'Second Kit')] as any));
    const { rerender } = renderWithQuery(<GigKitAssignmentsSection {...props} />);
    rerender(<GigKitAssignmentsSection {...props} gigId="gig-2" />);
    expect(await screen.findByText('Second Kit')).toBeInTheDocument();
    resolveFirst([assignment('test-gig-id', 'Test Kit')]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Test Kit')).not.toBeInTheDocument();
  });
});
