// locking/LockedAnchor.ts

import { getVideoForElement, getVideoSignature, measureGlyphBounds } from '../../utils/dom';
import { normalizeSubtitleText, isSubtitleText } from '../../utils/text';
import { getSubtitlePresentationAncestor, hasSubtitleClass } from '../detection/CandidateScorer';
import type { LockedSubtitleAnchor } from '../state/types';

/**
 * Snapshot the current visual identity of a subtitle element.
 *
 * The snapshot is expressed as ratios relative to the containing video (when
 * one is available) so it survives player resizes and layout shifts. Falls
 * back to viewport ratios when no video is found.
 *
 * Returns null when the element has no usable geometry.
 */
export function createLockedAnchor(element: HTMLElement): LockedSubtitleAnchor | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const video = getVideoForElement(element);
  const videoRect = video?.getBoundingClientRect() ?? null;

  const centerXRatio =
    videoRect && videoRect.width > 0
      ? (rect.left + rect.width / 2 - videoRect.left) / videoRect.width
      : (rect.left + rect.width / 2) / Math.max(1, window.innerWidth);

  const centerYRatio =
    videoRect && videoRect.height > 0
      ? (rect.top + rect.height / 2 - videoRect.top) / videoRect.height
      : (rect.top + rect.height / 2) / Math.max(1, window.innerHeight);

  const widthRatio =
    videoRect && videoRect.width > 0
      ? rect.width / videoRect.width
      : rect.width / Math.max(1, window.innerWidth);

  const heightRatio =
    videoRect && videoRect.height > 0
      ? rect.height / videoRect.height
      : rect.height / Math.max(1, window.innerHeight);

  return {
    centerXRatio,
    centerYRatio,
    widthRatio,
    heightRatio,
    absoluteRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    videoRect: videoRect
      ? { left: videoRect.left, top: videoRect.top, width: videoRect.width, height: videoRect.height }
      : null,
    videoSignature: getVideoSignature(video),
    textHint: normalizeSubtitleText(element.textContent || ''),
    updatedAt: performance.now(),
  };
}

/**
 * Read the currently visible subtitle text of a locked element, normalized.
 * Returns '' when the element is gone or empty.
 */
export function getCurrentLockedText(element: HTMLElement | null): string {
  if (!element || !element.isConnected) return '';
  return normalizeSubtitleText(element.textContent || '');
}

/**
 * A locked element is "healthy" when it still looks like a subtitle-sized
 * visual object that currently contains real subtitle text.
 *
 * This specifically rejects the case where a React/MUI player keeps the
 * wrapper node alive while its caption text is temporarily removed — the
 * wrapper survives but is no longer a valid subtitle.
 */
export function isHealthyLockedElement(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected) return false;

  const text = getCurrentLockedText(element);
  // An empty container between dialogue lines is normal. Only reject if text is present but not subtitle text.
  if (text && !isSubtitleText(text)) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const video = getVideoForElement(element);
  const tb = measureGlyphBounds(element);
  const contentWidth = tb ? tb.width : rect.width;
  const contentHeight = tb ? tb.height : rect.height;

  // A healthy locked element should still look like a subtitle-sized
  // visual object.
  if (contentWidth > window.innerWidth * 0.96) return false;
  if (!video && contentHeight > window.innerHeight * 0.30) return false;

  if (video) {
    const vr = video.getBoundingClientRect();
    if (vr.width > 0 && vr.height > 0) {
      if (contentWidth >= vr.width * 0.96) return false;
      if (contentHeight >= vr.height * 0.45) return false;

      // Reject elements that have drifted completely outside the video and its player shell
      if (rect.bottom < vr.top - 40 || rect.top > vr.bottom + 40) return false;
    }
  }

  return true;
}


/**
 * Stricter than `isHealthyLockedElement`: in addition to the size and text
 * checks, requires the element to be near the video it overlaps. Used when
 * deciding whether a freshly-grouped candidate is suitable as a new lock
 * target (as opposed to validating an existing lock).
 */
export function isValidSelectionTarget(element: HTMLElement, videoRect: DOMRect | null): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const tb = measureGlyphBounds(element);
  const contentWidth = tb ? tb.width : rect.width;
  const contentHeight = tb ? tb.height : rect.height;

  if (contentWidth > window.innerWidth * 0.96) return false;
  if (!videoRect && contentHeight > window.innerHeight * 0.30) return false;
  if (!isSubtitleText(normalizeSubtitleText(element.textContent || ''))) return false;

  if (videoRect) {
    if (contentWidth >= videoRect.width * 0.96) return false;
    if (contentHeight >= videoRect.height * 0.45) return false;
    if (rect.right < videoRect.left - 40 || rect.left > videoRect.right + 40) return false;
    if (rect.bottom < videoRect.top - 40 || rect.top > videoRect.bottom + 40) return false;
  }

  return true;
}

export function isLockedElementConnected(element: HTMLElement | null): boolean {
  if (!element) return false;
  return element.isConnected;
}