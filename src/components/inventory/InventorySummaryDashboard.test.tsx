import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/inventoryManagement.service', () => ({
  getActiveGigsWithTracking: vi.fn(),
  getInventoryConflictFlags: vi.fn(),
  createManualTrackingRecord: vi.fn(),
  getLocationSuggestions: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../ui/collapsible', () => ({
  Collapsible: ({ children, open, onOpenChange }: any) => (
    <div data-testid="collapsible" data-open={open} onClick={() => onOpenChange?.(!open)}>
      {children}
    </div>
  ),
  CollapsibleTrigger: ({ children, asChild }: any) => (
    <div data-testid="collapsible-trigger">{children}</div>
  ),
  CollapsibleContent: ({ children }: any) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
}));

vi.mock('../ui/progress', () => ({
  Progress: ({ value }: any) => (
    <div data-testid="progress-bar" data-value={value} role="progressbar" aria-valuenow={value} />
  ),
}));

vi.mock('../ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverAnchor: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

import {
  getActiveGigsWithTracking,
  getInventoryConflictFlags,
} from '../../services/inventoryManagement.service';
import { InventorySummaryDashboard } from './InventorySummaryDashboard';

const mockGig = {
  id: 'gig-1',
  title: 'Summer Festival',
  start: '2026-06-01T08:00:00Z',
  end: '2026-06-02T22:00:00Z',
  status: 'Booked',
  kit_assignments: [
    {
      kit_id: 'kit-1',
      kit: {
        id: 'kit-1',
        name: 'Sound Kit A',
        is_container: true,
        tag_number: 'TAG-001',
        assets: [],
      },
      tracking_records: [
        {
          id: 'tr-1',
          gig_id: 'gig-1',
          kit_id: 'kit-1',
          asset_id: null,
          status: 'On Site',
          location: 'Stage Left',
          scanned_at: '2026-06-01T10:00:00Z',
          scanned_by: 'user-1',
          notes: null,
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
    },
    {
      kit_id: 'kit-2',
      kit: {
        id: 'kit-2',
        name: 'Lighting Rig B',
        is_container: false,
        tag_number: null,
        assets: [
          { asset_id: 'asset-1', asset: { id: 'asset-1', name: 'Spotlight', manufacturer_model: null, tag_number: 'SP-01', status: 'Active' } },
          { asset_id: 'asset-2', asset: { id: 'asset-2', name: 'LED Bar', manufacturer_model: null, tag_number: 'LED-01', status: 'Active' } },
        ],
      },
      tracking_records: [
        {
          id: 'tr-2',
          gig_id: 'gig-1',
          kit_id: 'kit-2',
          asset_id: 'asset-1',
          status: 'In Transit',
          location: 'Truck 1',
          scanned_at: '2026-06-01T09:00:00Z',
          scanned_by: 'user-1',
          notes: null,
          created_at: '2026-06-01T09:00:00Z',
        },
      ],
    },
  ],
};

describe('InventorySummaryDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getActiveGigsWithTracking as any).mockResolvedValue([mockGig]);
    (getInventoryConflictFlags as any).mockResolvedValue(new Set<string>());
  });

  it('gives each gig a Track button that opens its scanning panel (#39)', async () => {
    const onTrack = vi.fn();
    render(<InventorySummaryDashboard organizationId="org-1" userId="user-1" userRole="Admin" onTrack={onTrack} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Track Summer Festival' }));
    expect(onTrack).toHaveBeenCalledWith(mockGig.id);
  });

  it('renders gig title after loading', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument();
    });
  });

  it('renders progress bar for gig', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  it('renders conflict badge when kit is double-booked', async () => {
    (getInventoryConflictFlags as any).mockResolvedValue(new Set(['kit-1']));

    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Kit Conflict').length).toBeGreaterThan(0);
    });
  });

  it('shows kit rows when gig row is expanded', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument();
    });

    expect(screen.getByText('Sound Kit A')).toBeInTheDocument();
    expect(screen.getByText('Lighting Rig B')).toBeInTheDocument();
  });

  it('shows Override button for Admin users', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Override').length).toBeGreaterThan(0);
    });
  });

  it('shows Override button for Manager users', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Manager"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Override').length).toBeGreaterThan(0);
    });
  });

  it('hides Override button for Staff users', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Staff"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument();
    });

    expect(screen.queryByText('Override')).not.toBeInTheDocument();
  });

  it('hides Override button for Viewer users', async () => {
    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Viewer"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Summer Festival')).toBeInTheDocument();
    });

    expect(screen.queryByText('Override')).not.toBeInTheDocument();
  });

  it('opens ManualTrackingOverrideDialog when Override is clicked', async () => {
    const user = userEvent.setup();

    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Override').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText('Override')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });
  });

  it('renders empty state when no active gigs', async () => {
    (getActiveGigsWithTracking as any).mockResolvedValue([]);

    render(
      <InventorySummaryDashboard
        organizationId="org-1"
        userId="user-1"
        userRole="Admin"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no active gigs/i)).toBeInTheDocument();
    });
  });
});
