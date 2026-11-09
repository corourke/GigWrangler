import type { ReactElement } from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import OrganizationSelector from './OrganizationSelector';
import { searchOrganizations } from '../services/organization.service';
import { makeOrganization } from '../test/factories';

vi.mock('../services/organization.service', () => ({ searchOrganizations: vi.fn() }));
vi.mock('./QuickCreateOrganizationDialog', () => ({ default: () => null }));

const org = makeOrganization({
  id: 'org-1',
  name: 'Pro Stage Rentals of Northern California',
  roles: ['Staging'],
  city: 'Chicago',
  state: 'IL',
} as any);


// Screens read through react-query (A10), so each render gets its own QueryClient.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('OrganizationSelector', () => {
  beforeEach(() => {
    vi.mocked(searchOrganizations).mockResolvedValue([org] as any);
  });

  // In a narrow column (the money-out dialog) the role badge squeezed the
  // name down to "P…". The name must wrap rather than truncate.
  it('lets a long organization name wrap in the search results', async () => {
    render(<OrganizationSelector selectedOrganization={null} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search for organization...'), { target: { value: 'stage' } });
    const name = await screen.findByText(org.name, {}, { timeout: 3000 });
    expect(name).not.toHaveClass('truncate');
    expect(name).toHaveClass('break-words');
  });

  it('lets a long organization name wrap once selected', () => {
    render(<OrganizationSelector selectedOrganization={org} onSelect={vi.fn()} />);
    const name = screen.getByText(org.name);
    expect(name).not.toHaveClass('truncate');
    expect(name).toHaveClass('break-words');
  });
});
