import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import OrganizationScreen from './OrganizationScreen';
import { getBackInHeaderSlot } from '../test/pageFrame';

const invoke = vi.fn();
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } } }),
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
    rpc: vi.fn().mockResolvedValue({ data: null }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  })),
}));

const mockProps = {
  onOrganizationCreated: vi.fn(),
  onCancel: vi.fn(),
  userId: 'user-1',
};


// Screens read through react-query (A10), so each render gets its own QueryClient.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('OrganizationScreen — page header (#39)', () => {
  it('puts Back to Select Organization in the header slot when creating', async () => {
    const onCancel = vi.fn();
    render(<OrganizationScreen {...mockProps} onCancel={onCancel} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create New Organization' })).toBeInTheDocument();
    await userEvent.click(getBackInHeaderSlot('Back to Select Organization'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('OrganizationScreen — business search failure', () => {
  // Issue #29: a failed Google Places search used to surface the raw
  // "Google Places API error: 400" string to the user via a toast, and fell
  // into the same UI branch as "no results found". It must now render a
  // distinct, friendly error state with the manual-entry fallback front and
  // center.
  it('shows a friendly message and manual-entry fallback instead of the raw API error', async () => {
    invoke.mockRejectedValue(new Error('Google Places API error: 400'));
    const user = userEvent.setup();
    render(<OrganizationScreen {...mockProps} />);

    await user.type(screen.getByPlaceholderText('Search for your business name...'), 'Acme Co');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText("Couldn't reach business search")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Fill in manually instead' })).toBeInTheDocument();

    expect(screen.queryByText(/Google Places API error/)).not.toBeInTheDocument();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });
});

// #111 moved the search into useGooglePlacesSearch; the screen must behave as before.
describe('OrganizationScreen — picking a Google Places result', () => {
  it('fills the form from the picked place', async () => {
    invoke.mockImplementation(async (path: string) =>
      path.startsWith('server/integrations/google-places/search')
        ? { data: { results: [{ place_id: 'p1', name: 'Acme Hall' }] }, error: null }
        : {
            data: {
              place_id: 'p1',
              name: 'Acme Hall',
              formatted_address: '5 Main St, Springfield, IL 62701, USA',
              formatted_phone_number: '(217) 555-0101',
              website: 'https://acme.example',
              address_components: [
                { long_name: '5', short_name: '5', types: ['street_number'] },
                { long_name: 'Main St', short_name: 'Main St', types: ['route'] },
                { long_name: 'Springfield', short_name: 'Springfield', types: ['locality'] },
                { long_name: 'Illinois', short_name: 'IL', types: ['administrative_area_level_1'] },
              ],
            },
            error: null,
          });
    const user = userEvent.setup();
    render(<OrganizationScreen {...mockProps} />);

    await user.type(screen.getByPlaceholderText('Search for your business name...'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: /Acme Hall/ }));

    expect(screen.getByText('Auto-filled from Google Places')).toBeInTheDocument();
    expect(document.getElementById('name')).toHaveValue('Acme Hall');
    expect(document.getElementById('phone')).toHaveValue('(217) 555-0101');
    expect(document.getElementById('url')).toHaveValue('https://acme.example');
    expect(document.getElementById('city')).toHaveValue('Springfield');
  });
});
