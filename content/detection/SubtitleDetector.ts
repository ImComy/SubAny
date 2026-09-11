// detection/SubtitleDetector.ts

import { findGenuineSubtitleCandidate } from './DomSubtitleDetector';
import { findNativeSubtitleAtPoint, isLikelySubtitleZone, type NativeSubtitleHit } from './NativeSubtitleDetector';

export function findSubtitleElementUnderPoint(clientX: number, clientY: number): HTMLElement | null {
  return findGenuineSubtitleCandidate(clientX, clientY);
}

export function getUniversalSubtitleHit(clientX: number, clientY: number): {
  element: HTMLElement | null;
  native: NativeSubtitleHit | null;
  video: HTMLVideoElement | null;
} {
  const element = findGenuineSubtitleCandidate(clientX, clientY);
  if (element) return { element, native: null, video: null };

  const native = findNativeSubtitleAtPoint(clientX, clientY);
  if (native) return { element: null, native, video: native.video };

  const video = isLikelySubtitleZone(clientX, clientY);
  return { element: null, native: null, video };
}

export { findBestSubtitleContainer, findSubtitleByGeometry, findGenuineSubtitleCandidate } from './DomSubtitleDetector';
export { findNativeSubtitleAtPoint, isLikelySubtitleZone, findCurrentNativeAutoCue, prepareNativeTextTrack } from './NativeSubtitleDetector';
export type { NativeSubtitleHit } from './NativeSubtitleDetector';
export type { CandidateScore } from './CandidateScorer';