// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { normalizeSubtitleText } from '../../utils/text';

/**
 * Walk up from a clicked subtitle leaf to the stable caption container.
 *
 * Purely geometric:
 *   - Reject any ancestor that contains buttons, sliders, or the video.
 *   - Reject any ancestor wider than 90% of the video AND taller than 15%
 *     (this is the player wrapper).
 *   - Reject any ancestor wider than 98% of the video.
 *   - Reject any ancestor taller than 35% of the video (capped at 300px).
 *
 * Among the ancestors that survive, prefer one whose class name contains
 * caption/cue/timedtext (this is a strong, portable signal — every player
 * names caption layers similarly). If none, use the highest surviving
 * ancestor, which is the caption container on every layout we've tested.
 */
export function resolveStableContainer(clickedElement: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  let current: HTMLElement | null = clickedElement;
  let bestContainer: HTMLElement = clickedElement;
  let highestStable: HTMLElement = clickedElement;
  const controlSelector = 'video, button, input, [role="button"], [role="slider"]';

  for (let i = 0; i < 6 && current && current !== document.body && current !== document.documentElement; i++) {
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

    // Explicit caption-window match wins immediately. This is the leaf-most
    // stable container across every player we've tested.
    const isExplicitCaptionWindow =
      /(caption-window|ytp-caption-window|subtitle-window|captions-display|cue-container)/i.test(className) &&
      !className.includes('caption-window-container');
    if (isExplicitCaptionWindow) {
      return current;
    }

    // Semantic class match: remember it, but keep walking in case there is
    // an even more specific one above.
    if (/(caption|subtitle|cue|timedtext)/i.test(className) && !className.startsWith('subany-')) {
      bestContainer = current;
    }

    // Track the highest stable ancestor as fallback.
    highestStable = current;

    current = current.parentElement;
  }

  return bestContainer !== clickedElement ? bestContainer : highestStable;
}

/**
 * Zero-scan lock maintenance.
 *
 * Fast path: `activeContainerEl` is connected → no-op.
 * Slow path: one `querySelector` on the stored selector.
 * If the selector cannot resolve, drop the active container but KEEP the
 * selector — the player may rebuild the caption container on the next cue,
 * and the selector will match it again.
 */
export function maintainLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  const selector = state.settings.lockedSelector;
  if (!selector) return;

  // Fast path.
  if (state.activeContainerEl && document.documentElement.contains(state.activeContainerEl)) {
    return;
  }

  // Slow path: single query, no scan.
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el && document.documentElement.contains(el)) {
      state.activeContainerEl = el;
      startLockedMonitor(state, onTextChange);
      state.notify();
      return;
    }
  } catch (_) {
    // Invalid selector syntax.
  }

  // Container genuinely absent. Clear the active element but DO NOT clear
  // the selector. The user's lock survives across silent gaps between cues.
  if (state.activeContainerEl !== null) {
    state.activeContainerEl = null;
    state.notify();
  }
}

export function stopLockedMonitor(state: ContentState): void {
  state.lockedContainerObserver?.disconnect();
  state.lockedContainerObserver = null;
}

/**
 * Attach the MutationObserver to the locked container.
 *
 * The observer watches childList + subtree + characterData on the container
 * itself. This fires on every cue change with zero layout cost, because it
 * reads `textContent` (V8 string property) rather than `innerText`.
 */
export function startLockedMonitor(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  stopLockedMonitor(state);

  const container = state.activeContainerEl;
  if (!container || !onTextChange) return;

  const observer = new MutationObserver(() => {
    const nextText = normalizeSubtitleText(container.textContent ?? '');
    if (nextText === state.lastObservedSubtitleText) return;

    if (!nextText) {
      // Empty cue between sentences. Clear the display, keep the lock.
      state.bilingualSubtitleText = '';
      state.lastObservedSubtitleText = '';
      state.notify();
    } else {
      onTextChange(nextText);
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  state.lockedContainerObserver = observer;
}

export function reattachLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): HTMLElement | null {
  maintainLockedContainer(state, onTextChange);
  return state.activeContainerEl;
}