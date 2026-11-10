import { useEffect, useState } from 'react';

export interface VisualViewportState {
  /** Height of the part of the page the person can see. */
  height: number;
  /** How far the visible part is scrolled down from the top of the page. */
  offsetTop: number;
  /** An on-screen keyboard is taking up part of the window. */
  keyboardOpen: boolean;
}

/** More than this much of the window hidden means a keyboard, not just browser bars moving. */
const KEYBOARD_MIN_HEIGHT = 150;

function read(): VisualViewportState {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  const height = vv?.height ?? window.innerHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  return { height, offsetTop, keyboardOpen: window.innerHeight - height > KEYBOARD_MIN_HEIGHT };
}

/**
 * The visible part of the page. On iOS the keyboard doesn't shrink the page (the layout viewport),
 * only this visual viewport, so anything fixed to the bottom of the page ends up behind the keyboard
 * unless it follows these numbers (#442).
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => {
      const next = read();
      setState((prev) =>
        prev.height === next.height && prev.offsetTop === next.offsetTop && prev.keyboardOpen === next.keyboardOpen ? prev : next,
      );
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return state;
}

/** How long the iOS keyboard takes to slide up, so the field is scrolled into the space left. */
const KEYBOARD_ANIMATION_MS = 300;

/**
 * A focus handler for a scrolling sheet or form: once the keyboard is up, scrolls the focused field
 * to the middle of what's visible (#442).
 */
export function scrollFieldIntoView(event: { target: EventTarget | null }): void {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  window.setTimeout(() => {
    if (field.isConnected && typeof field.scrollIntoView === 'function') field.scrollIntoView({ block: 'center' });
  }, KEYBOARD_ANIMATION_MS);
}
