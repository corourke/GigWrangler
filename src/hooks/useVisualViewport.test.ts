import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisualViewport } from './useVisualViewport';

// iOS: the keyboard doesn't shrink the page, only the visual viewport (#442).
function fakeViewport(height: number, offsetTop = 0) {
  const vv = Object.assign(new EventTarget(), { height, offsetTop, width: 390 });
  vi.stubGlobal('visualViewport', vv);
  return vv;
}

afterEach(() => vi.unstubAllGlobals());

describe('useVisualViewport', () => {
  it('reports the visible area, and no keyboard when it fills the window', () => {
    fakeViewport(window.innerHeight);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: window.innerHeight, offsetTop: 0, keyboardOpen: false });
  });

  it('follows the keyboard opening and closing', () => {
    const vv = fakeViewport(window.innerHeight);
    const { result } = renderHook(() => useVisualViewport());
    act(() => {
      Object.assign(vv, { height: window.innerHeight - 320, offsetTop: 40 });
      vv.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ height: window.innerHeight - 320, offsetTop: 40, keyboardOpen: true });
    act(() => {
      Object.assign(vv, { height: window.innerHeight, offsetTop: 0 });
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('falls back to the window where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: window.innerHeight, offsetTop: 0, keyboardOpen: false });
  });
});
