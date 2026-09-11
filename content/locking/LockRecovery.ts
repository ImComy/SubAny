// locking/LockRecovery.ts

import type { ContentState } from '../state/ContentState';
import { getAllElements, getVideoForElement, getVideoSignature } from '../../utils/dom';
import { isUsableSubtitleLine, combineSubtitleLines } from '../detection/SubtitleGrouping';
import {
  findCurrentLockedVideo,
  rememberLockedAnchor,
  setLockedActiveContainer,
} from './SubtitleLock';
import { getCurrentLockedText, isHealthyLockedElement } from './LockedAnchor';

/**
 * Score a candidate element as a replacement for the currently locked anchor.
 *
 * The higher the score, the more the candidate looks like the same subtitle
 * the user locked: same video, same ratio-position inside that video, similar
 * width/height, and ideally a matching text prefix.
 *
 * Returns -Infinity when the candidate is disqualified outright (e.g. wrong
 * video, not a usable subtitle line).
 */
export function scoreLockedReplacement(state: ContentState, candidate: HTMLElement): number {
  const anchor = state.lockedSubtitleAnchor;
  if (!anchor) return -Infinity;
  if (!isUsableSubtitleLine(candidate, null)) return -Infinity;

  const candidateVideo = getVideoForElement(candidate);
  const candidateVideoRect = candidateVideo?.getBoundingClientRect() ?? null;
  const rect = candidate.getBoundingClientRect();
  const currentLockedVideo = findCurrentLockedVideo(state);
  const expectedSignature =
    state.lockedVideoSignature ||
    anchor.videoSignature ||
    (currentLockedVideo ? getVideoSignature(currentLockedVideo) : '');

  if (expectedSignature) {
    if (!candidateVideo) return -Infinity;
    const candidateSignature = getVideoSignature(candidateVideo);
    if (!candidateSignature || candidateSignature !== expectedSignature) return -Infinity;
  }

  let expectedX: number;
  let expectedY: number;
  let expectedWidth: number;
  let expectedHeight: number;

  if (candidateVideoRect && candidateVideoRect.width > 0 && candidateVideoRect.height > 0) {
    expectedX = candidateVideoRect.left + anchor.centerXRatio * candidateVideoRect.width;
    expectedY = candidateVideoRect.top + anchor.centerYRatio * candidateVideoRect.height;
    expectedWidth = anchor.widthRatio * candidateVideoRect.width;
    expectedHeight = anchor.heightRatio * candidateVideoRect.height;
  } else {
    expectedX = anchor.centerXRatio * window.innerWidth;
    expectedY = anchor.centerYRatio * window.innerHeight;
    expectedWidth = anchor.widthRatio * window.innerWidth;
    expectedHeight = anchor.heightRatio * window.innerHeight;
  }

  const candidateCx = rect.left + rect.width / 2;
  const candidateCy = rect.top + rect.height / 2;
  const distance = Math.hypot(candidateCx - expectedX, candidateCy - expectedY);
  const scale = Math.max(22, Math.min(window.innerWidth, window.innerHeight) * 0.11);

  let score = 100 - Math.min(120, (distance / scale) * 48);

  const widthRatio = rect.width / Math.max(1, expectedWidth);
  if (widthRatio > 0.35 && widthRatio < 2.8) score += 20;
  else score -= 30;

  const heightRatio = rect.height / Math.max(1, expectedHeight);
  if (heightRatio > 0.25 && heightRatio < 3.2) score += 10;

  const text = getCurrentLockedText(candidate);
  if (anchor.textHint && text) {
    if (text === anchor.textHint) {
      score += 35;
    } else if (text.length >= 2 && anchor.textHint.length >= 2) {
      const prefixLength = Math.min(18, text.length, anchor.textHint.length);
      if (prefixLength >= 4 && text.slice(0, prefixLength) === anchor.textHint.slice(0, prefixLength)) {
        score += 10;
      }
    }
  }

  // A replacement should be somewhere in the same video/player as the
  // original lock. This is especially important on pages with multiple
  // video cards or recommendation players.
  if (anchor.videoRect && !candidateVideo) return score - 60;

  if (candidateVideo && anchor.videoRect) {
    const vr = anchor.videoRect;
    const sameVideoPosition =
      Math.abs(candidateVideoRect!.left - vr.left) < Math.max(40, vr.width * 0.15) &&
      Math.abs(candidateVideoRect!.top - vr.top) < Math.max(40, vr.height * 0.15) &&
      Math.abs(candidateVideoRect!.width - vr.width) < Math.max(120, vr.width * 0.20) &&
      Math.abs(candidateVideoRect!.height - vr.height) < Math.max(120, vr.height * 0.20);
    if (sameVideoPosition) score += 18;
    else score -= 24;
  }

  return score;
}

/**
 * Walk the document for a replacement element that matches the remembered
 * anchor. Returns a grouped (multi-line) element when possible, or null.
 *
 * Side effect: on success, refreshes the stored anchor ratios.
 */
export function findLockedReplacement(state: ContentState): HTMLElement | null {
  if (!state.lockedSubtitleAnchor) return null;

  const currentLockedVideo = findCurrentLockedVideo(state);
  if (
    state.lockedSubtitleAnchor.videoRect &&
    !currentLockedVideo &&
    !state.lockedVideoSignature &&
    !state.lockedSubtitleAnchor.videoSignature
  ) {
    return null;
  }

  const allElements = getAllElements(document);
  const candidates: HTMLElement[] = [];

  for (const el of allElements) {
    if (el === state.activeContainerEl) continue;
    if (!isUsableSubtitleLine(el, null)) continue;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.width > window.innerWidth * 0.96 || r.height > window.innerHeight * 0.30) continue;

    candidates.push(el);
  }

  let best: HTMLElement | null = null;
  let bestScore = 24;

  for (const candidate of candidates) {
    const score = scoreLockedReplacement(state, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best) return null;

  const video = getVideoForElement(best);
  const grouped = combineSubtitleLines(best, video?.getBoundingClientRect() ?? null);

  if (!isHealthyLockedElement(grouped)) {
    // The line itself can be healthy while the calculated common ancestor
    // is actually a large player wrapper. Fall back to the best line.
    if (!isHealthyLockedElement(best)) return null;
  }

  const finalElement = isHealthyLockedElement(grouped) ? grouped : best;
  rememberLockedAnchor(state, finalElement);
  return finalElement;
}

/**
 * Attempt to reattach the lock to a live element. Order:
 *   1. Fast path: re-query the stored selector; if it resolves to something
 *      healthy, use it (and re-group stacked lines if applicable).
 *   2. Logical recovery: search the document for a geometrically matching
 *      element via `findLockedReplacement`.
 *   3. Give up and return the current (possibly stale) container so the
 *      monitor can retry on the next event.
 */
export function tryRecoverLockedContainer(state: ContentState): HTMLElement | null {
  if (!state.settings.lockedSelector && !state.lockedSubtitleAnchor) {
    return state.activeContainerEl;
  }

  if (state.settings.lockedSelector) {
    try {
      const el = document.querySelector(state.settings.lockedSelector) as HTMLElement | null;
      if (isHealthyLockedElement(el)) {
        const healthyEl = el as HTMLElement;
        const video = getVideoForElement(healthyEl);
        const grouped = combineSubtitleLines(healthyEl, video?.getBoundingClientRect() ?? null);
        if (isHealthyLockedElement(grouped)) {
          setLockedActiveContainer(state, grouped);
          return grouped;
        }
      }
    } catch (_) {
      // Invalid/stale selector. Continue to logical recovery.
    }
  }

  const replacement = findLockedReplacement(state);
  if (replacement) {
    setLockedActiveContainer(state, replacement);
    return replacement;
  }

  // No visible cue right now. Keep the logical lock alive through the
  // empty-cue gap. The next mutation/timeupdate/media event will retry.
  return state.activeContainerEl;
}