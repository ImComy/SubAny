import { resolveCaptionLineContainer, measureGlyphBounds, getAllVideos } from '../../utils/dom';
import { isPlaybackTimeText, isSubtitleText, normalizeSubtitleText } from '../../utils/text';
import {
  getSubtitlePresentationAncestor,
  hasSubtitleClass,
  isPlayerControlRegion,
  scoreSubtitleCandidate,
} from '../detection/CandidateScorer';
import { combineSubtitleLines, isUsableSubtitleLine } from '../detection/SubtitleGrouping';
import { makeAutoRegionKey } from './AutoRegionKey';
import { AUTO_DETECTION_WEIGHTS as weights } from './weights';

export interface AutoCandidate {
  element: HTMLElement | SVGElement;
  video: HTMLVideoElement | null;
  score: number;
  text: string;
  key: string;
}

export function scoreAutoCandidate(element: HTMLElement | SVGElement, video: HTMLVideoElement | null): number {
  const videoRect = video?.getBoundingClientRect() ?? null;
  if (isPlayerControlRegion(element, videoRect)) return -Infinity;

  const scored = scoreSubtitleCandidate(element);
  if (!scored) return -Infinity;

  let score = scored.score;
  const rect = element.getBoundingClientRect();
  const tb = measureGlyphBounds(element);
  const contentWidth = tb ? tb.width : rect.width;
  const contentHeight = tb ? tb.height : rect.height;

  if (videoRect && videoRect.width > 0 && videoRect.height > 0) {
    const cx = (rect.left + rect.width / 2 - videoRect.left) / videoRect.width;
    const cy = (rect.top + rect.height / 2 - videoRect.top) / videoRect.height;
    const widthRatio = contentWidth / videoRect.width;
    const heightRatio = contentHeight / videoRect.height;

    if (cx > 0.20 && cx < 0.80) score += weights.centeredX;
    else if (cx > 0.10 && cx < 0.90) score += weights.nearCenteredX;
    else score += weights.edgeX;

    if (cy >= 0.56 && cy <= 0.88) score += weights.subtitleBandY;
    else if (cy > 0.88 && cy <= 0.96) score += weights.lowerBandY;
    else if (cy >= 0.04 && cy <= 0.28) score += weights.subtitleBandY - 5;
    else score += weights.outsideBandY;

    if (widthRatio > 0.04 && widthRatio < 0.82) score += weights.subtitleWidth;
    else score += weights.invalidWidth;

    if (heightRatio > 0.01 && heightRatio < 0.16) score += weights.subtitleHeight;
    else score += weights.invalidHeight;
  }

  const presentationAncestor = getSubtitlePresentationAncestor(element, videoRect);
  if (presentationAncestor) score += weights.presentationAncestor;

  if (hasSubtitleClass(element)) score += weights.subtitleClass;
  if (getComputedStyle(element).pointerEvents === 'none') score += weights.pointerEventsNone;

  const hasStrongPresentationSignal =
    !!presentationAncestor ||
    hasSubtitleClass(element) ||
    getComputedStyle(element).pointerEvents === 'none';

  if (!hasStrongPresentationSignal) score += weights.missingPresentationSignal;

  return score;
}

/**
 * Gather all plausible auto-detection candidates on the page.
 *
 * Pure geometric walk of each video's player subtree. No class-name queries.
 *
 * Cost control:
 *   - `textContent` is read first (no layout reflow) as a free filter.
 *   - `getBoundingClientRect` is only called on elements whose text
 *     already looks like a subtitle.
 *   - Walk is capped at 300 elements visited per video.
 */
export function collectAutoSubtitleCandidates(targetDoc: Document = document): AutoCandidate[] {
  const videos = getAllVideos(targetDoc);
  if (videos.length === 0) return [];

  const raw: Array<{
    element: HTMLElement | SVGElement;
    video: HTMLVideoElement | null;
    score: number;
    text: string;
  }> = [];

  const visitedElements = new Set<Element>();

  for (const video of videos) {
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) continue;

    const rootNode = video.getRootNode();
    const scope = video.parentElement?.parentElement ?? video.parentElement ?? (rootNode instanceof ShadowRoot ? (rootNode as ShadowRoot).firstElementChild as HTMLElement | null : null);
    if (!scope) continue;

    const walkStack: (HTMLElement | SVGElement)[] = [scope];
    let visited = 0;
    const MAX_VISITS = 300;

    while (walkStack.length > 0 && visited < MAX_VISITS) {
      const el = walkStack.pop()!;
      visited++;

      if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;
      if (visitedElements.has(el)) continue;
      visitedElements.add(el);

      const tag = el.tagName.toLowerCase();
      if (tag === 'svg') {
        if (!el.querySelector('text')) continue;
      } else if (['video', 'audio', 'button', 'input', 'select', 'textarea', 'path', 'script', 'style'].includes(tag)) {
        continue;
      }
      if (el.matches('[role="button"], [role="slider"], [role="progressbar"]')) continue;

      // Free filter: textContent does not force layout. Skip elements with
      // no plausible subtitle text before ever touching geometry.
      const text = normalizeSubtitleText(el.textContent ?? '');
      const textLooksLikeSubtitle =
        text.length >= 2 &&
        text.length <= 1200 &&
        isSubtitleText(text) &&
        !isPlaybackTimeText(text);

      if (textLooksLikeSubtitle) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const insideVideo =
            rect.left >= videoRect.left - 20 &&
            rect.right <= videoRect.right + 20 &&
            rect.top >= videoRect.top - 20 &&
            rect.bottom <= videoRect.bottom + 20;

          const inSubtitleBand =
            (rect.top >= videoRect.top + videoRect.height * 0.35) ||
            (rect.top >= videoRect.top + videoRect.height * 0.03 && rect.bottom <= videoRect.top + videoRect.height * 0.35);

          const tb = measureGlyphBounds(el);
          const contentWidth = tb ? tb.width : rect.width;
          const contentHeight = tb ? tb.height : rect.height;

          const isSvg = el instanceof SVGElement;
          const tooBig =
            !isSvg &&
            contentWidth > videoRect.width * 0.96 &&
            contentHeight > Math.max(320, videoRect.height * 0.75);

          if (insideVideo && inSubtitleBand && !tooBig) {
            if (isUsableSubtitleLine(el, videoRect) && !isPlayerControlRegion(el, videoRect)) {
              const score = scoreAutoCandidate(el, video);
              if (Number.isFinite(score) && score >= 50) {
                raw.push({ element: el, video, score, text });
              }
            }
          }
        }
      }

      // Descend into children. Prune by tag: skip already-processed subtrees.
      for (let i = 0; i < el.children.length; i++) {
        const ch = el.children[i];
        if (ch instanceof HTMLElement || ch instanceof SVGElement) {
          walkStack.push(ch);
        }
      }
    }
  }

  raw.sort((a, b) => b.score - a.score);

  const results: AutoCandidate[] = [];
  const usedKeys = new Set<string>();

  for (const candidate of raw.slice(0, 16)) {
    const videoRect = candidate.video?.getBoundingClientRect() ?? null;
    if (isPlayerControlRegion(candidate.element, videoRect)) continue;

    const lineContainer = resolveCaptionLineContainer(candidate.element, videoRect);
    const grouped = combineSubtitleLines(lineContainer, videoRect);
    const finalElement =
      isUsableSubtitleLine(grouped, videoRect) && !isPlayerControlRegion(grouped, videoRect)
        ? grouped
        : lineContainer;

    if (isPlayerControlRegion(finalElement, videoRect)) continue;

    const finalText = normalizeSubtitleText(finalElement.textContent ?? '');
    if (!finalText || !isSubtitleText(finalText)) continue;

    const finalScore = scoreAutoCandidate(finalElement, candidate.video);
    if (!Number.isFinite(finalScore) || finalScore < 50) continue;

    const key = makeAutoRegionKey(finalElement, candidate.video);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    results.push({
      element: finalElement,
      video: candidate.video,
      score: finalScore,
      text: finalText,
      key,
    });
  }

  return results;
}