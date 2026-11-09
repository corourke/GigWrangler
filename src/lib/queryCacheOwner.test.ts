import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { claimQueryCache, releaseQueryCache } from './queryCacheOwner';

// The query cache holds one signed-in person's answers at a time: cleared when someone else signs
// in on the tab, and at sign-out.
describe('query cache owner', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
    releaseQueryCache(qc);
  });

  it('keeps the cache while the same person stays signed in', () => {
    claimQueryCache('user-a', qc);
    qc.setQueryData(['gigs', 'org-1'], ['a gig']);
    claimQueryCache('user-a', qc);
    expect(qc.getQueryData(['gigs', 'org-1'])).toEqual(['a gig']);
  });

  it('clears it when someone else signs in', () => {
    claimQueryCache('user-a', qc);
    qc.setQueryData(['gigs', 'org-1'], ['a gig']);
    claimQueryCache('user-b', qc);
    expect(qc.getQueryCache().getAll()).toEqual([]);
  });

  it('clears it at sign-out, and again at the next sign-in', () => {
    claimQueryCache('user-a', qc);
    qc.setQueryData(['gigs', 'org-1'], ['a gig']);
    releaseQueryCache(qc);
    expect(qc.getQueryCache().getAll()).toEqual([]);
    qc.setQueryData(['gigs', 'org-1'], ['loaded after sign-out']);
    claimQueryCache('user-a', qc);
    expect(qc.getQueryCache().getAll()).toEqual([]);
  });
});
