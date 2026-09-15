// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { normalizeSubtitleText, isSubtitleText } from '../../utils/text';
import { getVideoForElement } from '../../utils/dom';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set([
  'video', 'audio', 'canvas', 'svg', 'path',
  'button', 'input', 'select', 'textarea',
  'script', 'style', 'noscript', 'link', 'meta', 'head',
  'iframe', 'object', 'embed', 'img', 'picture', 'source', 'track',
  'br', 'hr', 'wbr',
]);

const CONTROL_SELECTOR =
  'button, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]';

/**
 * After the current active container stops being plausible, wait this long
 * before running another recovery scan. A player rebuild can fire dozens of
 * mutations in a single frame; without this every one of them would try to
 * scan. 150 ms is enough to coalesce a rebuild burst but short enough that
 * a fresh cue is picked up immediately.
 */
const SCAN_COOLDOWN_MS = 150;

// ---------------------------------------------------------------------------
// Module-scope runtime state (per content-script instance)
// ---------------------------------------------------------------------------

/**
 * The last text we forwarded to the translation pipeline. Used to avoid
 * spurious `state.notify()` calls when the mutation observer fires on a
 * subtree that contains the caption but whose text hasn't changed. Reset
 * whenever the monitor is stopped or restarted.
 */
let lastNotifiedText = '';

/**
 * Timestamp of the last recovery scan. Rate-limits scans across mutation
 * bursts.
 */
let lastScanAt = 0;

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function isExtensionElement(el: HTMLElement): boolean {
  return el.id === 'subany-extension-root' || !!el.id?.startsWith('subany-');
}

/**
 * True when the element (or any descendant) is an interactive control.
 *
 * This is the guard that stops the lock from silently attaching to player
 * chrome whose `textContent` happens to be a run of letters — settings
 * panels, control bars, playback menus. A caption never contains a button.
 */
function containsInteractiveControls(el: HTMLElement): boolean {
  return el.querySelector(CONTROL_SELECTOR) !== null;
}

/**
 * A "plausible caption container" is one that could be showing a subtitle
 * right now, or could be about to. Text is allowed to be empty, because on
 * many players the caption wrapper sits empty between cues and fills in
 * again when the next one starts.
 *
 * Every check is cheap: one `querySelector` and one `getBoundingClientRect`.
 * `textContent` is read last because we only need it once the geometric
 * checks have passed.
 */
function isPlausibleCaptionContainer(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (!document.documentElement.contains(el)) return false;

  // Chrome check first — cheap, and it eliminates the most common wrong
  // target (settings panel, control bar) in one shot.
  if (containsInteractiveControls(el)) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  // Reject thin-wide strips (progress bars, scrubbers). No subtitle line
  // is ever shaped like a progress bar.
  if (rect.width / rect.height > 20) return false;

  // Text check: empty is fine (between cues). If there is text, it must
  // look like a subtitle, not a timecode or player label.
  const text = normalizeSubtitleText(el.textContent ?? '');
  if (text.length === 0) return true;
  if (text.length > 400) return false;
  return isSubtitleText(text);
}

/**
 * A stricter check used only during the recovery scan. The scan is looking
 * for a caption that is *currently visible*, so empty text disqualifies.
 * Position and size are also checked here because the scan may encounter
 * candidates anywhere in the player subtree.
 */
function isLiveCaptionCandidate(el: HTMLElement, videoRect: DOMRect): boolean {
  if (isExtensionElement(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return false;
  if (containsInteractiveControls(el)) return false;

  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;

  // Reject player wrappers.
  if (r.width > videoRect.width * 0.95 && r.height > videoRect.height * 0.15) return false;

  // Reject thin-wide chrome.
  if (r.width / r.height > 20) return false;

  // Reject the top chrome band. `centerY`, not `top`, so captions whose
  // top edge is high but whose text sits lower still pass.
  const centerY = r.top + r.height / 2;
  if (centerY < videoRect.top + videoRect.height * 0.15) return false;

  // Must contain plausible subtitle text.
  const text = normalizeSubtitleText(el.textContent ?? '');
  if (text.length < 2 || text.length > 400) return false;
  return isSubtitleText(text);
}

// ---------------------------------------------------------------------------
// Container resolution (used once, at click time)
// ---------------------------------------------------------------------------

/**
 * Walk up from a clicked subtitle leaf to the stable caption container.
 *
 * Purely geometric. Class matching is a preference — if nothing matches,
 * the highest surviving ancestor is still the correct answer.
 */
export function resolveStableContainer(
  clickedElement: HTMLElement,
  videoRect: DOMRect | null,
): HTMLElement {
  let current: HTMLElement | null = clickedElement;
  let bestContainer: HTMLElement = clickedElement;
  let highestStable: HTMLElement = clickedElement;
  const controlSelector = 'video, button, input, [role="button"], [role="slider"]';

  for (
    let i = 0;
    i < 6 && current && current !== document.body && current !== document.documentElement;
    i++
  ) {
    if (current.tagName.toLowerCase() === 'video') break;
    if (current.classList.contains('html5-video-player') || current.classList.contains('video-stream')) break;
    if (current.matches(controlSelector) || !!current.querySelector(controlSelector)) break;

    const rect = current.getBoundingClientRect();
    if (videoRect) {
      if (rect.width > videoRect.width * 0.90 && rect.height > videoRect.height * 0.15) break;
      if (rect.width > videoRect.width * 0.98) break;
      if (rect.height > Math.min(videoRect.height * 0.35, 300)) break;
    }

    const className = typeof current.className === 'string' ? current.className : '';

    const isExplicitCaptionWindow =
      /(caption-window|ytp-caption-window|subtitle-window|captions-display|cue-container)/i.test(className) &&
      !className.includes('caption-window-container');
    if (isExplicitCaptionWindow) {
      return current;
    }

    if (/(caption|subtitle|cue|timedtext)/i.test(className) && !className.startsWith('subany-')) {
      bestContainer = current;
    }

    highestStable = current;
    current = current.parentElement;
  }

  return bestContainer !== clickedElement ? bestContainer : highestStable;
}

// ---------------------------------------------------------------------------
// Video discovery
// ---------------------------------------------------------------------------

function findFirstVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  return videos.find((v) => {
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? videos[0] ?? null;
}

function findObservedVideo(state: ContentState): HTMLVideoElement | null {
  if (state.lockedVideoElement && document.documentElement.contains(state.lockedVideoElement)) {
    const r = state.lockedVideoElement.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return state.lockedVideoElement;
  }
  if (state.activeContainerEl) {
    const v = getVideoForElement(state.activeContainerEl);
    if (v) {
      state.lockedVideoElement = v;
      return v;
    }
  }
  return findFirstVideo();
}

// ---------------------------------------------------------------------------
// Recovery scan
// ---------------------------------------------------------------------------

/**
 * Scan the video's grandparent subtree for a live caption. Bounded and
 * text-first: for each element we read `textContent` (free) before doing
 * any geometry work. `getBoundingClientRect` is only called on elements
 * whose text already looks like a subtitle.
 *
 * This is the ONLY place that walks more than the current container. It
 * runs at most once per SCAN_COOLDOWN_MS, and only when the fast-path
 * check has already failed.
 */
function findCaptionInVideo(video: HTMLVideoElement): HTMLElement | null {
  const vr = video.getBoundingClientRect();
  if (vr.width <= 0 || vr.height <= 0) return null;

  const scope = video.parentElement?.parentElement ?? video.parentElement;
  if (!scope) return null;

  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  const stack: HTMLElement[] = [scope];
  let visited = 0;
  const MAX_VISITS = 400;

  while (stack.length > 0 && visited < MAX_VISITS) {
    const el = stack.pop()!;
    visited++;

    if (isExtensionElement(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (containsInteractiveControls(el)) continue;

    // Descend unconditionally — the caption might live inside a wrapper
    // that fails the size cap.
    for (let i = el.children.length - 1; i >= 0; i--) {
      stack.push(el.children[i] as HTMLElement);
    }

    // Free filter: skip anything whose text can't be a subtitle before
    // touching geometry.
    const text = normalizeSubtitleText(el.textContent ?? '');
    if (text.length < 2 || text.length > 400) continue;
    if (!isSubtitleText(text)) continue;

    if (!isLiveCaptionCandidate(el, vr)) continue;

    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Fast-path / fallback orchestration
// ---------------------------------------------------------------------------

/**
 * One repair pass. Tries the current container first, then the stored
 * selector, then a bounded scan of the video subtree. Returns the element
 * to use as `activeContainerEl`, or null if nothing valid was found.
 *
 * Rate-limited by the caller, not by itself — the observer applies the
 * cooldown.
 */
function recoverCaption(state: ContentState): HTMLElement | null {
  // 1. Current container if it's still plausible.
  if (isPlausibleCaptionContainer(state.activeContainerEl)) {
    return state.activeContainerEl;
  }

  // 2. Stored selector, if it resolves to something plausible.
  const selector = state.settings.lockedSelector;
  if (selector) {
    try {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (isPlausibleCaptionContainer(el)) return el;
    } catch (_) {
      // Invalid selector syntax.
    }
  }

  // 3. Bounded scan of the video subtree for a live caption.
  const video = findObservedVideo(state);
  if (video) {
    const caption = findCaptionInVideo(video);
    if (caption) return caption;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * One-shot repair. Called by the app on lifecycle events (resize, settings
 * change). The observer does the steady-state work; this function exists
 * for the cases where the app knows a change just happened and doesn't
 * want to wait for the next mutation.
 */
export function maintainLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  const selector = state.settings.lockedSelector;
  if (!selector) return;

  const next = recoverCaption(state);
  if (next !== state.activeContainerEl) {
    state.activeContainerEl = next;
    if (next) startLockedMonitor(state, onTextChange);
    else stopLockedMonitor(state);
    state.notify();
  }
}

/**
 * Stop observing. Called on unlock, on mode change, and internally when
 * the container is cleared.
 */
export function stopLockedMonitor(state: ContentState): void {
  state.lockedContainerObserver?.disconnect();
  state.lockedContainerObserver = null;
  lastNotifiedText = '';
}

/**
 * Attach a MutationObserver to the video's player subtree.
 *
 * Scope is `video.parentElement.parentElement` — the same scope the
 * geometric walk uses. It reaches captions that live as siblings of the
 * video wrapper (most modern players) as well as captions that live
 * inside it (older players).
 *
 * The observer does two jobs on every mutation:
 *
 *   1. Fast-path validation. If the current container is still plausible,
 *      nothing else happens. This is the common case during normal
 *      playback and it costs one `querySelector` + one rect read.
 *
 *   2. Recovery. If the fast path fails, one bounded scan runs (rate-
 *      limited to SCAN_COOLDOWN_MS). The scan either finds the new caption
 *      (cue transition) or returns nothing (silence, ad, teardown). In the
 *      latter case the container is cleared and the box hides.
 *
 * There is no timer. Every trigger comes from the page itself.
 */
export function startLockedMonitor(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  stopLockedMonitor(state);

  const video = findObservedVideo(state);
  if (!video) return;

  // The observer scope. Contains both the video wrapper and — on players
  // where captions live in a sibling layer — the caption layer.
  const scope = video.parentElement?.parentElement ?? video.parentElement;
  if (!scope) return;

  const observer = new MutationObserver(() => {
    // ---- Fast path: is the current container still valid? ----
    let active = state.activeContainerEl;

    if (!isPlausibleCaptionContainer(active)) {
      // ---- Recovery: bounded, rate-limited scan. ----
      const now = performance.now();
      if (now - lastScanAt < SCAN_COOLDOWN_MS) return;
      lastScanAt = now;

      active = recoverCaption(state);
      state.activeContainerEl = active;
    }

    if (!active) {
      // Nothing valid right now. Clear visible output; keep the observer
      // running so the next mutation can re-attach.
      if (state.bilingualSubtitleText !== '' || state.lastObservedSubtitleText !== '') {
        state.bilingualSubtitleText = '';
        state.lastObservedSubtitleText = '';
        state.notify();
      }
      lastNotifiedText = '';
      return;
    }

    // ---- Text change detection ----
    const text = normalizeSubtitleText(active.textContent ?? '');

    if (text === lastNotifiedText) return;
    lastNotifiedText = text;

    const isRealCue = text.length > 0 && isSubtitleText(text);
    if (!isRealCue) {
      // Between cues: clear visible output so the box hides.
      if (state.bilingualSubtitleText !== '' || state.lastObservedSubtitleText !== '') {
        state.bilingualSubtitleText = '';
        state.lastObservedSubtitleText = '';
      }
      state.notify();
      return;
    }

    // Real cue. Reposition the box immediately, then hand off to the
    // translation pipeline (which is a no-op in hover/click modes and
    // produces a translation in full-auto / replace-native modes).
    state.notify();
    if (onTextChange) onTextChange(text);
  });

  observer.observe(scope, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  state.lockedContainerObserver = observer;
}

/**
 * Used by the app on settings change and lifecycle events. Delegates to
 * `maintainLockedContainer`, which is now a one-shot repair.
 */
export function reattachLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): HTMLElement | null {
  maintainLockedContainer(state, onTextChange);
  return state.activeContainerEl;
}