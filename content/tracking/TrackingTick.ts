// tracking/TrackingTick.ts

import type { ContentState } from '../state/ContentState';
import type { DomTextSwapper } from '../replacement/DomTextSwapper';
import { maintainLockedContainer } from '../locking/LockMonitor';
import { normalizeSubtitleText } from '../../utils/text';
import {
  handleSubtitleTextChange,
  type SubtitleTranslationDeps,
} from '../translation/SubtitleTranslationController';

export interface TrackingTickDeps {
  state: ContentState;
  domSwapper: DomTextSwapper;
  subtitleTranslation: SubtitleTranslationDeps;
  /**
   * Run one auto-detection pass. Wired by ContentApp to
   * `AutoDetectController.tick`.
   */
  updateAutoDetection: () => void;
}

/**
 * The shared "something changed, re-evaluate" pulse.
 *
 * Called from:
 *   - the debounced MutationObserver (DOM churn)
 *   - the video media-event monitor (timeupdate / seeked / play / playing)
 *
 * Does two things, in order:
 *   1. Keep the active tracking mode alive (locked maintenance OR auto tick).
 *   2. React to the resulting active container's text: clear bilingual /
 *      swapped state on an empty cue, otherwise translate on change.
 */
export function runTrackingTick(deps: TrackingTickDeps): void {
  const { state, domSwapper, subtitleTranslation, updateAutoDetection } = deps;

  if (state.settings.lockedSelector) {
    maintainLockedContainer(state, (text) => {
      void handleSubtitleTextChange(state, subtitleTranslation, text);
    });
  } else if (!state.autoDetectionDisabled && state.isAutomaticSubtitleMode()) {
    updateAutoDetection();
  }

  // Zero forced reflow: uses textContent
  const currentText = normalizeSubtitleText(state.activeContainerEl?.textContent ?? '');

  if (!currentText) {
    if (state.bilingualSubtitleText || domSwapper.hasSwapped()) {
      domSwapper.restore();
      state.bilingualSubtitleText = '';
      state.lastObservedSubtitleText = '';
      state.notify();
    }
    return;
  }

  if (currentText !== state.lastObservedSubtitleText) {
    void handleSubtitleTextChange(state, subtitleTranslation, currentText);
  }
}