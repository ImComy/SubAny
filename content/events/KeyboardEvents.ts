// events/KeyboardEvents.ts

import type { ContentState } from '../state/ContentState';
import {
  handleSelectionEscape,
  type SelectionDeps,
} from '../selection/SelectionController';
import {
  handleInteractiveKeyDown,
  type InteractiveTranslationDeps,
} from '../translation/InteractiveTranslationController';

export interface KeyboardEventsDeps {
  selection: SelectionDeps;
  interactive: InteractiveTranslationDeps;
}

export interface KeyboardEventsHandle {
  dispose: () => void;
}

/**
 * Wire keyboard listeners.
 *
 * Two listeners, matching the original:
 *
 *   1. Escape — window capture. Cancels an in-progress selection. Capture
 *      phase so the player cannot consume the key first. We call
 *      `preventDefault` + `stopPropagation` only when the handler reports
 *      the key was consumed (i.e. selection was actually active).
 *
 *   2. Control — document bubble. While a tooltip is visible, re-reads the
 *      full phrase at the tooltip's stored position and re-translates if it
 *      changed. This is the "hold Ctrl to widen the translation" feature.
 *
 * Note the modifier-only keydown for Control has no reliable `keyup` pair
 * here — the original did the same, relying on Ctrl being held for the
 * refresh rather than tracking press/release state.
 */
export function startKeyboardEvents(
  state: ContentState,
  deps: KeyboardEventsDeps,
  doc: Document = document,
  win: Window = window,
): KeyboardEventsHandle {
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (handleSelectionEscape(state, deps.selection)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onControl = (e: KeyboardEvent) => {
    handleInteractiveKeyDown(state, deps.interactive, e);
  };

  win.addEventListener('keydown', onEscape, true);
  doc.addEventListener('keydown', onControl);

  return {
    dispose: () => {
      win.removeEventListener('keydown', onEscape, true);
      doc.removeEventListener('keydown', onControl);
    },
  };
}