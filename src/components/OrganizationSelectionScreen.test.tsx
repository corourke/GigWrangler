import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrganizationSelectionScreen from './OrganizationSelectionScreen';

vi.mock('./AppHeader', () => ({ default: () => null }));

const searchOrganizations = vi.fn();
const joinOrganization = vi.fn();
vi.mock('../services/organization.service', () => ({
  searchOrganizations: (...args: unknown[]) => searchOrganizations(...args),
  joinOrganization: (...args: unknown[]) => joinOrganization(...args),
}));

const createAccessRequest = vi.fn();
const getMyPendingAccessRequests = vi.fn();
vi.mock('../services/accessRequest.service', () => ({
  createAccessRequest: (...args: unknown[]) => createAccessRequest(...args),
  getMyPendingAccessRequests: (...args: unknown[]) => getMyPendingAccessRequests(...args),
}));

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

const user = { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' } as any;
const openOrg = { id: 'org-1', name: 'Open Org', roles: ['Production'], allowed_domains: null } as any;
const domainOrg = { id: 'org-2', name: 'Domain Org', roles: ['Production'], allowed_domains: 'example.com' } as any;

function renderScreen() {
  return render(
    <OrganizationSelectionScreen
      user={user}
      organizations={[]}
      onSelectOrganization={vi.fn()}
      onCreateOrganization={vi.fn()}
      onLogout={vi.fn()}
      onEditProfile={vi.fn()}
    />
  );
}

async function search(orgs: any[]) {
  searchOrganizations.mockResolvedValue(orgs);
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'org' } });
  await screen.findByText(orgs[0].name);
}

beforeEach(() => {
  vi.clearAllMocks();
  getMyPendingAccessRequests.mockResolvedValue([]);
});

describe('OrganizationSelectionScreen: joining an organization', () => {
  it('asks to join instead of joining', async () => {
    createAccessRequest.mockResolvedValue({ id: 'r1' });
    renderScreen();
    await search([openOrg]);

    expect(screen.queryByText(/join as viewer/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /request to join/i }));

    await waitFor(() => expect(createAccessRequest).toHaveBeenCalledWith('org-1', 'Viewer'));
    expect(joinOrganization).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Open Org/));
    expect(await screen.findByRole('button', { name: /request pending/i })).toBeDisabled();
  });

  it('shows a request already made as pending', async () => {
    getMyPendingAccessRequests.mockResolvedValue([{ organization_id: 'org-1', requested_role: 'Viewer' }]);
    renderScreen();
    await search([openOrg]);

    expect(await screen.findByRole('button', { name: /request pending/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /request to join/i })).toBeNull();
  });

  it('still joins as Staff straight away on a matching email domain, or asks to join', async () => {
    joinOrganization.mockResolvedValue({ organization: domainOrg, role: 'Staff' });
    createAccessRequest.mockResolvedValue({ id: 'r2' });
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
    renderScreen();
    await search([domainOrg]);

    fireEvent.click(screen.getByRole('button', { name: /join as staff/i }));
    await waitFor(() => expect(joinOrganization).toHaveBeenCalledWith('org-2', 'Staff'));

    fireEvent.click(screen.getByRole('button', { name: /request to join/i }));
    await waitFor(() => expect(createAccessRequest).toHaveBeenCalledWith('org-2', 'Viewer'));
  });
});
