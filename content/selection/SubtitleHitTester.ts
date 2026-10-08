// selection/SubtitleHitTester.ts

import type { ContentState } from '../state/ContentState';
import {
  getUniversalSubtitleHit,
  type NativeSubtitleHit,
} from '../detection/SubtitleDetector';

/**
 * The unified result of asking "what subtitle is at this point?".
 *
 * Exactly one of `element` / `native` is ever non-null when there is a hit.
 * `video` may be populated even when neither is — that is the "cursor is in
 * the subtitle band of this video, but we can't see the text" case, which is
 * still useful for hover/click routing.
 */
export interface UniversalHit {
  element: HTMLElement | null;
  native: NativeSubtitleHit | null;
  video: HTMLVideoElement | null;
}

const EMPTY_HIT: UniversalHit = { element: null, native: null, video: null };
let lastHitKey = '';
let lastHitResult: UniversalHit = EMPTY_HIT;
let lastHitAt = 0;

import { getSubtitleAcceptanceRegion, getAllVideos, composedContains, getComposedElementsFromPoint } from '../../utils/dom';

function isInSubtitleBand(clientX: number, clientY: number, targetDoc: Document = document): boolean {
  const videos = getAllVideos(targetDoc);
  for (const video of videos) {
    const region = getSubtitleAcceptanceRegion(video);
    if (
      clientX >= region.left &&
      clientX <= region.right &&
      clientY >= region.top &&
      clientY <= region.bottom
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Thin wrapper around the detection facade so every caller gets the same
 * shape and no one has to remember the return contract of
 * `getUniversalSubtitleHit`.
 */
export function getHitAt(clientX: number, clientY: number, targetDoc: Document = document): UniversalHit {
  const coarseX = Math.round(clientX / 8);
  const coarseY = Math.round(clientY / 8);
  const key = `${coarseX}:${coarseY}`;
  const now = performance.now();

  if (key === lastHitKey && now - lastHitAt < 120) {
    return lastHitResult;
  }

  if (!isInSubtitleBand(clientX, clientY, targetDoc)) {
    lastHitKey = key;
    lastHitAt = now;
    lastHitResult = EMPTY_HIT;
    return EMPTY_HIT;
  }

  const hit = getUniversalSubtitleHit(clientX, clientY, targetDoc);
  const finalHit = (!hit.element && !hit.native && !hit.video) ? EMPTY_HIT : hit;

  lastHitKey = key;
  lastHitAt = now;
  lastHitResult = finalHit;
  return finalHit;
}

/**
 * True when the cursor is over the currently active (locked or auto-tracked)
 * subtitle container.
 *
 * Checks three ways, in order of cost:
 *   1. `contains(e.target)` — catches the normal case where a child node is
 *      the hit target.
 *   2. Rect containment with a small padding — catches the case where the
 *      cursor is over the container's transparent area.
 *   3. `elementsFromPoint` — catches the case where an overlay (e.g. the
 *      player's own control layer, or the pointer-events:none wrapper) sits
 *      between the cursor and the active container.
 */
export function isOverActiveContainer(state: ContentState, e: MouseEvent): boolean {
  const container = state.activeContainerEl;
  if (!container) return false;

  const target = (e.composedPath?.()[0] as Node | null) ?? (e.target as Node | null);
  if (target && (container === target || composedContains(container, target))) return true;

  const rect = container.getBoundingClientRect();
  if (
    e.clientX >= rect.left - 5 &&
    e.clientX <= rect.right + 5 &&
    e.clientY >= rect.top - 5 &&
    e.clientY <= rect.bottom + 5
  ) {
    return true;
  }

  const stack = getComposedElementsFromPoint(e.clientX, e.clientY);

  return stack.some((el) => el === container || composedContains(container, el));
}