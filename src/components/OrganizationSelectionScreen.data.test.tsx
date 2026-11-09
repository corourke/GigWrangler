/** Characterization tests (A10): the organization search on Select Organization. */
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrganizationSelectionScreen from './OrganizationSelectionScreen';

vi.mock('./AppHeader', () => ({ default: () => null }));
const searchOrganizations = vi.fn();
vi.mock('../services/organization.service', () => ({
  searchOrganizations: (...a: unknown[]) => searchOrganizations(...a),
  joinOrganization: vi.fn(),
  signedInEmailConfirmed: vi.fn().mockResolvedValue(true),
}));
const getMyPendingAccessRequests = vi.fn();
vi.mock('../services/accessRequest.service', () => ({
  createAccessRequest: vi.fn(),
  getMyPendingAccessRequests: () => getMyPendingAccessRequests(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const org = (id: string, name: string) => ({ id, name, roles: ['Production'], allowed_domains: null });

function renderScreen() {
  return render(
    <OrganizationSelectionScreen
      user={{ id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' } as any}
      organizations={[]}
      onSelectOrganization={vi.fn()}
      onCreateOrganization={vi.fn()}
      onLogout={vi.fn()}
      onEditProfile={vi.fn()}
    />,
  );
}
const type = (value: string) => fireEvent.change(screen.getByPlaceholderText(/search all organizations/i), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  getMyPendingAccessRequests.mockResolvedValue([]);
});

describe('OrganizationSelectionScreen: search', () => {
  it('shows a spinner while searching, then the results', async () => {
    let resolve!: (v: unknown) => void;
    searchOrganizations.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = renderScreen();
    type('acme');
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeInTheDocument());
    resolve([org('o1', 'Acme Audio')]);
    expect(await screen.findByText('Acme Audio')).toBeInTheDocument();
    expect(screen.getByText('Search Results (1)')).toBeInTheDocument();
    expect(searchOrganizations).toHaveBeenCalledWith({ search: 'acme' });
  });

  it('shows the error when the search fails, and recovers on the next search', async () => {
    searchOrganizations.mockRejectedValueOnce(new Error('offline'));
    renderScreen();
    type('acme');
    expect(await screen.findByText(/failed to load organizations/i)).toBeInTheDocument();
    searchOrganizations.mockResolvedValue([org('o2', 'Bolt Lighting')]);
    type('bolt');
    expect(await screen.findByText('Bolt Lighting')).toBeInTheDocument();
    expect(screen.queryByText(/failed to load organizations/i)).not.toBeInTheDocument();
  });

  it('a new search replaces the old results', async () => {
    searchOrganizations.mockImplementation(async ({ search }: { search: string }) =>
      search === 'acme' ? [org('o1', 'Acme Audio')] : [org('o2', 'Bolt Lighting')]);
    renderScreen();
    type('acme');
    expect(await screen.findByText('Acme Audio')).toBeInTheDocument();
    type('bolt');
    expect(await screen.findByText('Bolt Lighting')).toBeInTheDocument();
    expect(screen.queryByText('Acme Audio')).not.toBeInTheDocument();
  });

  it('says nothing matched', async () => {
    searchOrganizations.mockResolvedValue([]);
    renderScreen();
    type('zzz');
    await waitFor(() => expect(searchOrganizations).toHaveBeenCalled());
    expect(await screen.findByText('No results found')).toBeInTheDocument();
  });

  it('clearing the search goes back to your organizations', async () => {
    searchOrganizations.mockResolvedValue([org('o1', 'Acme Audio')]);
    renderScreen();
    type('acme');
    expect(await screen.findByText('Acme Audio')).toBeInTheDocument();
    type('');
    await waitFor(() => expect(screen.queryByText('Acme Audio')).not.toBeInTheDocument());
  });
});
