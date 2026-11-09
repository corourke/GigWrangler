import type { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CalendarIntegrationSettings from './CalendarIntegrationSettings';

vi.mock('../services/googleCalendar.service', () => ({
  getUserGoogleCalendarSettings: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  getUserCalendars: vi.fn(),
  getGoogleAuthUrl: vi.fn(),
  getSyncLogs: vi.fn(),
  getSyncStatusSummary: vi.fn(),
  updateUserGoogleCalendarSettings: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('date-fns', () => ({
  formatDistanceToNow: vi.fn(() => '5 minutes ago'),
}));

import * as calService from '../services/googleCalendar.service';

const mockSettings = {
  id: 'settings-1',
  user_id: 'user-1',
  calendar_id: 'cal-1',
  calendar_name: 'My Calendar',
  token_expires_at: '2026-12-31T00:00:00Z',
  is_enabled: true,
  sync_filters: { frequency: 'realtime', sync_confirmed: true, sync_tentative: true },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockCalendars = [
  { id: 'cal-1', name: 'My Calendar', primary: true, accessRole: 'owner' },
  { id: 'cal-2', name: 'Work Calendar', primary: false, accessRole: 'owner' },
];

const mockSyncLogs = [
  {
    id: 'log-1',
    gig_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    user_id: 'user-1',
    google_event_id: 'event-1',
    last_synced_at: '2026-02-14T10:00:00Z',
    sync_status: 'synced' as const,
    sync_error: undefined,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2026-02-14T10:00:00Z',
  },
  {
    id: 'log-2',
    gig_id: 'ffffffff-1111-2222-3333-444444444444',
    user_id: 'user-1',
    google_event_id: undefined,
    last_synced_at: '2026-02-14T09:00:00Z',
    sync_status: 'failed' as const,
    sync_error: 'API rate limit exceeded',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2026-02-14T09:00:00Z',
  },
];

const mockSyncSummary = {
  total: 10,
  synced: 8,
  pending: 1,
  failed: 1,
  lastSyncedAt: '2026-02-14T10:00:00Z',
};


// Screens read through react-query (A10), so each render gets its own QueryClient.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('CalendarIntegrationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(<CalendarIntegrationSettings userId="user-1" />);
    expect(screen.getByText('Loading calendar settings...')).toBeInTheDocument();
  });

  it('renders connect button when not connected', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading calendar settings...')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /connect google calendar/i })).toBeInTheDocument();
    expect(screen.getByText(/connect your google calendar to enable/i)).toBeInTheDocument();
  });

  it('renders connected state with calendar info', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading calendar settings...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
    expect(screen.getAllByText('My Calendar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('renders sync settings when connected', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sync Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Sync Frequency')).toBeInTheDocument();
    expect(screen.getByText('Sync Filters')).toBeInTheDocument();
    expect(screen.getByText('Confirmed gigs')).toBeInTheDocument();
    expect(screen.getByText('Tentative gigs')).toBeInTheDocument();
    expect(screen.getByText('Cancelled gigs')).toBeInTheDocument();
  });

  it('renders sync status summary when connected', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sync Status')).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Total Events')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders sync logs when connected', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sync Log')).toBeInTheDocument();
    });

    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText(/ffffffff/)).toBeInTheDocument();
    expect(screen.getByText('API rate limit exceeded')).toBeInTheDocument();
  });

  it('renders failed sync alert when there are failures', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText(/1 event failed to sync/)).toBeInTheDocument();
    });
  });

  it('calls disconnect and clears state', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 0, synced: 0, pending: 0, failed: 0, lastSyncedAt: null });
    (calService.disconnectGoogleCalendar as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const onSettingsChanged = vi.fn();
    render(<CalendarIntegrationSettings userId="user-1" onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));

    await waitFor(() => {
      expect(calService.disconnectGoogleCalendar).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onSettingsChanged).toHaveBeenCalled();
    });
  });

  it('renders no sync data message when summary is empty', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByText('No sync data available yet')).toBeInTheDocument();
    });

    expect(screen.getByText('No sync activity yet')).toBeInTheDocument();
  });

  it('warns when the selected calendar is read-only and disables Sync All Gigs (issue #9)', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'cal-1', name: 'My Calendar', primary: true, accessRole: 'reader' },
    ]);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" organizationId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText(/you only have read access to/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /^sync all gigs$/i })).toBeDisabled();
  });

  it('does not warn when the selected calendar is writable', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    render(<CalendarIntegrationSettings userId="user-1" organizationId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
    });

    expect(screen.queryByText(/you only have read access to/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sync all gigs$/i })).not.toBeDisabled();
  });

  it('does not render sync sections when disconnected', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<CalendarIntegrationSettings userId="user-1" />);

    await waitFor(() => {
      expect(screen.queryByText('Loading calendar settings...')).not.toBeInTheDocument();
    });

    expect(screen.queryByText('Sync Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync Log')).not.toBeInTheDocument();
  });

  it('shows the system-wide repair tool only to platform moderators (issue #188)', async () => {
    (calService.getUserGoogleCalendarSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (calService.getUserCalendars as ReturnType<typeof vi.fn>).mockResolvedValue(mockCalendars);
    (calService.getSyncLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncLogs);
    (calService.getSyncStatusSummary as ReturnType<typeof vi.fn>).mockResolvedValue(mockSyncSummary);

    const { unmount } = render(<CalendarIntegrationSettings userId="user-1" organizationId="org-1" />);
    await waitFor(() => {
      expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
    });
    expect(screen.queryByText(/System-Wide Bulk Re-sync/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bulk re-sync/i })).not.toBeInTheDocument();
    unmount();

    render(<CalendarIntegrationSettings userId="user-1" organizationId="org-1" isPlatformModerator />);
    await waitFor(() => {
      expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
    });
    expect(screen.getByText(/System-Wide Bulk Re-sync/i)).toBeInTheDocument();
  });
});
