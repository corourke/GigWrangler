import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** A fresh client per test: no retries, so a failing load shows its error at once. */
export function makeTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * render() inside a QueryClientProvider (A10). The wrapper also applies to rerender(), so a
 * test can change props (another organization or gig) against the same cache.
 */
export function renderWithQuery(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  const queryClient = makeTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper, ...options }) };
}
