// video/VideoMonitor.ts

import type { ContentState } from '../state/ContentState';
import type { LockedVideoEventBinding } from '../state/types';

/**
 * Media events that we re-run the tracking pulse on.
 *
 * `timeupdate` is the heartbeat (~4 Hz while playing) and the others fire on
 * state transitions that we know precede a player subtitle rebuild: seeking,
 * resuming from pause, loading a new source.
 */
const MEDIA_EVENTS = ['timeupdate', 'seeked', 'playing', 'play'] as const;

export interface VideoMonitorDeps {
  /**
   * The "keep-alive tick".
   *
   * ContentApp implements this to perform exactly what the original content
   * script did inside `videoTimeUpdateHandler`:
   *   1. `maintainLockedContainer(true)` when a lockedSelector is set, or
   *      `updateAutoDetection()` when auto-detection is active.
   *   2. Inspect the active container's text and either clear bilingual
   *      state (empty cue) or call `handleSubtitleTextChange` when the text
   *      changed.
   *
   * Injected so VideoMonitor stays a leaf module over `ContentState` +
   * DOM event plumbing.
   */
  onMediaTick: () => void;
}

/**
 * Bindings currently attached by the monitor. Stored on a module-local
 * because they are per-instance ephemeral and never serialized.
 */
let bindings: LockedVideoEventBinding[] = [];

/**
 * Tear down every listener the monitor previously attached.
 */
export function stopVideoMonitor(): void {
  for (const binding of bindings) {
    binding.video.removeEventListener(binding.event, binding.handler);
  }
  bindings = [];
}

/**
 * Scan the document for `<video>` elements and attach the tick handler to
 * each. Always calls `stopVideoMonitor` first so this is idempotent.
 *
 * Matches the original `setupVideoTimeTracking` behaviour, but with a
 * correct symmetric teardown (the original added listeners to each `<video>`
 * but removed them from `document` on unlock — this version removes from the
 * same targets it attached to).
 *
 * If there are no videos on the page, this is a no-op and `bindings` stays
 * empty.
 */
export function startVideoMonitor(_state: ContentState, deps: VideoMonitorDeps): void {
  stopVideoMonitor();

  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return;

  const handler: EventListener = () => {
    deps.onMediaTick();
  };

  for (const video of videos) {
    for (const event of MEDIA_EVENTS) {
      video.addEventListener(event, handler, { passive: true });
      bindings.push({ video, event, handler });
    }
  }
}

/**
 * Re-scan when the set of `<video>` elements on the page may have changed
 * (e.g. a player swapped its element, an SPA navigation added a new one).
 *
 * For now, ContentApp calls this from the same places it previously called
 * `setupVideoTimeTracking` — after locking a container and after settings
 * changes that affect tracking.
 */
export function rescanVideoMonitor(state: ContentState, deps: VideoMonitorDeps): void {
  startVideoMonitor(state, deps);
}

/**
 * Returns true when the monitor currently has any attached bindings. Used
 * by ContentApp to avoid re-scanning on every mutation.
 */
export function isVideoMonitorActive(): boolean {
  return bindings.length > 0;
}