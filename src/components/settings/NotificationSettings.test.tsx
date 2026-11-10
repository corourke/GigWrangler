import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Push notifications, Settings → Notifications: this device, the switches (by role), the lock-screen
// setting and the other devices.
const svc = vi.hoisted(() => ({
  readDeviceFacts: vi.fn(),
  enablePushOnThisDevice: vi.fn(),
  disablePushOnThisDevice: vi.fn(),
  listMyDevices: vi.fn(),
  removeDevice: vi.fn(),
  getPreferences: vi.fn(),
  setPreference: vi.fn(),
  getHideDetails: vi.fn(),
  setHideDetails: vi.fn(),
}));
vi.mock('../../services/push.service', () => svc);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import NotificationSettings from './NotificationSettings';

const allOn = { assignment_invites: true, assignment_replies: true, gig_changes: true, join_requests: true, payments: true };
const facts = (over: Record<string, unknown> = {}) => ({
  configured: true, supported: true, ios: false, standalone: false, permission: 'default', subscribed: false, endpoint: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.readDeviceFacts.mockResolvedValue(facts());
  svc.listMyDevices.mockResolvedValue([]);
  svc.getPreferences.mockResolvedValue(allOn);
  svc.getHideDetails.mockResolvedValue(false);
  svc.setPreference.mockResolvedValue(undefined);
  svc.setHideDetails.mockResolvedValue(undefined);
  svc.removeDevice.mockResolvedValue(undefined);
});

function renderSettings(roles: string[] = ['Staff']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationSettings userId="u1" roles={roles as any} />
    </QueryClientProvider>,
  );
}

describe('this device', () => {
  it('offers to turn notifications on, and shows them on afterwards', async () => {
    svc.enablePushOnThisDevice.mockImplementation(async () => {
      svc.readDeviceFacts.mockResolvedValue(facts({ permission: 'granted', subscribed: true, endpoint: 'https://p/1' }));
    });
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on notifications on this device' }));
    expect(svc.enablePushOnThisDevice).toHaveBeenCalled();
    expect(await screen.findByText('Notifications are on for this device.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off on this device' })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Notifications are on for this device');
  });

  it('turns them off', async () => {
    svc.readDeviceFacts.mockResolvedValue(facts({ permission: 'granted', subscribed: true, endpoint: 'https://p/1' }));
    svc.disablePushOnThisDevice.mockResolvedValue(undefined);
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off on this device' }));
    expect(svc.disablePushOnThisDevice).toHaveBeenCalled();
  });

  it('says why turning on failed', async () => {
    svc.enablePushOnThisDevice.mockRejectedValue(new Error('Notifications are on for 10 devices already; remove one in Settings first'));
    renderSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on notifications on this device' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notifications are on for 10 devices already; remove one in Settings first'));
  });

  it('explains blocked notifications', async () => {
    svc.readDeviceFacts.mockResolvedValue(facts({ permission: 'denied' }));
    renderSettings();
    expect(await screen.findByText(/Notifications are blocked for GigWrangler in this browser's settings/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications on this device' })).not.toBeInTheDocument();
  });

  it('tells iPhone users to add the app to the Home Screen first', async () => {
    svc.readDeviceFacts.mockResolvedValue(facts({ ios: true, supported: false }));
    renderSettings();
    expect(await screen.findByText(/open GigWrangler from your Home Screen/)).toBeInTheDocument();
  });

  it('says when the browser cannot show notifications', async () => {
    svc.readDeviceFacts.mockResolvedValue(facts({ supported: false }));
    renderSettings();
    expect(await screen.findByText("This browser can't show notifications.")).toBeInTheDocument();
  });
});

describe('switches', () => {
  it('shows Staff only what can reach them', async () => {
    renderSettings(['Staff']);
    expect(await screen.findByRole('switch', { name: 'Gig requests' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Gig changes' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Staffing replies' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Access requests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Payments' })).not.toBeInTheDocument();
  });

  it('shows Managers replies and access requests, and Admins payments too', async () => {
    const { unmount } = renderSettings(['Staff', 'Manager']);
    expect(await screen.findByRole('switch', { name: 'Staffing replies' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Access requests' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Payments' })).not.toBeInTheDocument();
    unmount();
    renderSettings(['Admin']);
    expect(await screen.findByRole('switch', { name: 'Payments' })).toBeInTheDocument();
  });

  it('saves a switch', async () => {
    renderSettings(['Staff']);
    await userEvent.click(await screen.findByRole('switch', { name: 'Gig changes' }));
    expect(svc.setPreference).toHaveBeenCalledWith('u1', 'gig_changes', false);
  });

  it('saves the lock-screen setting', async () => {
    renderSettings(['Staff']);
    const hide = await screen.findByRole('switch', { name: 'Hide details on the lock screen' });
    expect(hide).not.toBeChecked();
    await userEvent.click(hide);
    expect(svc.setHideDetails).toHaveBeenCalledWith('u1', true);
  });
});

describe('devices', () => {
  it('lists the devices, marks this one, and removes another', async () => {
    svc.readDeviceFacts.mockResolvedValue(facts({ permission: 'granted', subscribed: true, endpoint: 'https://p/1' }));
    svc.listMyDevices.mockResolvedValue([
      { id: 'd1', endpoint: 'https://p/1', device_label: 'iPhone · Safari', created_at: '2026-11-01T00:00:00Z', last_success_at: null },
      { id: 'd2', endpoint: 'https://p/2', device_label: 'Mac · Chrome', created_at: '2026-11-02T00:00:00Z', last_success_at: null },
    ]);
    renderSettings();
    const list = await screen.findByRole('list', { name: 'Devices with notifications on' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('iPhone · Safari');
    expect(items[0]).toHaveTextContent('This device');
    expect(within(items[0]).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    await userEvent.click(within(items[1]).getByRole('button', { name: 'Remove Mac · Chrome' }));
    expect(svc.removeDevice).toHaveBeenCalledWith('d2');
  });
});
