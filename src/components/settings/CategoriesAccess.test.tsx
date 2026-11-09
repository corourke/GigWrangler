import { renderWithQuery as render } from '../../test/renderWithQuery';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen';
import ModeratorQueueMenuItem from '../ModeratorQueueMenuItem';

// setup.ts stubs the menu item for screen tests; this one tests it.
vi.unmock('../ModeratorQueueMenuItem');
vi.mock('../AppHeader', () => ({ default: () => null }));
vi.mock('../CalendarIntegrationSettings', () => ({ default: () => null }));
vi.mock('./CategoriesSettings', () => ({
  default: ({ organizationId, canEdit }: any) => <div data-testid="categories">{`${organizationId}:${canEdit}`}</div>,
}));
const auth = vi.hoisted(() => ({ user: { platform_moderator: false } as any }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../routes/useNav', () => ({ useNav: () => ({ toModeratorQueue: vi.fn(), toStarterCategories: vi.fn() }) }));
vi.mock('../ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: any) => <div role="menuitem">{children}</div>,
  DropdownMenuSeparator: () => null,
}));

const noop = () => {};
const onTabChange = vi.fn();
const settings = (userRole: any, tab: 'calendar' | 'categories' = 'categories') => render(
  <SettingsScreen organization={{ id: 'org-1' } as any} user={{ id: 'u1' } as any} userRole={userRole}
    tab={tab} onTabChange={onTabChange}
    onBack={noop} onNavigateToDashboard={noop} onNavigateToGigs={noop} onNavigateToAssets={noop}
    onSwitchOrganization={noop} onLogout={noop} />,
);

describe('Who edits the category lists', () => {
  it('an Admin edits the organization\'s lists in Settings', () => {
    settings('Admin');
    expect(screen.getByTestId('categories')).toHaveTextContent('org-1:true');
  });
  it('a Manager sees them read-only', () => {
    settings('Manager');
    expect(screen.getByTestId('categories')).toHaveTextContent('org-1:false');
  });
  it('Staff don\'t see them, not even as a tab', () => {
    settings('Staff');
    expect(screen.queryByTestId('categories')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Categories/ })).not.toBeInTheDocument();
  });
  it('Google Calendar and Categories are separate tabs, each with its own address', async () => {
    settings('Admin', 'calendar');
    expect(screen.getByRole('tab', { name: /Google Calendar/ })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByTestId('categories')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Categories/ }));
    expect(onTabChange).toHaveBeenCalledWith('categories');
  });
  it('only platform moderators get the Starter categories menu entry', () => {
    const { unmount } = render(<ModeratorQueueMenuItem />);
    expect(screen.queryByText('Starter categories')).not.toBeInTheDocument();
    unmount();
    auth.user = { platform_moderator: true };
    render(<ModeratorQueueMenuItem />);
    expect(screen.getByText('Starter categories')).toBeInTheDocument();
  });
});
