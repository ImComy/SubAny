// autodetect/AutoDetectScorer.ts

import { getAllElements, getVideoContainingElement } from '../../utils/dom';
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
  element: HTMLElement;
  video: HTMLVideoElement | null;
  score: number;
  text: string;
  key: string;
}

/**
 * Score a candidate specifically for auto-detection.
 *
 * Builds on `scoreSubtitleCandidate`, then adds video-relative positional
 * bonuses (bottom-centred band) and requires at least one strong
 * subtitle-specific presentation signal so the automatic mode stays
 * conservative.
 *
 * Matches the original `scoreAutoCandidate`.
 */
export function scoreAutoCandidate(element: HTMLElement, video: HTMLVideoElement | null): number {
  const videoRect = video?.getBoundingClientRect() ?? null;
  if (isPlayerControlRegion(element, videoRect)) return -Infinity;

  const scored = scoreSubtitleCandidate(element);
  if (!scored) return -Infinity;

  let score = scored.score;
  const rect = element.getBoundingClientRect();

  if (videoRect && videoRect.width > 0 && videoRect.height > 0) {
    const cx = (rect.left + rect.width / 2 - videoRect.left) / videoRect.width;
    const cy = (rect.top + rect.height / 2 - videoRect.top) / videoRect.height;
    const widthRatio = rect.width / videoRect.width;
    const heightRatio = rect.height / videoRect.height;

    if (cx > 0.20 && cx < 0.80) score += weights.centeredX;
    else if (cx > 0.10 && cx < 0.90) score += weights.nearCenteredX;
    else score += weights.edgeX;

    if (cy >= 0.56 && cy <= 0.88) score += weights.subtitleBandY;
    else if (cy > 0.88 && cy <= 0.96) score += weights.lowerBandY;
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
 * Gather all plausible auto-detection candidates on the page and reduce
 * them to one entry per quantized region key.
 *
 * Matches the original `collectAutoSubtitleCandidates`.
 */
export function collectAutoSubtitleCandidates(): AutoCandidate[] {
  const allElements = getAllElements(document);
  const raw: Array<{
    element: HTMLElement;
    video: HTMLVideoElement | null;
    score: number;
    text: string;
  }> = [];

  for (const el of allElements) {
    if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;
    if (!isUsableSubtitleLine(el, null)) continue;

    const text = normalizeSubtitleText(el.innerText || el.textContent || '');
    if (!text || !isSubtitleText(text)) continue;

    const video = getVideoContainingElement(el);
    if (!video) continue;

    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) continue;
    if (isPlayerControlRegion(el, videoRect)) continue;

    const score = scoreAutoCandidate(el, video);
    if (!Number.isFinite(score) || score < 50) continue;
    if (isPlaybackTimeText(text)) continue;

    raw.push({ element: el, video, score, text });
  }

  raw.sort((a, b) => b.score - a.score);

  const results: AutoCandidate[] = [];
  const usedKeys = new Set<string>();

  for (const candidate of raw.slice(0, 16)) {
    const videoRect = candidate.video?.getBoundingClientRect() ?? null;
    if (isPlayerControlRegion(candidate.element, videoRect)) continue;

    const grouped = combineSubtitleLines(candidate.element, videoRect);
    const finalElement =
      isUsableSubtitleLine(grouped, videoRect) && !isPlayerControlRegion(grouped, videoRect)
        ? grouped
        : candidate.element;

    if (isPlayerControlRegion(finalElement, videoRect)) continue;

    const finalText = normalizeSubtitleText(finalElement.innerText || finalElement.textContent || '');
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