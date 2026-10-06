// detection/NativeSubtitleDetector.ts

import { cueToPlainText, isSubtitleText, normalizeSubtitleText } from '../../utils/text';
import { getSubtitleAcceptanceRegion, getVideoSubtitleRect, isPointInRectWithPadding } from '../../utils/dom';

export interface NativeSubtitleHit {
  text: string;
  rect: DOMRect;
  video: HTMLVideoElement;
}

export interface NativeWordHit {
  text: string;
  rect: DOMRect;
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
        cueHits.push({ cue, text, rect: getNativeCueRect(video, cue, text), track });
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

function getNativeCueRect(video: HTMLVideoElement, cue: TextTrackCue, text: string): DOMRect {
  const videoRect = video.getBoundingClientRect();
  const base = getVideoSubtitleRect(video, cue);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const fontSize = Math.max(16, Math.min(42, videoRect.height * 0.045));
  const lineHeight = fontSize * 1.2;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return base;

  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const textWidth = Math.max(...lines.map((line) => context.measureText(line).width), 0);
  const width = Math.min(videoRect.width * 0.9, Math.max(48, textWidth + 18));
  const height = Math.min(videoRect.height * 0.3, Math.max(32, lines.length * lineHeight + 8));
  return new DOMRect(
    videoRect.left + (videoRect.width - width) / 2,
    base.top + (base.height - height) / 2,
    width,
    height,
  );
}

export function findNativeWordAtPoint(
  hit: NativeSubtitleHit,
  clientX: number,
  clientY: number,
): NativeWordHit | null {
  const lines = hit.text.split(/\r?\n/).filter(Boolean);
  const lineHeight = hit.rect.height / Math.max(1, lines.length);
  const lineIndex = Math.floor((clientY - hit.rect.top) / lineHeight);
  const line = lines[lineIndex];
  if (!line) return null;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const fontSize = Math.max(16, Math.min(42, hit.rect.height / Math.max(1, lines.length) / 1.2));
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const totalWidth = context.measureText(line).width;
  const lineLeft = hit.rect.left + (hit.rect.width - totalWidth) / 2;

  for (const match of line.matchAll(/[\p{L}\p{N}\p{M}\u200C\u200D'-]+/gu)) {
    const word = match[0];
    const start = context.measureText(line.slice(0, match.index ?? 0)).width;
    const width = context.measureText(word).width;
    const rect = new DOMRect(
      lineLeft + start,
      hit.rect.top + lineIndex * lineHeight,
      width,
      lineHeight,
    );
    if (
      clientX >= rect.left - 5 && clientX <= rect.right + 5 &&
      clientY >= rect.top - 5 && clientY <= rect.bottom + 5
    ) {
      return { text: word, rect };
    }
  }

  return null;
}

export function findActiveNativeSubtitleForVideo(
  video: HTMLVideoElement,
  referenceRect: DOMRect,
): NativeSubtitleHit | null {
  for (const track of Array.from(video.textTracks)) {
    const kind = (track.kind || '').toLowerCase();
    if (kind !== 'subtitles' && kind !== 'captions') continue;
    prepareNativeTextTrack(track);
    const cues = track.activeCues;
    if (!cues || cues.length === 0) continue;

    const texts = Array.from(cues)
      .map((cue) => cueToPlainText(cue))
      .filter((text) => isSubtitleText(text));
    if (texts.length === 0) continue;

    const text = normalizeSubtitleText(texts.join(' '));
    const lines = text.split(/\r?\n/).filter(Boolean);
    const fontSize = Math.max(16, Math.min(42, referenceRect.height / Math.max(1, lines.length) / 1.2));
    const lineHeight = fontSize * 1.2;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return { text, rect: referenceRect, video };
    context.font = `700 ${fontSize}px Arial, sans-serif`;
    const textWidth = Math.max(...lines.map((line) => context.measureText(line).width), 0);
    const width = Math.max(48, textWidth + 18);
    const height = Math.max(32, lines.length * lineHeight + 8);
    return {
      text,
      rect: new DOMRect(
        referenceRect.left + (referenceRect.width - width) / 2,
        referenceRect.top + (referenceRect.height - height) / 2,
        width,
        height,
      ),
      video,
    };
  }
  return null;
}

export function isLikelySubtitleZone(clientX: number, clientY: number): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  for (const video of videos) {
    const region = getSubtitleAcceptanceRegion(video);
    if (
      clientX >= region.left &&
      clientX <= region.right &&
      clientY >= region.top &&
      clientY <= region.bottom
    ) {
      return video;
    }
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
        .map((cue) => {
          const text = cueToPlainText(cue);
          return { cue, text, rect: getNativeCueRect(video, cue, text) };
        })
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