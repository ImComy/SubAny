// events/MouseEvents.ts

import type { ContentState } from '../state/ContentState';
import {
  handleSelectionMouseMove,
  handleSelectionClick,
  handleSelectionContextMenu,
  type SelectionDeps,
} from '../selection/SelectionController';
import {
  handleInteractiveMouseMove,
  handleInteractiveClick,
  type InteractiveTranslationDeps,
} from '../translation/InteractiveTranslationController';

export interface MouseEventsDeps {
  selection: SelectionDeps;
  interactive: InteractiveTranslationDeps;
}

export interface MouseEventsHandle {
  dispose: () => void;
}

/**
 * Wire all mouse listeners.
 *
 * Two distinct listener sets, matching the original:
 *
 *   1. Selection — window-level, capture phase. Registered with `true` so
 *      they fire before any player handler can swallow the event. The click
 *      and contextmenu handlers call `stopPropagation()` while selection
 *      mode is active, which is what prevents the interactive bubble
 *      listeners below from also seeing the event.
 *
 *   2. Interactive translation — document-level, bubble phase. The mousemove
 *      handler arms the hover debounce, the click handler fires click-mode
 *      translation. Both internally early-return when `isSelecting` is true,
 *      so even when selection swallows nothing (plain mousemove) the two
 *      systems do not conflict.
 */
export function startMouseEvents(
  state: ContentState,
  deps: MouseEventsDeps,
): MouseEventsHandle {
  let interactiveRaf: number | null = null;
  let pendingInteractiveMove: MouseEvent | null = null;

  const onSelectionMove = (e: MouseEvent) => handleSelectionMouseMove(state, e);
  const onSelectionClickCapture = (e: MouseEvent) =>
    handleSelectionClick(state, deps.selection, e);
  const onSelectionContext = (e: MouseEvent) =>
    handleSelectionContextMenu(state, deps.selection, e);

  const flushInteractiveMove = () => {
    if (!pendingInteractiveMove) return;
    const event = pendingInteractiveMove;
    pendingInteractiveMove = null;
    interactiveRaf = null;
    handleInteractiveMouseMove(state, deps.interactive, event);
  };

  const onInteractiveMove = (e: MouseEvent) => {
    if (state.isSelecting || (state.settings.triggerMode !== 'hover' && state.settings.triggerMode !== 'click')) return;

    pendingInteractiveMove = e;
    if (interactiveRaf !== null) return;
    interactiveRaf = window.requestAnimationFrame(flushInteractiveMove);
  };

  const onInteractiveClick = (e: MouseEvent) =>
    handleInteractiveClick(state, deps.interactive, e);

  // Selection set — window capture.
  window.addEventListener('mousemove', onSelectionMove, true);
  window.addEventListener('click', onSelectionClickCapture, true);
  window.addEventListener('contextmenu', onSelectionContext, true);

  // Interactive set — document bubble.
  document.addEventListener('mousemove', onInteractiveMove);
  document.addEventListener('click', onInteractiveClick);

  return {
    dispose: () => {
      if (interactiveRaf !== null) {
        window.cancelAnimationFrame(interactiveRaf);
        interactiveRaf = null;
      }
      pendingInteractiveMove = null;

      window.removeEventListener('mousemove', onSelectionMove, true);
      window.removeEventListener('click', onSelectionClickCapture, true);
      window.removeEventListener('contextmenu', onSelectionContext, true);

      document.removeEventListener('mousemove', onInteractiveMove);
      document.removeEventListener('click', onInteractiveClick);
    },
  };
}