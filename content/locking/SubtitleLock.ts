// locking/SubtitleLock.ts

import type { ContentState } from '../state/ContentState';
import { getVideoSignature } from '../../utils/dom';
import {
  createLockedAnchor,
  isHealthyLockedElement,
} from './LockedAnchor';

/**
 * Lazily create the invisible proxy element used by SubtitleOverlay when the
 * live locked element is currently detached/empty but we still want the
 * overlay to render at the remembered anchor location.
 */
export function ensureLockedVisualProxy(state: ContentState): HTMLDivElement {
  if (state.lockedVisualProxyEl) return state.lockedVisualProxyEl;

  const proxy = document.createElement('div');
  proxy.id = 'subany-locked-visual-proxy';
  proxy.setAttribute('aria-hidden', 'true');
  proxy.style.position = 'fixed';
  proxy.style.margin = '0';
  proxy.style.padding = '0';
  proxy.style.border = '0';
  proxy.style.pointerEvents = 'none';
  proxy.style.opacity = '0';
  proxy.style.background = 'transparent';
  proxy.style.visibility = 'visible';
  proxy.style.zIndex = '2147483646';
  proxy.style.boxSizing = 'border-box';
  proxy.style.display = 'block';
  document.documentElement.appendChild(proxy);

  state.lockedVisualProxyEl = proxy;
  state.lockedVisualProxyStyle = proxy.style;
  return proxy;
}

/**
 * Keep the visual proxy glued to the anchor. Prefers the live element when it
 * is present, otherwise falls back to ratio-projection onto the current video,
 * and finally to the stored absolute rect.
 */
export function updateLockedVisualProxy(state: ContentState): void {
  if (!state.lockedSubtitleAnchor) return;
  const proxy = ensureLockedVisualProxy(state);
  const style = state.lockedVisualProxyStyle ?? proxy.style;

  let rect: { left: number; top: number; width: number; height: number } | null = null;

  if (state.activeContainerEl && document.documentElement.contains(state.activeContainerEl)) {
    const live = state.activeContainerEl.getBoundingClientRect();
    if (live.width > 0 && live.height > 0) {
      rect = { left: live.left, top: live.top, width: live.width, height: live.height };
    }
  }

  const currentLockedVideo = findCurrentLockedVideo(state);
  if (!rect && currentLockedVideo) {
    const vr = currentLockedVideo.getBoundingClientRect();
    if (vr.width > 0 && vr.height > 0) {
      rect = {
        left: vr.left + state.lockedSubtitleAnchor.centerXRatio * vr.width - (state.lockedSubtitleAnchor.widthRatio * vr.width) / 2,
        top: vr.top + state.lockedSubtitleAnchor.centerYRatio * vr.height - (state.lockedSubtitleAnchor.heightRatio * vr.height) / 2,
        width: state.lockedSubtitleAnchor.widthRatio * vr.width,
        height: state.lockedSubtitleAnchor.heightRatio * vr.height,
      };
    }
  }

  if (!rect && state.lockedSubtitleAnchor.videoRect) {
    const vr = state.lockedSubtitleAnchor.videoRect;
    rect = {
      left: vr.left + state.lockedSubtitleAnchor.centerXRatio * vr.width - (state.lockedSubtitleAnchor.widthRatio * vr.width) / 2,
      top: vr.top + state.lockedSubtitleAnchor.centerYRatio * vr.height - (state.lockedSubtitleAnchor.heightRatio * vr.height) / 2,
      width: state.lockedSubtitleAnchor.widthRatio * vr.width,
      height: state.lockedSubtitleAnchor.heightRatio * vr.height,
    };
  }

  if (!rect) return;

  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  style.left = `${Math.round(rect.left * 100) / 100}px`;
  style.top = `${Math.round(rect.top * 100) / 100}px`;
  style.width = `${Math.round(width * 100) / 100}px`;
  style.height = `${Math.round(height * 100) / 100}px`;
}

export function removeLockedVisualProxy(state: ContentState): void {
  state.lockedVisualProxyEl?.remove();
  state.lockedVisualProxyEl = null;
  state.lockedVisualProxyStyle = null;
}

/**
 * Resolve the video that the lock is attached to, in priority order:
 *   1. The cached `lockedVideoElement` if it is still mounted and visible.
 *   2. A video whose source+aspect signature matches `lockedVideoSignature`.
 *   3. The video whose rect is geometrically closest to the stored
 *      `lockedSubtitleAnchor.videoRect`.
 *
 * Returns null if nothing matches (e.g. the player has been torn down).
 */
export function findCurrentLockedVideo(state: ContentState): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  if (state.lockedVideoElement && document.documentElement.contains(state.lockedVideoElement)) {
    const rect = state.lockedVideoElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return state.lockedVideoElement;
  }

  if (state.lockedVideoSignature) {
    const bySignature = videos.find((video) => getVideoSignature(video) === state.lockedVideoSignature);
    if (bySignature) {
      state.lockedVideoElement = bySignature;
      return bySignature;
    }
  }

  if (state.lockedSubtitleAnchor?.videoRect) {
    const target = state.lockedSubtitleAnchor.videoRect;
    let best: HTMLVideoElement | null = null;
    let bestDistance = Infinity;

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const distance =
        Math.abs(rect.left - target.left) +
        Math.abs(rect.top - target.top) +
        Math.abs(rect.width - target.width) +
        Math.abs(rect.height - target.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = video;
      }
    }

    if (best) {
      state.lockedVideoElement = best;
      state.lockedVideoSignature = getVideoSignature(best);
      return best;
    }
  }

  return null;
}

/**
 * Snapshot the element as the current locked anchor and update the proxy.
 * Called after a fresh user lock and after every successful recovery.
 */
export function rememberLockedAnchor(state: ContentState, element: HTMLElement): void {
  const anchor = createLockedAnchor(element);
  if (!anchor) return;

  state.lockedSubtitleAnchor = anchor;
  state.lockedVideoSignature = anchor.videoSignature || '';

  // Refresh the cached video element alongside the anchor.
  const currentLockedVideo = findCurrentLockedVideo(state);
  if (currentLockedVideo) {
    state.lockedVideoElement = currentLockedVideo;
  }

  updateLockedVisualProxy(state);
}

/**
 * Swap `activeContainerEl` to a new element that represents the same logical
 * locked subtitle. When `updateAnchor` is true, the anchor ratios are also
 * refreshed (used after a real geometry change or a fresh lock).
 */
export function setLockedActiveContainer(
  state: ContentState,
  element: HTMLElement,
  updateAnchor = true,
): void {
  if (!element || !document.documentElement.contains(element)) return;
  state.activeContainerEl = element;
  if (updateAnchor) rememberLockedAnchor(state, element);
  else updateLockedVisualProxy(state);
  state.notify();
}

/**
 * Tear down all in-memory lock state. Storage + subtitleManager side effects
 * are handled by ContentApp's `unlockContainer` wrapper; this is the local
 * reset only.
 */
export function resetLockState(state: ContentState): void {
  state.activeContainerEl = null;
  state.lockedSubtitleAnchor = null;
  state.lockedVideoElement = null;
  state.lockedVideoSignature = '';
  removeLockedVisualProxy(state);
}