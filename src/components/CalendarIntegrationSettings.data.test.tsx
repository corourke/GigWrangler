/** Characterization tests (A10): calendar settings loads, failures, switching user, and refresh after writes. */
import type { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CalendarIntegrationSettings from './CalendarIntegrationSettings';
import * as cal from '../services/googleCalendar.service';

vi.mock('../services/googleCalendar.service', () => ({
  getUserGoogleCalendarSettings: vi.fn(),
  disconnectGoogleCalendar: vi.fn(),
  getUserCalendars: vi.fn(),
  getGoogleAuthUrl: vi.fn(),
  getSyncLogs: vi.fn(),
  getSyncStatusSummary: vi.fn(),
  updateUserGoogleCalendarSettings: vi.fn(),
  syncAllGigsForUser: vi.fn(),
  bulkSyncAllGigsServerSide: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const m = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...utils, rerender: (next: ReactElement) => utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) };
}

const settings = (over: Record<string, unknown> = {}) => ({
  id: 's1', user_id: 'user-1', calendar_id: 'cal-1', calendar_name: 'Main Calendar',
  token_expires_at: '2099-01-01T00:00:00Z', is_enabled: true,
  sync_filters: { frequency: 'realtime' }, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  ...over,
});
const calendars = [{ id: 'cal-1', name: 'Main Calendar', primary: true, accessRole: 'owner' }];
const summary = (total: number) => ({ total, synced: total, notSynced: 0, failed: 0, removed: 0, lastSyncedAt: null });

const totalEvents = () => screen.getByText('Total Events').previousElementSibling?.textContent;
const syncStatusCard = () => screen.getByText('Sync Status').closest('.flex.items-center.justify-between') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  m(cal.getUserCalendars).mockResolvedValue(calendars);
  m(cal.getSyncLogs).mockResolvedValue([]);
  m(cal.getSyncStatusSummary).mockResolvedValue(summary(4));
});

describe('CalendarIntegrationSettings: loading', () => {
  it('loads settings, then calendars and sync data, before showing anything', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    render(<CalendarIntegrationSettings userId="user-1" />);
    expect(screen.getByText('Loading calendar settings...')).toBeInTheDocument();
    expect(await screen.findByText('Connected to Google Calendar')).toBeInTheDocument();
    expect(totalEvents()).toBe('4');
    expect(cal.getUserCalendars).toHaveBeenCalledWith('user-1');
    expect(cal.getSyncLogs).toHaveBeenCalledWith('user-1', 10);
  });

  it('does not ask Google for calendars when sync is off and the token has expired', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings({ is_enabled: false, token_expires_at: '2000-01-01T00:00:00Z' }));
    render(<CalendarIntegrationSettings userId="user-1" />);
    expect(await screen.findByText('Connected to Google Calendar')).toBeInTheDocument();
    expect(cal.getUserCalendars).not.toHaveBeenCalled();
    expect(cal.getSyncLogs).not.toHaveBeenCalled();
  });

  it('asks to reconnect when the Google connection has expired', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.getUserCalendars).mockRejectedValue(new Error('Token has been expired or revoked.'));
    const { toast } = await import('sonner');
    render(<CalendarIntegrationSettings userId="user-1" />);
    expect(await screen.findByRole('button', { name: /reconnect now/i })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says the settings failed to load on any other error', async () => {
    m(cal.getUserGoogleCalendarSettings).mockRejectedValue(new Error('Server unavailable'));
    const { toast } = await import('sonner');
    render(<CalendarIntegrationSettings userId="user-1" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load calendar settings'));
    expect(screen.getByRole('button', { name: /connect google calendar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reconnect now/i })).not.toBeInTheDocument();
  });

  it('says calendars failed to load when only that call fails', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.getUserCalendars).mockRejectedValue(new Error('Server unavailable'));
    const { toast } = await import('sonner');
    render(<CalendarIntegrationSettings userId="user-1" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load available calendars'));
    expect(screen.getByText('Connected to Google Calendar')).toBeInTheDocument();
  });

  it('switching user loads that user’s settings', async () => {
    m(cal.getUserGoogleCalendarSettings).mockImplementation(async (id: string) =>
      id === 'user-1' ? settings() : null);
    const { rerender } = render(<CalendarIntegrationSettings userId="user-1" />);
    expect(await screen.findByText('Connected to Google Calendar')).toBeInTheDocument();
    rerender(<CalendarIntegrationSettings userId="user-2" />);
    expect(await screen.findByRole('button', { name: /connect google calendar/i })).toBeInTheDocument();
    expect(cal.getUserGoogleCalendarSettings).toHaveBeenCalledWith('user-2');
  });
});

describe('CalendarIntegrationSettings: fresh data after writes', () => {
  it('turning sync on saves it, then loads calendars and sync data', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings({ is_enabled: false, token_expires_at: '2000-01-01T00:00:00Z' }));
    m(cal.updateUserGoogleCalendarSettings).mockResolvedValue(settings({ is_enabled: true, token_expires_at: '2000-01-01T00:00:00Z' }));
    const onSettingsChanged = vi.fn();
    render(<CalendarIntegrationSettings userId="user-1" onSettingsChanged={onSettingsChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disabled' }));
    await waitFor(() => expect(cal.updateUserGoogleCalendarSettings).toHaveBeenCalledWith('user-1', { is_enabled: true }));
    expect(await screen.findByRole('button', { name: 'Enabled' })).toBeInTheDocument();
    await waitFor(() => expect(totalEvents()).toBe('4'));
    expect(cal.getUserCalendars).toHaveBeenCalledWith('user-1');
    expect(onSettingsChanged).toHaveBeenCalled();
  });

  it('turning sync off hides the sync sections', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.updateUserGoogleCalendarSettings).mockResolvedValue(settings({ is_enabled: false }));
    render(<CalendarIntegrationSettings userId="user-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enabled' }));
    expect(await screen.findByRole('button', { name: 'Disabled' })).toBeInTheDocument();
    expect(screen.queryByText('Sync Status')).not.toBeInTheDocument();
  });

  it('a changed filter shows the saved settings', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.updateUserGoogleCalendarSettings).mockResolvedValue(settings({ sync_filters: { frequency: 'realtime', sync_confirmed: false } }));
    render(<CalendarIntegrationSettings userId="user-1" />);
    await screen.findByText('Connected to Google Calendar');
    const row = screen.getByText('Confirmed gigs').closest('.flex.items-center.justify-between') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'On' }));
    await waitFor(() => expect(cal.updateUserGoogleCalendarSettings).toHaveBeenCalledWith('user-1', {
      sync_filters: { frequency: 'realtime', sync_confirmed: false },
    }));
    expect(await within(row).findByRole('button', { name: 'Off' })).toBeInTheDocument();
  });

  it('the refresh button reloads the sync status', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    render(<CalendarIntegrationSettings userId="user-1" />);
    await screen.findByText('Connected to Google Calendar');
    expect(totalEvents()).toBe('4');
    m(cal.getSyncStatusSummary).mockResolvedValue(summary(7));
    fireEvent.click(within(syncStatusCard()).getByRole('button'));
    await waitFor(() => expect(totalEvents()).toBe('7'));
  });

  it('Sync All Gigs reloads the sync status afterwards', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.syncAllGigsForUser).mockResolvedValue({ synced: 3, failed: 0 });
    render(<CalendarIntegrationSettings userId="user-1" organizationId="org-1" />);
    await screen.findByText('Connected to Google Calendar');
    m(cal.getSyncStatusSummary).mockResolvedValue(summary(9));
    fireEvent.click(screen.getByRole('button', { name: /sync all gigs/i }));
    await waitFor(() => expect(cal.syncAllGigsForUser).toHaveBeenCalledWith('user-1', 'org-1', expect.any(Function)));
    await waitFor(() => expect(totalEvents()).toBe('9'));
  });

  it('disconnecting returns to the connect state', async () => {
    m(cal.getUserGoogleCalendarSettings).mockResolvedValue(settings());
    m(cal.disconnectGoogleCalendar).mockResolvedValue(undefined);
    render(<CalendarIntegrationSettings userId="user-1" />);
    await screen.findByText('Connected to Google Calendar');
    fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));
    expect(await screen.findByRole('button', { name: /connect google calendar/i })).toBeInTheDocument();
    expect(screen.queryByText('Sync Status')).not.toBeInTheDocument();
  });
});
