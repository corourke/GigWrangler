import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** A fresh client per render: no retries, so a failed load shows at once. */
export function makeTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * Renders inside a QueryClientProvider (the Financials screens read through TanStack Query, A10).
 * The wrapper option keeps rerender() inside the same client.
 */
export function render(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient } = {}) {
  const { queryClient = makeTestQueryClient(), ...rest } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, ...rtlRender(ui, { wrapper: Wrapper, ...rest }) };
}
