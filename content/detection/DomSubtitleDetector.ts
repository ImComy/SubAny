// detection/DomSubtitleDetector.ts

import {
  getSubtitleElementAtPoint,
  getDeepestTextContainer,
} from '../../utils/dom';
import { isSubtitleText } from '../../utils/text';
import { combineSubtitleLines } from './SubtitleGrouping';

/**
 * Find the genuine subtitle element under a point.
 *
 * Delegates to `getSubtitleElementAtPoint`, which:
 *   1. Tries `elementsFromPoint` (fast path — works when captions have
 *      pointer-events enabled).
 *   2. Falls back to a pruned geometric walk scoped to the video's
 *      grandparent (works on YouTube, Videasy, and any player that renders
 *      captions as a sibling of the video wrapper).
 *
 * The previous version of this function imposed a hard "click must be in
 * the bottom 45% of the video" gate BEFORE running the geometric walk.
 * That gate rejected valid captions on players where the caption sits at
 * 45–55% y-ratio (Videasy, some embedded players, tall/short aspect ratios).
 * It's gone. The walk itself already bounds the search to the video's
 * subtree; no additional y-band gate is needed.
 *
 * No full-document scan. No `getAllElements`. No `innerText`.
 */
export function findGenuineSubtitleCandidate(
  clientX: number,
  clientY: number,
  clickTarget?: HTMLElement | null,
): HTMLElement | null {
  return getSubtitleElementAtPoint(clientX, clientY, clickTarget);
}

/**
 * Legacy alias kept for call-site compatibility. Same as above.
 */
export function findSubtitleByGeometry(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  return getSubtitleElementAtPoint(clientX, clientY);
}

/**
 * Best-guess initial subtitle container when there is no pointer info
 * (used by auto-detect).
 *
 * For each video on the page, walk its player subtree geometrically,
 * looking for the smallest text element inside the subtitle band. No
 * document-wide scan; the scope is always `video.parentElement.parentElement`.
 *
 * Matches the same scope rule as `getSubtitleElementAtPoint`, so the two
 * paths cannot disagree about where the caption lives.
 */
export function findBestSubtitleContainer(): HTMLElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return null;

  for (const video of videos) {
    const vr = video.getBoundingClientRect();
    if (vr.width <= 0 || vr.height <= 0) continue;

    const scope = video.parentElement?.parentElement ?? video.parentElement;
    if (!scope) continue;

    let best: HTMLElement | null = null;
    let bestArea = Infinity;
    const walkStack: HTMLElement[] = [scope];
    let visited = 0;
    const MAX_VISITS = 400;

    while (walkStack.length > 0 && visited < MAX_VISITS) {
      const el = walkStack.pop()!;
      visited++;

      if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;

      const tag = el.tagName.toLowerCase();
      if (
        tag === 'video' || tag === 'audio' || tag === 'button' ||
        tag === 'input' || tag === 'select' || tag === 'textarea' ||
        tag === 'svg' || tag === 'path' ||
        tag === 'script' || tag === 'style' || tag === 'noscript'
      ) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;

      // Must be inside the video bounding box.
      if (r.left < vr.left - 20 || r.right > vr.right + 20) continue;
      if (r.top < vr.top - 20 || r.bottom > vr.bottom + 20) continue;

      // Push children in reverse for earlier-sibling-first DFS.
      for (let i = el.children.length - 1; i >= 0; i--) {
        walkStack.push(el.children[i] as HTMLElement);
      }

      // Skip anything that isn't plausibly a caption leaf.
      if (r.width > vr.width * 0.95 && r.height > vr.height * 0.15) continue;
const centerY = r.top + r.height / 2;
if (centerY < vr.top + vr.height * 0.30) continue;

      const text = (el.textContent ?? '').trim();
      if (text.length < 2 || text.length > 400) continue;
      if (!isSubtitleText(text)) continue;

      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = el;
      }
    }

    if (best) {
      return combineSubtitleLines(getDeepestTextContainer(best), vr);
    }
  }

  // Aria-live fallback for players that announce captions that way.
  const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]') as HTMLElement | null;
  if (live) {
    const text = (live.textContent ?? '').trim();
    if (text.length >= 2 && isSubtitleText(text)) {
      return getDeepestTextContainer(live);
    }
  }

  return null;
}