// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { normalizeSubtitleText, isSubtitleText } from '../../utils/text';
import { getVideoForElement, resolveCaptionLineContainer, getAllVideos, getKnownShadowRoots } from '../../utils/dom';
import { combineSubtitleLines } from '../detection/SubtitleGrouping';

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
 * Cooldown for the expensive recovery scan. The cheap selector
 * re-resolution path is not rate-limited — see the observer callback.
 */
const SCAN_COOLDOWN_MS = 80;

/**
 * Maximum horizontal slack, in pixels, between a child's rendered rect and
 * its parent's rendered rect before we conclude the parent is a layout-only
 * wrapper (a block element that fills its parent's width regardless of
 * content) rather than part of the caption itself.
 *
 * A tight caption leaf — an inline span whose box hugs its glyphs — is the
 * target. The first block-level ancestor will exceed it by hundreds of
 * pixels on a centered caption. Inline wrappers with padding will exceed it
 * by at most a few pixels. This constant is the boundary between those two
 * cases.
 */
const MAX_WRAPPER_SLACK_PX = 40;

// ---------------------------------------------------------------------------
// Module-scope runtime state (per content-script instance)
// ---------------------------------------------------------------------------

// Runtime state is stored on ContentState (lockedPositionRafId, lockedPositionKey,
// lockedLastNotifiedText, lockedLastScanAt) to prevent cross-frame/multi-instance collisions.

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Union of the on-screen glyph bounds of every caption text node inside
 * `root`, excluding text inside interactive controls and the extension's
 * own overlay.
 *
 * Uses a Range over individual TEXT NODES, never over an element.
 * `Range.selectNodeContents(blockElement)` can return the block's line-box
 * (full container width) even when the visible glyphs occupy only a small
 * centered span. A Range over a text node always returns the actual
 * rendered run.
 */
function textBounds(root: Element): DOMRect | null {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ?? '';
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(CONTROL_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('#subany-extension-root')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  let found = false;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rr of Array.from(range.getClientRects())) {
      if (rr.width <= 0 && rr.height <= 0) continue;
      if (rr.left < l) l = rr.left;
      if (rr.top < t) t = rr.top;
      if (rr.right > r) r = rr.right;
      if (rr.bottom > b) b = rr.bottom;
      found = true;
    }
  }

  if (!found) return null;
  return new DOMRect(l, t, r - l, b - t);
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function isExtensionElement(el: HTMLElement): boolean {
  return el.id === 'subany-extension-root' || !!el.id?.startsWith('subany-');
}

function containsInteractiveControls(el: HTMLElement): boolean {
  return el.querySelector(CONTROL_SELECTOR) !== null;
}

/**
 * A "plausible caption container" is one that could be showing a subtitle
 * right now, or could be about to. Text is allowed to be empty, because on
 * many players the caption wrapper sits empty between cues and fills in
 * again when the next one starts.
 *
 * Disqualifiers, in ascending cost:
 *   1. Detached from the document, or is one of our own overlay nodes.
 *   2. Contains an interactive control (button, slider, contenteditable).
 *   3. Has zero area.
 *   4. Text is too long, or doesn't look like a subtitle.
 *   5. Layout box is materially wider than its rendered text — this is a
 *      block-level wrapper that fills its parent by layout, not by content.
 *
 * Check #5 is the one that keeps the dashed border tight on players that
 * wrap a small centered caption in a full-width block.
 */
function isPlausibleCaptionContainer(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  if (isExtensionElement(el)) return false;
  if (containsInteractiveControls(el)) return false;

  const text = normalizeSubtitleText(el.textContent ?? '');
  if (text.length === 0) return true; // between cues (inline span may collapse to 0x0)
  if (text.length > 400) return false;
  if (!isSubtitleText(text)) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const tb = textBounds(el);
  if (tb && rect.width - tb.width > MAX_WRAPPER_SLACK_PX) {
    const elText = normalizeSubtitleText(el.textContent ?? '').replace(/\s+/g, '');
    const hasTighterTextChild = Array.from(el.children).some((child) => {
      const c = child as HTMLElement;
      const cText = normalizeSubtitleText(c.textContent ?? '').replace(/\s+/g, '');
      if (cText && cText === elText) {
        const cRect = c.getBoundingClientRect();
        return cRect.width > 0 && rect.width - cRect.width > MAX_WRAPPER_SLACK_PX;
      }
      return false;
    });

    if (hasTighterTextChild) return false;
  }

  return true;
}

/**
 * A stricter check used only during the recovery scan. The scan is looking
 * for a caption that is *currently visible*, so empty text disqualifies.
 */
function isLiveCaptionCandidate(el: HTMLElement, videoRect: DOMRect): boolean {
  if (isExtensionElement(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return false;
  if (containsInteractiveControls(el)) return false;

  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;

  // Must be in or near the video bounding box (rejects other players or off-screen elements)
  if (
    r.right < videoRect.left - 40 ||
    r.left > videoRect.right + 40 ||
    r.bottom < videoRect.top - 40 ||
    r.top > videoRect.bottom + 40
  ) {
    return false;
  }

  // Must contain plausible subtitle text.
  const text = normalizeSubtitleText(el.textContent ?? '');
  if (text.length < 2 || text.length > 400) return false;
  if (!isSubtitleText(text)) return false;

  // Reject player wrappers/layers (full video size).
  const tb = textBounds(el);
  const contentWidth = tb ? tb.width : r.width;
  const contentHeight = tb ? tb.height : r.height;
  if (contentWidth > videoRect.width * 0.95 && contentHeight > videoRect.height * 0.35) return false;
  if (r.width > videoRect.width * 0.95 && r.height > videoRect.height * 0.45) return false;

  // Reject full-width block wrappers that only *contain* the caption,
  // BUT do not reject legitimate multi-line containers whose children
  // are separate subtitle lines (e.g. karaoke lines, dual subtitles).
  if (tb && r.width - tb.width > MAX_WRAPPER_SLACK_PX) {
    const elText = normalizeSubtitleText(el.textContent ?? '').replace(/\s+/g, '');
    const hasTighterTextChild = Array.from(el.children).some((child) => {
      const c = child as HTMLElement;
      const cText = normalizeSubtitleText(c.textContent ?? '').replace(/\s+/g, '');
      if (cText && cText === elText) {
        const cRect = c.getBoundingClientRect();
        return cRect.width > 0 && r.width - cRect.width > MAX_WRAPPER_SLACK_PX;
      }
      return false;
    });

    if (hasTighterTextChild) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Container resolution (used once, at click time)
// ---------------------------------------------------------------------------

/**
 * Walk up from a clicked subtitle leaf to the tightest element that still
 * contains only the caption.
 *
 * Checks if the ancestor hugs its rendered text glyphs (textBounds)
 * rather than comparing single-child width to parent width (which would
 * prematurely break on multi-span captions).
 */
export function resolveStableContainer(
  clickedElement: HTMLElement,
  videoRect: DOMRect | null,
): HTMLElement {
  const lineTarget = resolveCaptionLineContainer(clickedElement, videoRect);
  const groupTarget = combineSubtitleLines(lineTarget, videoRect);
  let current: HTMLElement = groupTarget;
  let best: HTMLElement = groupTarget;
  for (let i = 0; i < 6; i++) {
    const parent = current.parentElement;
    if (!parent) break;
    const ownerDoc = parent.ownerDocument || document;
    if (parent === ownerDoc.body || parent === ownerDoc.documentElement) break;
    if (parent.tagName.toLowerCase() === 'video') break;
    if (parent.classList.contains('html5-video-player') || parent.classList.contains('video-stream')) break;
    if (parent.matches('video, button, input, [role="button"], [role="slider"]')) break;
    if (containsInteractiveControls(parent)) break;

    // Explicit caption-window class: trust it even if it is wide. This is
    // the player telling us "this element is the caption surface", which
    // overrides the geometric heuristic.
    const className = typeof parent.className === 'string' ? parent.className : '';
    const isExplicitCaptionWindow =
      /(caption-window|ytp-caption-window|subtitle-window|captions-display|cue-container)/i.test(className) &&
      !className.includes('caption-window-container');
    if (isExplicitCaptionWindow) return parent;

    const parentRect = parent.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();

    // Check whether the parent hugs its text contents.
    // If the parent contains multiple sibling subtitle lines (karaoke, dual subtitles),
    // it is only an unnecessary wrapper if a single child already contains all of its text.
    const tb = textBounds(parent);
    if (tb && parentRect.width - tb.width > MAX_WRAPPER_SLACK_PX) {
      const parentText = normalizeSubtitleText(parent.textContent ?? '').replace(/\s+/g, '');
      const hasTighterTextChild = Array.from(parent.children).some((child) => {
        const c = child as HTMLElement;
        const cText = normalizeSubtitleText(c.textContent ?? '').replace(/\s+/g, '');
        if (cText && cText === parentText) {
          const cRect = c.getBoundingClientRect();
          return cRect.width > 0 && parentRect.width - cRect.width > MAX_WRAPPER_SLACK_PX;
        }
        return false;
      });

      if (hasTighterTextChild) break;
    } else if (!tb && parentRect.width - currentRect.width > MAX_WRAPPER_SLACK_PX) {
      break;
    }

    if (videoRect) {
      const contentWidth = tb ? tb.width : parentRect.width;
      const contentHeight = tb ? tb.height : parentRect.height;
      if (contentWidth > videoRect.width * 0.95) break;
      if (contentHeight > videoRect.height * 0.40) break;
      if (parentRect.height > videoRect.height * 0.45 && parentRect.width > videoRect.width * 0.90) break;
    }

    best = parent;
    current = parent;
  }

  return best;
}

// ---------------------------------------------------------------------------
// Video discovery
// ---------------------------------------------------------------------------

function findFirstVideo(state?: ContentState): HTMLVideoElement | null {
  const doc = state?.activeContainerEl?.ownerDocument ?? document;
  const videos = getAllVideos(doc);
  return videos.find((v) => {
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? videos[0] ?? null;
}

function findObservedVideo(state: ContentState): HTMLVideoElement | null {
  if (state.lockedVideoElement && state.lockedVideoElement.isConnected) {
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
  return findFirstVideo(state);
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
 * runs at most once per SCAN_COOLDOWN_MS, and only when the cheap selector
 * re-resolution has already failed.
 */
function findCaptionInVideo(video: HTMLVideoElement): HTMLElement | null {
  const vr = video.getBoundingClientRect();
  if (vr.width <= 0 || vr.height <= 0) return null;

  const rootNode = video.getRootNode();
  const scope = video.parentElement?.parentElement ?? video.parentElement ?? (rootNode instanceof ShadowRoot ? (rootNode as ShadowRoot).firstElementChild as HTMLElement | null : null);
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

  return best ? resolveCaptionLineContainer(best, vr) : null;
}

// ---------------------------------------------------------------------------
// Cheap selector re-resolution
// ---------------------------------------------------------------------------

/**
 * Try to re-resolve the stored selector to a live, plausible container.
 *
 * This is cheap — one `querySelector` plus one rect read — so it is safe to
 * run on every mutation, without any cooldown. Players frequently replace
 * the caption node per cue (rather than mutating its text in place), and
 * when they do, this recovers the container within the same mutation
 * delivery, so even very short cues are tracked for their full duration.
 */
function tryResolveFromSelector(state: ContentState): HTMLElement | null {
  const selector = state.settings.lockedSelector;
  if (!selector) return null;

  let el: HTMLElement | null = null;
  const doc = state.activeContainerEl?.ownerDocument ?? findObservedVideo(state)?.ownerDocument ?? document;
  try {
    el = doc.querySelector(selector) as HTMLElement | null;
    if (!el && doc !== document) {
      el = document.querySelector(selector) as HTMLElement | null;
    }
  } catch (_) {
    return null;
  }

  if (!el) {
    const video = findObservedVideo(state);
    const root = (video?.getRootNode() ?? state.activeContainerEl?.getRootNode()) as ShadowRoot | Document | null;
    if (root && root !== document && typeof root.querySelector === 'function') {
      try {
        el = root.querySelector(selector) as HTMLElement | null;
      } catch (_) {}
    }
    if (!el) {
      for (const sr of getKnownShadowRoots()) {
        try {
          el = sr.querySelector(selector) as HTMLElement | null;
          if (el) break;
        } catch (_) {}
      }
    }
  }

  if (!el) return null;
  if (!isPlausibleCaptionContainer(el)) return null;
  return el;
}

// ---------------------------------------------------------------------------
// Fast-path / fallback orchestration
// ---------------------------------------------------------------------------

/**
 * One repair pass. Tries the current container first, then the stored
 * selector, then a bounded scan of the video subtree.
 */
function recoverCaption(state: ContentState): HTMLElement | null {
  if (isPlausibleCaptionContainer(state.activeContainerEl)) {
    return state.activeContainerEl;
  }

  const fromSelector = tryResolveFromSelector(state);
  if (fromSelector) return fromSelector;

  const video = findObservedVideo(state);
  if (video) {
    const caption = findCaptionInVideo(video);
    if (caption) return caption;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Position tracking (RAF)
// ---------------------------------------------------------------------------

/**
 * Bounded requestAnimationFrame loop while locked.
 *
 * Purpose: some players move the caption with `transform`, `top`, or
 * `left` during a control-bar fade. None of those produce a DOM mutation
 * (nothing to observe), nor a `ResizeObserver` entry (the size does not
 * change), nor a `scroll` event. The only reliable primitive is a per-frame
 * rect read while the lock is active.
 *
 * Cost: one `getBoundingClientRect()` and one string compare per frame —
 * well under 0.01 ms. `notify()` is only called when the rect actually
 * changed, so the React tree re-renders only during a real move.
 *
 * `requestAnimationFrame` is paused automatically when the tab is hidden,
 * so there is no cost for background tabs.
 */
function startPositionTracking(state: ContentState): void {
  stopPositionTracking(state);
  state.lockedPositionKey = '';

  const win = state.activeContainerEl?.ownerDocument?.defaultView || window;

  const tick = (): void => {
    // Only stop if the lock has been cleared/cancelled.
    if (!state.lockedContainerObserver && !state.settings.lockedSelector) {
      state.lockedPositionRafId = 0;
      return;
    }

    let el = state.activeContainerEl;
    if (!el || !el.isConnected) {
      el = tryResolveFromSelector(state);
      if (el) state.activeContainerEl = el;
    }

    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      const tb = textBounds(el);
      if (r.width > 0 && r.height > 0) {
        const tbKey = tb ? `|tb:${tb.left.toFixed(1)}:${tb.top.toFixed(1)}:${tb.width.toFixed(1)}:${tb.height.toFixed(1)}` : '';
        const key =
          `${r.left.toFixed(1)}:${r.top.toFixed(1)}:` +
          `${r.width.toFixed(1)}:${r.height.toFixed(1)}` + tbKey;

        if (key !== state.lockedPositionKey) {
          state.lockedPositionKey = key;
          state.notify();
        }
      }
    }

    const currentWin = state.activeContainerEl?.ownerDocument?.defaultView || win;
    state.lockedPositionRafId = currentWin.requestAnimationFrame(tick);
  };

  state.lockedPositionRafId = win.requestAnimationFrame(tick);
}

function stopPositionTracking(state: ContentState): void {
  if (state.lockedPositionRafId) {
    const win = state.activeContainerEl?.ownerDocument?.defaultView || window;
    win.cancelAnimationFrame(state.lockedPositionRafId);
    state.lockedPositionRafId = 0;
  }
  state.lockedPositionKey = '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * One-shot repair. Called by the app on lifecycle events (resize, settings
 * change). The observer does the steady-state work; this function exists
 * for cases where the app knows a change just happened and doesn't want to
 * wait for the next mutation.
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
 * Stop observing. Called on unlock, on mode change, and internally when the
 * container is cleared.
 */
export function stopLockedMonitor(state: ContentState): void {
  state.lockedContainerObserver?.disconnect();
  state.lockedContainerObserver = null;

  // These two are no longer attached by this module (RAF replaced them),
  // but they are still cleared defensively in case an older instance of
  // the extension left them set on the state object.
  state.lockedPositionObserver?.disconnect();
  state.lockedPositionObserver = null;
  state.lockedPositionEventTarget = null;
  state.lockedPositionEventHandler = null;

  state.lastLockedRect = null;
  state.lockedLastNotifiedText = '';
  state.lockedLastScanAt = 0;
  stopPositionTracking(state);
}

/**
 * Attach a MutationObserver to the video's player subtree, and start the
 * RAF position tracker.
 *
 * The observer does three jobs on every mutation batch, in ascending cost:
 *
 *   1. Fast-path validation. If the current container is still plausible,
 *      nothing else happens. Common case during steady playback, costs one
 *      `querySelector` and one rect read.
 *
 *   2. Cheap selector re-resolution. If the current container is gone,
 *      re-resolve the stored selector. Players frequently recreate the
 *      caption node per cue; this recovers the container without any
 *      cooldown, so even very short cues are picked up immediately.
 *
 *   3. Expensive recovery scan. Only if steps 1 and 2 both fail. Bounded
 *      walk of the player subtree, rate-limited to SCAN_COOLDOWN_MS to
 *      coalesce player-rebuild bursts.
 *
 * Position tracking (transform, control-bar slide) is handled separately
 * by the RAF loop, because none of those motions produce a mutation.
 */
export function startLockedMonitor(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  stopLockedMonitor(state);

  const video = findObservedVideo(state);
  if (!video) return;

  const rootNode = video.getRootNode();
  const scope = video.parentElement?.parentElement ?? video.parentElement ?? (rootNode instanceof ShadowRoot ? rootNode : null);
  if (!scope) return;

  const observer = new MutationObserver(() => {
    // ---- Step 1: is the current container still valid? ----
    let active = state.activeContainerEl;

    if (!isPlausibleCaptionContainer(active)) {
      // ---- Step 2: cheap selector re-resolution (no cooldown). ----
      const fromSelector = tryResolveFromSelector(state);
      if (fromSelector) {
        active = fromSelector;
        state.activeContainerEl = fromSelector;
        // Reset the cooldown budget: we just proved the DOM is in a
        // healthy state, so a subsequent burst should not be blocked by
        // a stale timestamp from before this recovery.
        state.lockedLastScanAt = performance.now();
      } else {
        // ---- Step 3: expensive recovery, rate-limited. ----
        const now = performance.now();
        if (now - state.lockedLastScanAt < SCAN_COOLDOWN_MS) return;
        state.lockedLastScanAt = now;

        active = recoverCaption(state);
        state.activeContainerEl = active;
      }
    }

    if (!active) {
      // Nothing valid right now. Clear visible output; keep the observer
      // running so the next mutation can re-attach.
      if (state.bilingualSubtitleText !== '' || state.lastObservedSubtitleText !== '') {
        state.bilingualSubtitleText = '';
        state.lastObservedSubtitleText = '';
        state.notify();
      }
      state.lockedLastNotifiedText = '';
      return;
    }

    // ---- Text change detection ----
    const text = normalizeSubtitleText(active.textContent ?? '');
    if (text === state.lockedLastNotifiedText) return;
    state.lockedLastNotifiedText = text;

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
    // translation pipeline (no-op in hover/click modes, translation in
    // full-auto / replace-native modes).
    if (!state.lockedPositionRafId) {
      startPositionTracking(state);
    }
    state.notify();
    if (onTextChange) onTextChange(text);
  });

  observer.observe(scope, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  state.lockedContainerObserver = observer;

  // Follow position-only motion (transform, control-bar slide, scroll,
  // video resize) with a single bounded RAF loop.
  startPositionTracking(state);
}

/**
 * Used by the app on settings change and lifecycle events. Delegates to
 * `maintainLockedContainer`, which is a one-shot repair.
 */
export function reattachLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): HTMLElement | null {
  maintainLockedContainer(state, onTextChange);
  return state.activeContainerEl;
}