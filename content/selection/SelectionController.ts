// selection/SelectionController.ts

import type { ContentState } from '../state/ContentState';
import { getHitAt, type UniversalHit } from './SubtitleHitTester';
import {
  getSubtitleElementAtPoint,
  getVideoForElement,
  getSubtitleAcceptanceRegion,
  isPlausibleSubtitleLeaf,
  resolveCaptionLineContainer,
  getAllVideos,
  composedContains,
  registerComposedShadowRoots,
} from '../../utils/dom';
import { combineSubtitleLines } from '../detection/SubtitleGrouping';
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

function isPointerOverAnyVideo(clientX: number, clientY: number, padding = 24, targetDoc: Document = document): boolean {
  const videos = getAllVideos(targetDoc);
  for (const video of videos) {
    const region = getSubtitleAcceptanceRegion(video);
    if (
      clientX >= region.left - padding &&
      clientX <= region.right + padding &&
      clientY >= region.top - padding &&
      clientY <= region.bottom + padding
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
  'video', 'audio', 'canvas', 'path', 'button', 'input', 'select',
  'script', 'style', 'noscript', 'head', 'meta', 'link', 'iframe',
  'object', 'embed', 'img', 'picture', 'source', 'track',
  'br', 'hr', 'wbr',
]);

/**
 * Locate the subtitle leaf element containing the point.
 *
 * Uses the shared `isPlausibleSubtitleLeaf` predicate and scores candidates
 * to prevent locking arbitrary tiny text or full-width player chrome.
 */
function findCaptionElementAtPoint(clientX: number, clientY: number, targetDoc: Document = document): HTMLElement | SVGElement | null {
  let video: HTMLVideoElement | null = null;
  for (const v of getAllVideos(targetDoc)) {
    const r = v.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const region = getSubtitleAcceptanceRegion(v);
    if (
      clientX >= region.left && clientX <= region.right &&
      clientY >= region.top && clientY <= region.bottom
    ) {
      video = v;
      break;
    }
  }
  if (!video) return null;

  const vr = video.getBoundingClientRect();
  const rootNode = video.getRootNode();
  const root = video.parentElement?.parentElement ?? video.parentElement ?? (rootNode instanceof ShadowRoot ? (rootNode as ShadowRoot).firstElementChild as HTMLElement | null : null);
  if (!root) return null;

  let best: HTMLElement | SVGElement | null = null;
  let bestScore = -Infinity;

  const walk = (el: Element) => {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return;
    if (el.closest('#subany-extension-root')) return;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'svg' && !el.querySelector('text')) return;

    for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
      walk(child);
    }

    if (el.closest(CONTROL_SELECTOR)) return;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (clientX < r.left - 12 || clientX > r.right + 12) return;
    if (clientY < r.top - 12 || clientY > r.bottom + 12) return;

    if (!isPlausibleSubtitleLeaf(el as HTMLElement | SVGElement, vr, { allowTop: true })) return;

    let score = 100;
    const centerY = r.top + r.height / 2;
    const yRatio = (centerY - vr.top) / vr.height;
    if ((yRatio >= 0.60 && yRatio <= 0.95) || (yRatio >= 0.04 && yRatio <= 0.30)) {
      score += 20;
    }
    score -= (r.width * r.height) / 2000;

    if (score > bestScore) {
      bestScore = score;
      best = el as HTMLElement | SVGElement;
    }
  };

  walk(root);
  return best ? resolveCaptionLineContainer(best, vr) : null;
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface SelectionDeps {
  lockContainer: (element: HTMLElement | SVGElement) => Promise<void>;
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
  registerComposedShadowRoots(e);

  const now = performance.now();
  if (now - lastMoveAt < MOVE_THROTTLE_MS) return;

  const dx = e.clientX - lastMoveX;
  const dy = e.clientY - lastMoveY;
  if (dx * dx + dy * dy < MOVE_MIN_DISTANCE_SQ) return;

  lastMoveAt = now;
  lastMoveX = e.clientX;
  lastMoveY = e.clientY;

  const target = (e.composedPath?.()[0] as HTMLElement | SVGElement | null) ?? (e.target as HTMLElement | SVGElement | null);
  const doc = target?.ownerDocument ?? document;

  if (!isPointerOverAnyVideo(e.clientX, e.clientY, 24, doc)) {
    if (state.selectionCandidateEl !== null) {
      state.selectionCandidateEl = null;
      state.notify();
    }
    return;
  }

  // Primary hit-tester, then fall back to the geometric resolver so the
  // preview matches what the click will install.
  let candidate = getSubtitleElementAtPoint(e.clientX, e.clientY, null, doc);
  if (!candidate) candidate = findCaptionElementAtPoint(e.clientX, e.clientY, doc);
  if (candidate) {
    const video = getVideoForElement(candidate);
    const videoRect = video?.getBoundingClientRect() ?? null;
    candidate = combineSubtitleLines(candidate, videoRect);
  }

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
  registerComposedShadowRoots(e);

  const target = (e.composedPath?.()[0] as HTMLElement | SVGElement | null) ?? (e.target as HTMLElement | SVGElement | null);
  const doc = target?.ownerDocument ?? document;

  // 1. Primary hit-test.
  let clickedLeaf = getSubtitleElementAtPoint(e.clientX, e.clientY, target, doc);
  console.log(
    '[SubAny] click', e.clientX, e.clientY,
    'leaf:', clickedLeaf?.className,
    'leafRect:', clickedLeaf ? JSON.stringify(clickedLeaf.getBoundingClientRect()) : null,
  );

  // 1b. Geometric fallback. Runs when the primary hit-test cannot resolve
  //     a caption (very common on players with pointer-events:none on the
  //     caption layer). Resolves the target purely from coordinates.
  if (!clickedLeaf) {
    clickedLeaf = findCaptionElementAtPoint(e.clientX, e.clientY, doc);
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
    const lineTarget = resolveCaptionLineContainer(clickedLeaf, videoRect);
    const groupTarget = combineSubtitleLines(lineTarget, videoRect);
    const container = resolveStableContainer(groupTarget, videoRect);

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
  if (state.activeContainerEl && target && (state.activeContainerEl === target || composedContains(state.activeContainerEl, target))) {
    state.isSelecting = false;
    state.selectionCandidateEl = null;
    state.virtualSelectionHit = null;
    state.hoveredWordRect = null;
    state.notify();

    void deps.lockContainer(state.activeContainerEl);
    return;
  }

  // 3. Native TextTrack cue fallback.
  const hit = getHitAt(e.clientX, e.clientY, doc);
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
  registerComposedShadowRoots(e);
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