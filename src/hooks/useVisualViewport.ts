import { useEffect, useState } from 'react';

export interface VisualViewportState {
  /** Height of the part of the page the person can see. */
  height: number;
  /** How far the visible part is scrolled down from the top of the page. */
  offsetTop: number;
  /** An on-screen keyboard is taking up part of the window. */
  keyboardOpen: boolean;
}

/** The visible height dropping by more than this, with a text field focused, is a keyboard. */
const KEYBOARD_MIN_HEIGHT = 150;

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden']);

/** Something the keyboard types into has focus. */
function typing(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable === true);
}

/**
 * The visible height while nothing is being typed in. Measured rather than taken from
 * window.innerHeight, which in an installed iPhone app can shrink with the keyboard as well. Only
 * ever raised by focus and visual-viewport events: between two fields focus is briefly on the page
 * itself while the keyboard is still up, and taking that height would lose the keyboard. Measured
 * afresh only when the window itself changes size with nothing focused (rotation, browser bars).
 */
let restingHeight = 0;

function read(remeasure = false): VisualViewportState {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  const height = vv?.height ?? window.innerHeight;
  const offsetTop = vv?.offsetTop ?? 0;
  const zoomed = (vv?.scale ?? 1) > 1.01;
  const isTyping = typing();
  if (!isTyping && !zoomed) restingHeight = remeasure ? height : Math.max(restingHeight, height);
  if (!restingHeight) restingHeight = Math.max(height, window.innerHeight);
  return { height, offsetTop, keyboardOpen: isTyping && !zoomed && restingHeight - height > KEYBOARD_MIN_HEIGHT };
}

/**
 * The visible part of the page. On iOS the keyboard doesn't shrink the page (the layout viewport),
 * only this visual viewport, and iOS scrolls the visible part down the page to show the focused
 * field; anything fixed to the page ends up behind the keyboard or off the top unless it follows
 * these numbers (#442).
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState(read);
  useEffect(() => {
    const apply = (next: VisualViewportState) =>
      setState((prev) =>
        prev.height === next.height && prev.offsetTop === next.offsetTop && prev.keyboardOpen === next.keyboardOpen ? prev : next,
      );
    const update = () => apply(read());
    const windowResized = () => apply(read(true));
    // Focus has not reached the next field yet while focusout runs; look once it has.
    let pending: number | undefined;
    const focusLeft = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(update, 0);
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', windowResized);
    window.addEventListener('orientationchange', windowResized);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', focusLeft);
    return () => {
      window.clearTimeout(pending);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', windowResized);
      window.removeEventListener('orientationchange', windowResized);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', focusLeft);
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
