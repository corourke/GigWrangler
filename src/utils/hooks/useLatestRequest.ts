import { useCallback, useEffect, useRef } from 'react';

/**
 * Stale-response guard for loaders (B12). Call the returned function when a load starts; it gives
 * back `isCurrent()`, true only while that load is the newest one and the screen is still mounted.
 * Check it after each await, before setting state, so a slow answer for an earlier gig,
 * organization or filter never overwrites a newer one.
 *
 *   const startRequest = useLatestRequest();
 *   const load = useCallback(async () => {
 *     const isCurrent = startRequest();
 *     const data = await fetchSomething(id);
 *     if (!isCurrent()) return;
 *     setData(data);
 *   }, [id, startRequest]);
 */
export function useLatestRequest(): () => () => boolean {
  const latest = useRef(0);
  useEffect(() => {
    const ref = latest;
    return () => { ref.current += 1; };
  }, []);
  return useCallback(() => {
    latest.current += 1;
    const id = latest.current;
    return () => latest.current === id;
  }, []);
}
