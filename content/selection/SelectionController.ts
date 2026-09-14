// selection/SelectionController.ts

import type { ContentState } from '../state/ContentState';
import { getHitAt, type UniversalHit } from './SubtitleHitTester';

function isPointerNearSubtitleBand(clientX: number, clientY: number, padding = 32): boolean {
  const videos = document.querySelectorAll('video');
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const bandTop = rect.top + rect.height * 0.55;
    const bandBottom = rect.bottom;
    if (
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= bandTop - padding &&
      clientY <= bandBottom + padding
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Lifecycle callbacks the selection layer needs to talk back to the app.
 * Everything outside the selection state machine is injected so this folder
 * stays a leaf module.
 */
export interface SelectionDeps {
  /**
   * Persist the user's choice of `element` as the new locked subtitle
   * container. Wired by ContentApp to `lockContainer`.
   */
  lockContainer: (element: HTMLElement) => Promise<void>;

  /**
   * Stop the auto-detection monitor. Called when entering selection mode so
   * the auto-tracker does not fight the user's cursor for `activeContainerEl`.
   */
  stopAutoDetection: () => void;

  /**
   * Resume the auto-detection monitor if (and only if) the current settings
   * allow it. Called when selection mode is cancelled without committing.
   *
   * The implementation is expected to be a no-op when a lockedSelector is
   * set or when auto-detection is otherwise disabled — matching the original
   * `if (!settings.lockedSelector && !autoDetectionDisabled && isAutomaticSubtitleMode())`
   * guard.
   */
  resumeAutoDetection: () => void;
}

/**
 * Enter selection mode.
 *
 * Matches the original `startSelectionFlow`: stops auto-detection, sets the
 * flag, clears any stale candidate, and notifies the renderer.
 */
export function startSelection(state: ContentState, deps: SelectionDeps): void {
  deps.stopAutoDetection();
  state.isSelecting = true;
  state.selectionCandidateEl = null;
  state.notify();
}

/**
 * Exit selection mode without committing anything. Used by context-menu and
 * Escape. Optionally resumes auto-detection.
 */
export function cancelSelection(
  state: ContentState,
  deps: SelectionDeps,
  opts: { resumeAuto?: boolean } = {},
): void {
  state.isSelecting = false;
  state.selectionCandidateEl = null;
  state.virtualSelectionHit = null;
  state.hoveredWordRect = null;
  state.notify();
  if (opts.resumeAuto !== false) deps.resumeAutoDetection();
}

/**
 * Track the cursor while selecting. Highlights whichever subtitle candidate
 * sits under the pointer, and for native cues also drives the hover rect so
 * SubtitleOverlay can render an outline around the invisible cue.
 *
 * Matches the original `onSelectionMouseMove`.
 */
export function handleSelectionMouseMove(state: ContentState, e: MouseEvent): void {
  if (!state.isSelecting) return;

  // Selection mode is click-driven for performance. Continuous subtitle
  // hit-testing on every mousemove is the dominant CPU cost on YouTube, and
  // the actual selection decision is still made in `handleSelectionClick`.
  // Keep the state clean and do not force a render / DOM scan while the user
  // merely moves the cursor.
  if (!isPointerNearSubtitleBand(e.clientX, e.clientY, 32)) {
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = null;
    state.hoveredWordRect = null;
    return;
  }

  // Do not run the expensive subtitle hit-test on every pointer move. The
  // selection flow only needs the click target to resolve a lockable subtitle.
  state.selectionCandidateEl = null;
  state.virtualSelectionHit = null;
  state.hoveredWordRect = null;
}

/**
 * Commit a selection on click.
 *
 * Precedence matches the original content script exactly:
 *   1. A DOM element that is not `body` and not `<video>` → lock it.
 *   2. A native TextTrack cue → keep it as the virtual selection target.
 *   3. Anything else → no commit; selection stays open.
 *
 * `isSelecting` is flipped to false before awaiting `lockContainer`, matching
 * the original, so any downstream re-render is not confused by "isSelecting
 * still true while a lock installs".
 *
 * Intended to be bound as a capture-phase click listener.
 */
export function handleSelectionClick(
  state: ContentState,
  deps: SelectionDeps,
  e: MouseEvent,
): void {
  if (!state.isSelecting) return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target as HTMLElement | null;
  const activeContainsPointer = !!state.activeContainerEl && !!target && state.activeContainerEl.contains(target);
  const chosen = activeContainsPointer
    ? state.activeContainerEl
    : (target && target !== document.body && target.tagName.toLowerCase() !== 'video' ? target : null);

  // Case 1: real DOM subtitle element.
  if (chosen && chosen !== document.body && chosen.tagName.toLowerCase() !== 'video') {
    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = null;
    state.hoveredWordRect = null;
    state.notify();
    void deps.lockContainer(chosen);
    return;
  }

  // Case 2: native TextTrack cue. Only attempt a fallback when the click
  // target itself is not a known DOM subtitle. This avoids the expensive
  // player-wide hit-test path on YouTube.
  const hit = !chosen ? getHitAt(e.clientX, e.clientY) : { element: null, native: null, video: null };
  if (hit.native) {
    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = hit.native;
    state.hoveredWordRect = hit.native.rect;
    state.notify();
    return;
  }

  // A click outside a valid subtitle is an explicit cancellation. Leaving
  // selection active here made the UI appear stuck until a context-menu event.
  cancelSelection(state, deps, { resumeAuto: true });
}

/**
 * Cancel a selection on right-click.
 *
 * Matches the original `onSelectionContextMenu`, which also resumed
 * auto-detection when appropriate. Called from a capture-phase contextmenu
 * listener.
 */
export function handleSelectionContextMenu(
  state: ContentState,
  deps: SelectionDeps,
  e: MouseEvent,
): void {
  if (!state.isSelecting) return;
  e.preventDefault();
  e.stopPropagation();
  cancelSelection(state, deps, { resumeAuto: true });
}

/**
 * Cancel a selection on Escape.
 *
 * Return value indicates whether the key was consumed, so the caller can
 * decide whether to stop propagation.
 */
export function handleSelectionEscape(
  state: ContentState,
  deps: SelectionDeps,
): boolean {
  if (!state.isSelecting) return false;
  cancelSelection(state, deps, { resumeAuto: true });
  return true;
}

/**
 * Convenience getter used by hover/click translation to know whether a
 * virtual (native) cue is currently the active target.
 */
export function currentVirtualHit(state: ContentState): UniversalHit | null {
  if (!state.virtualSelectionHit) return null;
  return { element: null, native: state.virtualSelectionHit, video: state.virtualSelectionHit.video };
}