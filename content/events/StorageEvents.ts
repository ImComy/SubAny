// events/StorageEvents.ts

import type { ContentState } from '../state/ContentState';
import type { SubtitleTrack } from '../subtitles/types';

export interface StorageEventsDeps {
  /**
   * Called whenever `subanySettings` changes in extension storage.
   *
   * ContentApp implements this to:
   *   - merge the new settings into `state.settings`
   *   - restore the DOM when leaving replace-native mode
   *   - re-arm auto-detection when triggerMode / replaceNativeSubtitles
   *     changed (user action, not the overlay unlock button)
   *   - start/stop the locked and auto-detection monitors accordingly
   *   - clear bilingual text when leaving full-auto
   *   - call `render()` and `syncActiveContainer()`
   *
   * Matches the body of the original `browser.storage.onChanged` listener.
   */
  onSettingsChanged: (newSettings: Record<string, unknown>) => void;
  onSubtitleTrackChanged: (track: SubtitleTrack) => void;
}

export interface StorageEventsHandle {
  dispose: () => void;
}

/**
 * Subscribe to `browser.storage.onChanged`. Only `subanySettings` is
 * observed — `subanyLockedAnchor` is written by this content script and is
 * not read here (it is loaded once at startup).
 *
 * Matches:
 *   browser.storage.onChanged.addListener((changes) => {
 *     if (changes.subanySettings?.newValue) { ... }
 *   });
 */
export function startStorageEvents(
  _state: ContentState,
  deps: StorageEventsDeps,
): StorageEventsHandle {
  const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
  ) => {
    const next = changes.subanySettings?.newValue;
    if (next && typeof next === 'object') {
      deps.onSettingsChanged(next as Record<string, unknown>);
    }

    const trackChange = changes.subanySubtitleTrack?.newValue as { track?: SubtitleTrack } | undefined;
    if (trackChange?.track) deps.onSubtitleTrackChanged(trackChange.track);
  };

  browser.storage.onChanged.addListener(listener);

  return {
    dispose: () => browser.storage.onChanged.removeListener(listener),
  };
}