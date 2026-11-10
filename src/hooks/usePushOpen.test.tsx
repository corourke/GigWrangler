import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A tapped push notification opens its screen and clears it from the bell.
const markNotificationRead = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/notification.service', () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
  getMyNotifications: vi.fn().mockResolvedValue([]),
}));

import { usePushOpen } from './usePushOpen';

let swTarget: EventTarget;
beforeEach(() => {
  vi.clearAllMocks();
  swTarget = new EventTarget();
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: swTarget });
});
afterEach(() => vi.unstubAllGlobals());

function setup(initial: string, userId: string | undefined = 'u1') {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => { usePushOpen(userId); return useLocation(); }, { wrapper });
}

function swMessage(data: unknown) {
  const event = new MessageEvent('message', { data });
  act(() => { swTarget.dispatchEvent(event); });
}

describe('usePushOpen', () => {
  it('goes to the screen and marks the notification read when the app was already open', async () => {
    const { result } = setup('/dashboard');
    swMessage({ type: 'gigwrangler:push-open', url: '/gigs/g1', notification_id: 'n1' });
    await waitFor(() => expect(result.current.pathname).toBe('/gigs/g1'));
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('ignores other messages and addresses outside the app', async () => {
    const { result } = setup('/dashboard');
    swMessage({ type: 'something-else', url: '/gigs/g1' });
    swMessage({ type: 'gigwrangler:push-open', url: '//elsewhere.test/x', notification_id: 'n1' });
    expect(result.current.pathname).toBe('/dashboard');
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('marks the notification read when the tap opened the app, and tidies the address', async () => {
    const { result } = setup('/financials?push=n2');
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n2'));
    await waitFor(() => expect(result.current.search).toBe(''));
    expect(result.current.pathname).toBe('/financials');
  });

  it('waits for sign-in before marking it read', async () => {
    setup('/financials?push=n2', undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});
