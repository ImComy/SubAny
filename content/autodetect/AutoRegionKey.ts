// autodetect/AutoRegionKey.ts

/**
 * Quantized region key.
 *
 * Two candidates occupying the same relative position inside the same video
 * resolve to the same key, so a player that destroys/recreates its subtitle
 * nodes on every cue does not spam the auto-tracker with new regions.
 *
 * Video-relative when a video is available, viewport-relative otherwise.
 * Matches the original `makeAutoRegionKey`.
 */
import { getAllVideos } from '../../utils/dom';

export function makeAutoRegionKey(element: HTMLElement, video: HTMLVideoElement | null): string {
  const rect = element.getBoundingClientRect();
  const vr = video?.getBoundingClientRect() ?? null;

  if (vr && vr.width > 0 && vr.height > 0) {
    const x = (rect.left + rect.width / 2 - vr.left) / vr.width;
    const y = (rect.top + rect.height / 2 - vr.top) / vr.height;
    const w = rect.width / vr.width;
    const h = rect.height / vr.height;
    const q = (n: number, step = 0.035) => Math.round(n / step);
    const videoIndex = video ? getAllVideos().indexOf(video) : -1;
    return `v:${videoIndex}:${q(x)}:${q(y)}:${q(w, 0.04)}:${q(h, 0.04)}`;
  }

  return [
    'p',
    Math.round((rect.left + rect.width / 2) / Math.max(1, window.innerWidth) / 0.035),
    Math.round((rect.top + rect.height / 2) / Math.max(1, window.innerHeight) / 0.035),
    Math.round(rect.width / Math.max(1, window.innerWidth) / 0.04),
    Math.round(rect.height / Math.max(1, window.innerHeight) / 0.04),
  ].join(':');
}