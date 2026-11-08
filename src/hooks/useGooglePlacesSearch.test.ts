import { describe, it, expect } from 'vitest';
import { placeToOrganizationFields, useGooglePlacesSearch, type GooglePlace } from './useGooglePlacesSearch';

const place = (website?: string): GooglePlace => ({ place_id: 'p1', name: 'Example Hall', formatted_address: '1 Main St', website } as GooglePlace);

describe('placeToOrganizationFields: website', () => {
  it('keeps an http(s) website', () => {
    expect(placeToOrganizationFields(place('https://example.com/')).url).toBe('https://example.com/');
  });

  it('leaves the website blank when it is missing or not http(s)', () => {
    expect(placeToOrganizationFields(place()).url).toBe('');
    expect(placeToOrganizationFields(place('javascript:alert(1)')).url).toBe('');
    expect(placeToOrganizationFields(place('example.com')).url).toBe('');
  });
});

// Rate limits (#371): over a limit, the server's message (which says the details can be typed
// by hand) is what the search shows, not "couldn't reach".
describe('useGooglePlacesSearch: a refused lookup', () => {
  it('keeps the server\'s message for a rate limit (429), and none for other failures', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { vi } = await import('vitest');
    const client = await import('../utils/supabase/client');
    const errors = await import('../utils/api-error-utils');
    const invoke = vi.fn(async () => ({ data: null, error: new Error('FunctionsHttpError') }));
    vi.spyOn(client, 'createClient').mockReturnValue({
      auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
      functions: { invoke },
    } as any);
    const limitMessage = 'Place lookups are paused until the limit resets (within 24 hours). You can type the details in by hand.';
    const spy = vi.spyOn(errors, 'handleFunctionsError')
      .mockImplementationOnce(async () => { throw Object.assign(new Error(limitMessage), { status: 429 }); })
      .mockImplementationOnce(async () => { throw Object.assign(new Error('boom'), { status: 500 }); });
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true });

    const { result } = renderHook(() => useGooglePlacesSearch());
    act(() => result.current.setSearchQuery('hall'));
    await act(async () => { await result.current.search(); });
    expect(result.current.searchError).toBe(true);
    expect(result.current.searchErrorMessage).toBe(limitMessage);

    await act(async () => { await result.current.search(); });
    expect(result.current.searchError).toBe(true);
    expect(result.current.searchErrorMessage).toBeNull();
    spy.mockRestore();
  });
});
