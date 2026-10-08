// detection/SubtitleDetector.ts

import { findGenuineSubtitleCandidate } from './DomSubtitleDetector';
import { findNativeSubtitleAtPoint, isLikelySubtitleZone, type NativeSubtitleHit } from './NativeSubtitleDetector';

export function findSubtitleElementUnderPoint(clientX: number, clientY: number, targetDoc: Document = document): HTMLElement | null {
  return findGenuineSubtitleCandidate(clientX, clientY, null, targetDoc);
}

export function getUniversalSubtitleHit(clientX: number, clientY: number, targetDoc: Document = document): {
  element: HTMLElement | null;
  native: NativeSubtitleHit | null;
  video: HTMLVideoElement | null;
} {
  const video = isLikelySubtitleZone(clientX, clientY, targetDoc);
  if (!video) return { element: null, native: null, video: null };

  const element = findGenuineSubtitleCandidate(clientX, clientY, null, targetDoc);
  if (element) return { element, native: null, video };

  const native = findNativeSubtitleAtPoint(clientX, clientY, targetDoc);
  if (native) return { element: null, native, video: native.video };

  return { element: null, native: null, video };
}

export { findBestSubtitleContainer, findSubtitleByGeometry, findGenuineSubtitleCandidate } from './DomSubtitleDetector';
export { findNativeSubtitleAtPoint, findNativeWordAtPoint, isLikelySubtitleZone, findCurrentNativeAutoCue, prepareNativeTextTrack } from './NativeSubtitleDetector';
export type { NativeSubtitleHit, NativeWordHit } from './NativeSubtitleDetector';
export type { CandidateScore } from './CandidateScorer';