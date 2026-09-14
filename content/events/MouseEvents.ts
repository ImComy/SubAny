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

function isPointerInsideVideo(clientX: number, clientY: number): boolean {
  const videos = document.querySelectorAll('video');
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
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
  let lastSelectionMoveAt = 0;
  let lastSelectionMoveX = 0;
  let lastSelectionMoveY = 0;
  let lastInteractiveMoveAt = 0;
  let lastInteractiveMoveX = 0;
  let lastInteractiveMoveY = 0;
  let interactiveAttached = false;

  const shouldListenForInteractive = (): boolean => {
    if (state.isSelecting) return true;
    if (state.settings.triggerMode !== 'hover' && state.settings.triggerMode !== 'click') return false;
    return !!state.activeContainerEl || !!state.tooltipState || !!state.hoveredWordRect || !!state.virtualSelectionHit;
  };

  const syncInteractiveListeners = () => {
    const shouldAttach = shouldListenForInteractive();
    if (shouldAttach && !interactiveAttached) {
      document.addEventListener('mousemove', onInteractiveMove);
      document.addEventListener('click', onInteractiveClick);
      interactiveAttached = true;
      return;
    }

    if (!shouldAttach && interactiveAttached) {
      document.removeEventListener('mousemove', onInteractiveMove);
      document.removeEventListener('click', onInteractiveClick);
      interactiveAttached = false;
    }
  };

  const onSelectionMove = (e: MouseEvent) => {
    if (!isPointerInsideVideo(e.clientX, e.clientY)) return;

    // Click-only selection: never run subtitle scanning on every mouse move.
    // This avoids the YouTube CPU spike while still letting the click handler
    // resolve the actual subtitle target exactly once.
    const now = performance.now();
    const dx = Math.abs(e.clientX - lastSelectionMoveX);
    const dy = Math.abs(e.clientY - lastSelectionMoveY);
    if (now - lastSelectionMoveAt < 120 && dx < 10 && dy < 10) return;

    lastSelectionMoveAt = now;
    lastSelectionMoveX = e.clientX;
    lastSelectionMoveY = e.clientY;
    syncInteractiveListeners();
  };

  const onSelectionClickCapture = (e: MouseEvent) => {
    if (!isPointerInsideVideo(e.clientX, e.clientY)) return;
    handleSelectionClick(state, deps.selection, e);
  };
  const onSelectionContext = (e: MouseEvent) => {
    if (!isPointerInsideVideo(e.clientX, e.clientY)) return;
    handleSelectionContextMenu(state, deps.selection, e);
  };

  const flushInteractiveMove = () => {
    if (!pendingInteractiveMove) return;
    const event = pendingInteractiveMove;
    pendingInteractiveMove = null;
    interactiveRaf = null;
    handleInteractiveMouseMove(state, deps.interactive, event);
    syncInteractiveListeners();
  };

  const onInteractiveMove = (e: MouseEvent) => {
    if (!isPointerInsideVideo(e.clientX, e.clientY)) return;

    const now = performance.now();
    const dx = Math.abs(e.clientX - lastInteractiveMoveX);
    const dy = Math.abs(e.clientY - lastInteractiveMoveY);
    if (now - lastInteractiveMoveAt < 120 && dx < 10 && dy < 10) return;

    lastInteractiveMoveAt = now;
    lastInteractiveMoveX = e.clientX;
    lastInteractiveMoveY = e.clientY;

    if (!shouldListenForInteractive()) return;
    if (state.isSelecting || (state.settings.triggerMode !== 'hover' && state.settings.triggerMode !== 'click')) return;

    pendingInteractiveMove = e;
    if (interactiveRaf !== null) return;
    interactiveRaf = window.requestAnimationFrame(flushInteractiveMove);
  };

  const onInteractiveClick = (e: MouseEvent) => {
    if (!isPointerInsideVideo(e.clientX, e.clientY)) return;
    if (!shouldListenForInteractive()) return;
    handleInteractiveClick(state, deps.interactive, e);
    syncInteractiveListeners();
  };

  // Selection set — window capture.
  window.addEventListener('mousemove', onSelectionMove, true);
  window.addEventListener('click', onSelectionClickCapture, true);
  window.addEventListener('contextmenu', onSelectionContext, true);

  syncInteractiveListeners();

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
      interactiveAttached = false;
    },
  };
}