// detection/DomSubtitleDetector.ts

import { getAllElements, getDeepestTextContainer } from '../../utils/dom';
import { isSubtitleText } from '../../utils/text';
import { scoreSubtitleCandidate, isPlayerControlRegion, type CandidateScore } from './CandidateScorer';
import { combineSubtitleLines } from './SubtitleGrouping';

export function findBestSubtitleContainer(): HTMLElement | null {
  const allElements = getAllElements(document);
  let best: CandidateScore | null = null;

  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (el.id === 'subany-extension-root') continue;
    const scored = scoreSubtitleCandidate(el);
    if (scored && (!best || scored.score > best.score)) best = scored;
  }

  if (best && best.score > 5) {
    const deepest = getDeepestTextContainer(best.element);
    return combineSubtitleLines(deepest, null);
  }

  const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
  if (live && isSubtitleText(live.textContent?.trim() || '')) {
    const liveEl = getDeepestTextContainer(live as HTMLElement);
    return combineSubtitleLines(liveEl, null);
  }
  return null;
}

export function findSubtitleByGeometry(clientX: number, clientY: number): HTMLElement | null {
  const allElements = getAllElements(document);
  let best: CandidateScore | null = null;

  for (const el of allElements) {
    if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.65) continue;

    if (!(
      clientX >= rect.left - 12 &&
      clientX <= rect.right + 12 &&
      clientY >= rect.top - 12 &&
      clientY <= rect.bottom + 12
    )) continue;

    const scored = scoreSubtitleCandidate(el);
    if (!scored) continue;

    scored.score += 35;
    scored.reasons.push('geometry-hit');

    if (!best || scored.score > best.score) best = scored;
  }

  if (best && best.score > 15) {
    const leaf = getDeepestTextContainer(best.element);
    const containingVideo = (Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]).find((v) => {
      const r = v.getBoundingClientRect();
      const er = leaf.getBoundingClientRect();
      return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
    });
    return combineSubtitleLines(leaf, containingVideo?.getBoundingClientRect() ?? null);
  }

  return null;
}

export function findGenuineSubtitleCandidate(clientX: number, clientY: number): HTMLElement | null {
  const stack = (document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : []) as HTMLElement[];
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  const nearestVideo = videos[0] ?? null;
  const vRect = nearestVideo ? nearestVideo.getBoundingClientRect() : null;

  const validStack = stack.filter((el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;

    const tag = el.tagName.toLowerCase();
    if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) return false;
    if (el.querySelector('video') !== null) return false;
    if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) return false;
    if (el.closest('.control, .controls, .progress, .volume, .player-controls')) return false;

    const text = el.innerText?.trim() ?? '';
    if (!text || !isSubtitleText(text)) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    if (vRect) {
      if (rect.width >= vRect.width * 0.96 && rect.height >= vRect.height * 0.45) return false;
      if (rect.height > vRect.height * 0.45) return false;
    } else {
      if (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.45) return false;
    }

    return true;
  });

  if (validStack.length === 0) {
    const geometryCandidate = findSubtitleByGeometry(clientX, clientY);
    if (geometryCandidate) return geometryCandidate;

    if (nearestVideo && vRect) {
      const inSubtitleZone =
        clientX >= vRect.left &&
        clientX <= vRect.right &&
        clientY >= vRect.top + vRect.height * 0.55 &&
        clientY <= vRect.bottom;

      if (inSubtitleZone && nearestVideo.parentElement) {
        const playerChildren = Array.from(nearestVideo.parentElement.querySelectorAll('*')) as HTMLElement[];
        for (const child of playerChildren) {
          if (['video', 'audio', 'button', 'svg', 'input'].includes(child.tagName.toLowerCase())) continue;
          if (child.querySelector('video') !== null) continue;
          if (child.closest('button, [role="button"], [role="slider"], input')) continue;
          const text = child.innerText?.trim() ?? '';
          if (!text || !isSubtitleText(text)) continue;

          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height <= vRect.height * 0.4) {
            if (
              clientX >= r.left - 40 && clientX <= r.right + 40 &&
              clientY >= r.top - 40 && clientY <= r.bottom + 40
            ) {
              return getDeepestTextContainer(child);
            }
          }
        }
      }
    }
    return null;
  }

  let best: CandidateScore | null = null;
  for (const el of validStack) {
    const scored = scoreSubtitleCandidate(el);
    if (scored && (!best || scored.score > best.score)) best = scored;
  }

  if (best) {
    const leaf = getDeepestTextContainer(best.element);
    return combineSubtitleLines(leaf, vRect);
  }

  if (validStack[0]) return getDeepestTextContainer(validStack[0]);
  return null;
}