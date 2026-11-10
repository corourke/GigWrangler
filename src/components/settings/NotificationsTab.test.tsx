import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen';
import { parseSettingsTab } from '../settingsTab';

// Push notifications: Settings → Notifications (/settings/notifications).
vi.mock('../AppHeader', () => ({ default: () => null }));
vi.mock('../CalendarIntegrationSettings', () => ({ default: () => null }));
vi.mock('./NotificationSettingsSection', () => ({ default: () => <div data-testid="notification-settings" /> }));

const noop = () => {};
const onTabChange = vi.fn();
const settings = (tab: any) => render(
  <SettingsScreen organization={{ id: 'org-1' } as any} user={{ id: 'u1' } as any} userRole="Staff"
    tab={tab} onTabChange={onTabChange}
    onBack={noop} onNavigateToDashboard={noop} onNavigateToGigs={noop} onNavigateToAssets={noop}
    onSwitchOrganization={noop} onLogout={noop} />,
);

describe('Settings → Notifications', () => {
  it('opens from /settings/notifications', () => {
    expect(parseSettingsTab('notifications')).toBe('notifications');
    expect(parseSettingsTab('security')).toBe('security');
    expect(parseSettingsTab('nonsense')).toBe('calendar');
    expect(parseSettingsTab(undefined)).toBe('calendar');
  });

  it('is a tab for everyone', async () => {
    settings('calendar');
    await userEvent.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(onTabChange).toHaveBeenCalledWith('notifications');
  });

  it('shows the notification settings', () => {
    settings('notifications');
    expect(screen.getByTestId('notification-settings')).toBeInTheDocument();
  });
});
