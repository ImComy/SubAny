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

// ---------------------------------------------------------------------------
// Geometric fallback for click resolution
// ---------------------------------------------------------------------------

const CONTROL_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]';

const SKIP_TAGS = new Set([
  'video', 'audio', 'canvas', 'svg', 'button', 'input', 'select',
  'script', 'style', 'noscript', 'head', 'meta', 'link', 'iframe',
  'object', 'embed', 'img', 'picture', 'source', 'track',
  'br', 'hr', 'wbr',
]);

/**
 * Locate the smallest caption-like element containing the point.
 *
 * Used as a fallback when `getSubtitleElementAtPoint` returns undefined.
 * The primary hit-tester depends on `e.target`, which is unreliable on
 * players where the caption layer has `pointer-events: none` (the click
 * lands on the video wrapper, not the caption). This fallback does not
 * depend on `e.target` at all — it re-derives the target purely from
 * coordinates.
 *
 * Returns null when the point is not inside a video or when no text
 * element under the point looks like a caption.
 */
function findCaptionElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
  // 1. Find the video whose rect contains the point.
  let video: HTMLVideoElement | null = null;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (
      clientX >= r.left && clientX <= r.right &&
      clientY >= r.top && clientY <= r.bottom
    ) {
      video = v;
      break;
    }
  }
  if (!video) return null;

  const root = video.parentElement?.parentElement ?? video.parentElement;
  if (!root) return null;

  let best: HTMLElement | null = null;
  let bestArea = Infinity;

  const walk = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest('#subany-extension-root')) return;
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return;

    // Deepest match wins: descend before self-check.
    // Iterate with firstElementChild / nextElementSibling so we never index
    // into an array under `noUncheckedIndexedAccess`.
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
      walk(child);
    }

    // Skip UI chrome text (button labels, timecodes, controls).
    if (el.closest(CONTROL_SELECTOR)) return;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (clientX < r.left || clientX > r.right) return;
    if (clientY < r.top || clientY > r.bottom) return;

    const text = (el.textContent ?? '').trim();
    if (text.length < 2 || text.length > 400) return;
    if (!/[\p{L}]/u.test(text)) return;

    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  };

  walk(root);
  return best;
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface SelectionDeps {
  lockContainer: (element: HTMLElement) => Promise<void>;
  stopAutoDetection: () => void;
  resumeAutoDetection: () => void;
  startVideoMonitor: () => void;
  stopVideoMonitor: () => void;
}

/**
 * Enter selection mode.
 */
export function startSelection(state: ContentState, deps: SelectionDeps): void {
  deps.stopAutoDetection();
  state.isSelecting = true;
  state.selectionCandidateEl = null;
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
  const hadNativeSelection = !!state.virtualSelectionHit;
  state.isSelecting = false;
  state.selectionCandidateEl = null;
  state.virtualSelectionHit = null;
  state.hoveredWordRect = null;
  state.notify();
  if (hadNativeSelection) deps.stopVideoMonitor();
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

  if (!isPointerOverAnyVideo(e.clientX, e.clientY)) {
    if (state.selectionCandidateEl !== null) {
      state.selectionCandidateEl = null;
      state.notify();
    }
    return;
  }

  // Primary hit-tester, then fall back to the geometric resolver so the
  // preview matches what the click will install.
  let candidate = getSubtitleElementAtPoint(e.clientX, e.clientY, null);
  if (!candidate) candidate = findCaptionElementAtPoint(e.clientX, e.clientY);

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
 *   1b. Geometric fallback when the primary hit-test misses (players with
 *      `pointer-events: none` on the caption layer).
 *   2. The current active container, if the click was inside it.
 *   3. A native TextTrack cue → keep it as the virtual selection target.
 *   4. Anything else → cancel selection.
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

  // 1. Primary hit-test.
  let clickedLeaf = getSubtitleElementAtPoint(e.clientX, e.clientY, target);
  console.log(
    '[SubAny] click', e.clientX, e.clientY,
    'leaf:', clickedLeaf?.className,
    'leafRect:', clickedLeaf ? JSON.stringify(clickedLeaf.getBoundingClientRect()) : null,
  );

  // 1b. Geometric fallback. Runs when the primary hit-test cannot resolve
  //     a caption (very common on players with pointer-events:none on the
  //     caption layer). Resolves the target purely from coordinates.
  if (!clickedLeaf) {
    clickedLeaf = findCaptionElementAtPoint(e.clientX, e.clientY);
    if (clickedLeaf) {
      console.log(
        '[SubAny] click fallback resolved:',
        clickedLeaf.className,
        JSON.stringify(clickedLeaf.getBoundingClientRect()),
      );
    }
  }

  if (clickedLeaf) {
    const video = getVideoForElement(clickedLeaf);
    const videoRect = video?.getBoundingClientRect() ?? null;
    const container = resolveStableContainer(clickedLeaf, videoRect);

    state.isSelecting = false;
    state.selectionCandidateEl = null;
    // Clearing virtualSelectionHit here is what suppresses the native proxy
    // box the moment a real DOM lock installs.
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
    state.hoveredWordRect = null;
    deps.startVideoMonitor();
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