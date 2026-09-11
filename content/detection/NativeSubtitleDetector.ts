// detection/NativeSubtitleDetector.ts

import { cueToPlainText, isSubtitleText, normalizeSubtitleText } from '../../utils/text';
import { getVideoSubtitleRect, isPointInRectWithPadding } from '../../utils/dom';

export interface NativeSubtitleHit {
  text: string;
  rect: DOMRect;
  video: HTMLVideoElement;
}

const preparedNativeTracks = new WeakSet<TextTrack>();

export function prepareNativeTextTrack(track: TextTrack): void {
  if (preparedNativeTracks.has(track)) return;
  preparedNativeTracks.add(track);
  try {
    if (track.mode === 'disabled') track.mode = 'hidden';
  } catch (_) { /* read-only or unusual TextTrack */ }
}

export function findNativeSubtitleAtPoint(clientX: number, clientY: number): NativeSubtitleHit | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];

  for (const video of videos) {
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) continue;
    if (
      clientX < videoRect.left || clientX > videoRect.right ||
      clientY < videoRect.top || clientY > videoRect.bottom
    ) continue;

    const cueHits: Array<{ cue: TextTrackCue; text: string; rect: DOMRect; track: TextTrack }> = [];

    for (const track of Array.from(video.textTracks)) {
      const kind = (track.kind || '').toLowerCase();
      if (kind !== 'subtitles' && kind !== 'captions') continue;

      prepareNativeTextTrack(track);
      const cues = track.activeCues;
      if (!cues || cues.length === 0) continue;

      for (const cue of Array.from(cues)) {
        const text = cueToPlainText(cue);
        if (!isSubtitleText(text)) continue;
        cueHits.push({ cue, text, rect: getVideoSubtitleRect(video, cue), track });
      }
    }

    if (cueHits.length === 0) continue;

    const underPoint = cueHits
      .filter((hit) => isPointInRectWithPadding(clientX, clientY, hit.rect, 36))
      .sort((a, b) => {
        const ar = a.rect, br = b.rect;
        const adx = clientX - (ar.left + ar.width / 2);
        const ady = clientY - (ar.top + ar.height / 2);
        const bdx = clientX - (br.left + br.width / 2);
        const bdy = clientY - (br.top + br.height / 2);
        return (adx * adx + ady * ady) - (bdx * bdx + bdy * bdy);
      })[0];

    if (!underPoint) continue;

    const related = cueHits.filter((hit) => {
      if (hit.track !== underPoint.track) return false;
      if (hit === underPoint) return true;
      const a = underPoint.rect, b = hit.rect;
      const verticalGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const closeEnough = verticalGap <= Math.max(20, Math.min(a.height, b.height) * 1.5);
      const horizontallyAligned = horizontalOverlap >= Math.min(a.width, b.width) * 0.15;
      return closeEnough && horizontallyAligned;
    });

    if (related.length === 1) {
      return { text: underPoint.text, rect: underPoint.rect, video };
    }

    related.sort((a, b) => a.rect.top - b.rect.top);
    const left = Math.min(...related.map((hit) => hit.rect.left));
    const top = Math.min(...related.map((hit) => hit.rect.top));
    const right = Math.max(...related.map((hit) => hit.rect.right));
    const bottom = Math.max(...related.map((hit) => hit.rect.bottom));

    const text = normalizeSubtitleText(related.map((hit) => hit.text).join(' '));
    return { text, rect: new DOMRect(left, top, right - left, bottom - top), video };
  }

  return null;
}

export function isLikelySubtitleZone(clientX: number, clientY: number): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const xInside = clientX >= rect.left && clientX <= rect.right;
    const yRatio = (clientY - rect.top) / rect.height;
    if (xInside && yRatio >= 0.62 && yRatio <= 0.97) return video;
  }
  return null;
}

export function findCurrentNativeAutoCue(): NativeSubtitleHit | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  for (const video of videos) {
    const vr = video.getBoundingClientRect();
    if (vr.width <= 0 || vr.height <= 0) continue;

    for (const track of Array.from(video.textTracks)) {
      const kind = (track.kind || '').toLowerCase();
      if (kind !== 'subtitles' && kind !== 'captions') continue;
      prepareNativeTextTrack(track);
      const cues = track.activeCues;
      if (!cues || cues.length === 0) continue;

      const hits = Array.from(cues)
        .map((cue) => ({ cue, text: cueToPlainText(cue), rect: getVideoSubtitleRect(video, cue) }))
        .filter((hit) => isSubtitleText(hit.text));

      if (hits.length === 0) continue;
      hits.sort((a, b) => a.rect.top - b.rect.top);

      const left = Math.min(...hits.map((hit) => hit.rect.left));
      const top = Math.min(...hits.map((hit) => hit.rect.top));
      const right = Math.max(...hits.map((hit) => hit.rect.right));
      const bottom = Math.max(...hits.map((hit) => hit.rect.bottom));
      return {
        text: normalizeSubtitleText(hits.map((hit) => hit.text).join(' ')),
        rect: new DOMRect(left, top, right - left, bottom - top),
        video,
      };
    }
  }
  return null;
}