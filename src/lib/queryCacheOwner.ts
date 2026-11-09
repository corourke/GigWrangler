import type { QueryClient } from '@tanstack/react-query';
import { queryClient as appQueryClient } from './queryClient';

/**
 * The query cache holds one signed-in person's answers at a time, like the phone's offline copy
 * (services/mobile/offlineOwner). Claimed when a session loads: cleared first if it was someone
 * else's. Cleared at sign-out. AuthProvider calls both before the person's screens load.
 */
let owner: string | null = null;

export function claimQueryCache(userId: string, client: QueryClient = appQueryClient): void {
  if (owner === userId) return;
  client.clear();
  owner = userId;
}

export function releaseQueryCache(client: QueryClient = appQueryClient): void {
  client.clear();
  owner = null;
}
