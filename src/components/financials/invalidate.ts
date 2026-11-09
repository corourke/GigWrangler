import type { QueryClient } from '@tanstack/react-query';

/** Invalidates each key from an invalidation-map entry; resolves once the active ones have refetched. */
export function invalidateKeys(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): Promise<void> {
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}
