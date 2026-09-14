// selection/SelectionController.ts

import type { ContentState } from '../state/ContentState';
import { getHitAt, type UniversalHit } from './SubtitleHitTester';
import { getSubtitleElementAtPoint, getVideoForElement } from '../../utils/dom';
import { resolveStableContainer } from '../locking/LockMonitor';

/**
 * Module-level throttle state for the hover preview.
 *
 * The selection preview is the only thing in this file that runs on a hot
 * path. Two guards keep it cheap:
 *   - at most once per 60 ms (≈16 calls/sec instead of 60)
 *   - only when the cursor has moved at least 4 px (skips jitter)
 *
 * Combined with the well-pruned geometric walk inside
 * `getSubtitleElementAtPoint`, this costs well under 1% main-thread time
 * on a YouTube-sized page. Do not remove these guards.
 */
let lastMoveAt = 0;
let lastMoveX = 0;
let lastMoveY = 0;
const MOVE_THROTTLE_MS = 60;
const MOVE_MIN_DISTANCE_SQ = 16; // 4px squared

function isPointerOverAnyVideo(clientX: number, clientY: number, padding = 8): boolean {
  const videos = document.querySelectorAll('video');
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding
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
  lockContainer: (element: HTMLElement) => Promise<void>;
  stopAutoDetection: () => void;
  resumeAutoDetection: () => void;
}

/**
 * Enter selection mode.
 */
export function startSelection(state: ContentState, deps: SelectionDeps): void {
  deps.stopAutoDetection();
  state.isSelecting = true;
  state.selectionCandidateEl = null;
  // Reset throttle so the first mousemove after entering selection always
  // fires the preview.
  lastMoveAt = 0;
  lastMoveX = 0;
  lastMoveY = 0;
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
 * Track the cursor while selecting. Highlights the subtitle candidate under
 * the pointer so the user can see what they are about to lock.
 *
 * Uses the SAME hit-test function the click uses (`getSubtitleElementAtPoint`),
 * so the preview and the committed selection can never diverge.
 *
 * Throttled — see the module-level constants above.
 */
export function handleSelectionMouseMove(state: ContentState, e: MouseEvent): void {
  if (!state.isSelecting) return;

  const now = performance.now();
  if (now - lastMoveAt < MOVE_THROTTLE_MS) return;

  const dx = e.clientX - lastMoveX;
  const dy = e.clientY - lastMoveY;
  if (dx * dx + dy * dy < MOVE_MIN_DISTANCE_SQ) return;

  lastMoveAt = now;
  lastMoveX = e.clientX;
  lastMoveY = e.clientY;

  // Cheap pre-filter: if the cursor is not over any <video>, there is
  // nothing to preview. Avoids the more expensive hit-test.
  if (!isPointerOverAnyVideo(e.clientX, e.clientY)) {
    if (state.selectionCandidateEl !== null) {
      state.selectionCandidateEl = null;
      state.notify();
    }
    return;
  }

  // The same function the click path uses. On sites whose captions have
  // pointer-events:none, this falls through to the pruned geometric walk
  // scoped to the video's grandparent.
  const candidate = getSubtitleElementAtPoint(e.clientX, e.clientY, null);

  // Only re-render when the candidate actually changed.
  if (candidate !== state.selectionCandidateEl) {
    state.selectionCandidateEl = candidate;
    state.notify();
  }
}

/**
 * Commit a selection on click.
 *
 * Precedence:
 *   1. A DOM element under the click → lock it (via the same hit-test as
 *      the hover preview).
 *   2. The current active container, if the click was inside it.
 *   3. A native TextTrack cue → keep it as the virtual selection target.
 *   4. Anything else → cancel selection.
 *
 * `isSelecting` is flipped to false before awaiting `lockContainer` so
 * downstream re-renders are not confused by "isSelecting still true while
 * a lock installs".
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

  // 1. Retrieve the clicked subtitle element.
  const clickedLeaf = getSubtitleElementAtPoint(e.clientX, e.clientY, target);
  console.log('[SubAny] click', e.clientX, e.clientY, 'leaf:', clickedLeaf?.className, 'leafRect:', clickedLeaf ? JSON.stringify(clickedLeaf.getBoundingClientRect()) : null);

  if (clickedLeaf) {
    const video = getVideoForElement(clickedLeaf);
    const videoRect = video?.getBoundingClientRect() ?? null;
    const container = resolveStableContainer(clickedLeaf, videoRect);

    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = null;
    state.hoveredWordRect = null;
    state.notify();

    void deps.lockContainer(container);
    return;
  }

  // 2. Direct hit on current activeContainerEl descendant.
  if (state.activeContainerEl && target && state.activeContainerEl.contains(target)) {
    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = null;
    state.hoveredWordRect = null;
    state.notify();

    void deps.lockContainer(state.activeContainerEl);
    return;
  }

  // 3. Native TextTrack cue fallback.
  const hit = getHitAt(e.clientX, e.clientY);
  if (hit.native) {
    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = hit.native;
    state.hoveredWordRect = hit.native.rect;
    state.notify();
    return;
  }

  // 4. Click outside a subtitle cancels.
  cancelSelection(state, deps, { resumeAuto: true });
}

/**
 * Cancel a selection on right-click.
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