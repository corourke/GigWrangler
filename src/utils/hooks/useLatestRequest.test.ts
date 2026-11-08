import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestRequest } from './useLatestRequest';

// B12: a loader's answer is applied only while it is the newest request and the screen is mounted.
describe('useLatestRequest', () => {
  it('keeps only the newest request current', () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current();
    expect(first()).toBe(true);
    const second = result.current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('drops every request when the screen goes away', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const req = result.current();
    unmount();
    expect(req()).toBe(false);
  });

  it('gives the same starter on every render', () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const start = result.current;
    rerender();
    expect(result.current).toBe(start);
  });
});
