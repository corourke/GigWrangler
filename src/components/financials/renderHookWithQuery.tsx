import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { makeTestQueryClient } from '../../test/renderWithQuery';

/**
 * renderHook inside a QueryClientProvider (A10), the hook-test companion of renderWithQuery.
 * Returns the client so a test can watch its cache; pass one to mount again against the same cache.
 */
export function renderHookWithQuery<R, P>(hook: (props: P) => R, options: { initialProps?: P; queryClient?: QueryClient } = {}) {
  const { queryClient = makeTestQueryClient(), initialProps } = options;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, ...renderHook(hook, { wrapper, initialProps }) };
}
