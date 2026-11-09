/** Characterization tests (A10): OrganizationSelector's debounced search. */
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../test/renderWithQuery';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OrganizationSelector from './OrganizationSelector';
import { searchOrganizations } from '../services/organization.service';

vi.mock('../services/organization.service', () => ({ searchOrganizations: vi.fn() }));
vi.mock('./QuickCreateOrganizationDialog', () => ({ default: () => null }));

const org = (id: string, name: string) => ({ id, name, roles: ['Venue'], city: null, state: null }) as any;
const type = (value: string) => fireEvent.change(screen.getByPlaceholderText('Search for organization...'), { target: { value } });

beforeEach(() => vi.clearAllMocks());

describe('OrganizationSelector: search', () => {
  it('searches once typing settles, scoped to the role, and lists the results', async () => {
    vi.mocked(searchOrganizations).mockResolvedValue([org('o1', 'Acme Hall')]);
    render(<OrganizationSelector selectedOrganization={null} onSelect={vi.fn()} organizationRole="Venue" />);
    type('ac');
    type('acme');
    expect(await screen.findByText('Acme Hall', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(searchOrganizations).toHaveBeenCalledTimes(1);
    expect(searchOrganizations).toHaveBeenCalledWith({ search: 'acme', type: 'Venue' });
  });

  it('shows no results when the search fails', async () => {
    vi.mocked(searchOrganizations).mockRejectedValue(new Error('offline'));
    render(<OrganizationSelector selectedOrganization={null} onSelect={vi.fn()} />);
    type('acme');
    await waitFor(() => expect(searchOrganizations).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText('Acme Hall')).not.toBeInTheDocument());
  });

  it('a new search replaces the old results', async () => {
    vi.mocked(searchOrganizations).mockImplementation(async (f?: { search?: string }) =>
      f?.search === 'acme' ? [org('o1', 'Acme Hall')] : [org('o2', 'Bolt Arena')]);
    render(<OrganizationSelector selectedOrganization={null} onSelect={vi.fn()} />);
    type('acme');
    expect(await screen.findByText('Acme Hall', {}, { timeout: 3000 })).toBeInTheDocument();
    type('bolt');
    expect(await screen.findByText('Bolt Arena', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Acme Hall')).not.toBeInTheDocument();
  });

  it('picking a result selects it', async () => {
    vi.mocked(searchOrganizations).mockResolvedValue([org('o1', 'Acme Hall')]);
    const onSelect = vi.fn();
    render(<OrganizationSelector selectedOrganization={null} onSelect={onSelect} />);
    type('acme');
    fireEvent.click(await screen.findByText('Acme Hall', {}, { timeout: 3000 }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
  });
});
