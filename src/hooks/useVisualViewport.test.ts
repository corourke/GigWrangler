import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisualViewport } from './useVisualViewport';

// iOS: the keyboard covers part of the window, and only the visual viewport shrinks (#442). Seen
// as: a text field has focus, and the visible height dropped by more than 150px from what it was
// while nothing had focus. Pinch-zoom is not a keyboard.
type FakeViewport = EventTarget & { height: number; offsetTop: number; width: number; scale: number };
function fakeViewport(height: number, offsetTop = 0): FakeViewport {
  const vv = Object.assign(new EventTarget(), { height, offsetTop, width: 390, scale: 1 });
  vi.stubGlobal('visualViewport', vv);
  return vv;
}
function focusField(type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  document.body.appendChild(input);
  act(() => { input.focus(); });
  return input;
}
function resize(vv: FakeViewport, changes: Partial<FakeViewport>) {
  act(() => { Object.assign(vv, changes); vv.dispatchEvent(new Event('resize')); });
}

const H = window.innerHeight;

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useVisualViewport', () => {
  it('reports the visible area, and no keyboard when it fills the window', () => {
    fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: H, offsetTop: 0, keyboardOpen: false });
  });

  it('follows the keyboard opening and closing, and where iOS scrolls the visible area to', () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    const field = focusField();
    resize(vv, { height: H - 320, offsetTop: 120 });
    expect(result.current).toEqual({ height: H - 320, offsetTop: 120, keyboardOpen: true });
    act(() => { field.blur(); });
    resize(vv, { height: H, offsetTop: 0 });
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('sees the keyboard in an installed iPhone app where the window shrinks with it too', () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    focusField();
    vi.stubGlobal('innerHeight', H - 320);
    resize(vv, { height: H - 320 });
    expect(result.current.keyboardOpen).toBe(true);
  });

  it('is not a keyboard when nothing is being typed in', () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    focusField('checkbox');
    resize(vv, { height: H - 320 });
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('is not a keyboard when the page is pinch-zoomed', () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    focusField();
    resize(vv, { height: H / 2, offsetTop: 200, scale: 2 });
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('stays open while moving from one field to the next', async () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    const a = focusField();
    resize(vv, { height: H - 320, offsetTop: 100 });
    expect(result.current.keyboardOpen).toBe(true);
    const b = document.createElement('input');
    document.body.appendChild(b);
    // Between the two, focus is briefly on the page itself (focusout before focusin).
    act(() => { a.blur(); });
    expect(document.activeElement).toBe(document.body);
    expect(result.current.keyboardOpen).toBe(true);
    act(() => { b.focus(); });
    expect(result.current.keyboardOpen).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.keyboardOpen).toBe(true);
    resize(vv, { offsetTop: 140 });
    expect(result.current).toEqual({ height: H - 320, offsetTop: 140, keyboardOpen: true });
  });

  it('measures afresh when the window itself changes size with nothing focused (rotation)', () => {
    const vv = fakeViewport(H);
    const { result } = renderHook(() => useVisualViewport());
    // Rotated: the window and the visible area are both shorter, with no keyboard.
    vi.stubGlobal('innerHeight', 390);
    act(() => { Object.assign(vv, { height: 390 }); window.dispatchEvent(new Event('resize')); });
    expect(result.current.keyboardOpen).toBe(false);
    // A field takes focus without an on-screen keyboard (e.g. a hardware keyboard): not a keyboard.
    focusField();
    expect(result.current.keyboardOpen).toBe(false);
  });

  it('falls back to the window where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: H, offsetTop: 0, keyboardOpen: false });
  });
});
