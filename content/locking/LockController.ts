// locking/LockController.ts

import type { ContentState } from '../state/ContentState';
import type { SubtitleManager } from '../../lib/SubtitleManager.ts';
import type { DomTextSwapper } from '../replacement/DomTextSwapper';
import { generateUniqueSelector, getVideoForElement } from '../../utils/dom';
import { combineSubtitleLines, isUsableSubtitleLine } from '../detection/SubtitleGrouping';
import { makeAutoRegionKey } from '../autodetect/AutoRegionKey';
import { isValidSelectionTarget } from './LockedAnchor';
import {
  rememberLockedAnchor,
  resetLockState,
  updateLockedVisualProxy,
} from './SubtitleLock';
import { startLockedMonitor, stopLockedMonitor } from './LockMonitor';

export interface LockControllerDeps {
  state: ContentState;
  subtitleManager: SubtitleManager;
  domSwapper: DomTextSwapper;

  /** Brief visual highlight when the extension attaches to a container. */
  triggerGlow: (el: HTMLElement) => void;

  /** Stop the auto-detection monitor. Called when the user takes over. */
  stopAutoDetection: () => void;

  /** Restart the video media-event monitor. Called after a successful lock. */
  startVideoMonitor: () => void;

  /** Tear down the video media-event monitor. Called on unlock. */
  stopVideoMonitor: () => void;
}

/**
 * Owns the persistent subtitle lock lifecycle: install / detach, plus the
 * storage and monitor side-effects that go with each.
 *
 * A "lock" is a user-chosen subtitle container that survives across cues,
 * seeks, and player rebuilds. It is distinct from auto-detection, which is
 * the transient heuristic tracker that lives in `autodetect/`.
 */
export class LockController {
  private readonly deps: LockControllerDeps;
  private readonly state: ContentState;

  constructor(deps: LockControllerDeps) {
    this.deps = deps;
    this.state = deps.state;
  }

  /**
   * Install `element` as the active subtitle container.
   *
   * `isAuto = false` (the only path currently used) → persistent user lock.
   * Persists the selector and anchor snapshot, then arms the locked monitor.
   *
   * `isAuto = true` is preserved for API compatibility with the original
   * `lockContainer(element, isAuto)`; it does not persist anything.
   */
  async lock(element: HTMLElement, isAuto = false): Promise<void> {
    const s = this.state;
    const { subtitleManager } = this.deps;

    if (!element || !document.documentElement.contains(element)) return;

    const elementRect = element.getBoundingClientRect();
    if (elementRect.width <= 0 || elementRect.height <= 0) return;

    const videoForElement = getVideoForElement(element);
    const videoRect = videoForElement?.getBoundingClientRect() ?? null;
    const grouped = combineSubtitleLines(element, videoRect);

    // A user click is already a strong identification signal. Do not pass it
    // through a generic container optimiser, because that optimiser can
    // choose a large player ancestor or another visually unrelated element.
    const container =
      isUsableSubtitleLine(grouped, videoRect) && isValidSelectionTarget(grouped, videoRect)
        ? grouped
        : element;

    const finalRect = container.getBoundingClientRect();
    if (finalRect.width <= 0 || finalRect.height <= 0) return;

    s.activeContainerEl = container;
    s.autoDetectedElement = isAuto ? container : null;
    s.autoDetectedVideo = isAuto ? videoForElement ?? getVideoForElement(container) : null;
    s.autoDetectedTrackKey = isAuto ? makeAutoRegionKey(container, s.autoDetectedVideo) : null;

    if (isAuto) {
      subtitleManager.setLockedSelector(null);
      stopLockedMonitor(s);
    } else {
      s.autoDetectionDisabled = true;
      this.deps.stopAutoDetection();

      const selector = generateUniqueSelector(container);
      s.settings.lockedSelector = selector;
      subtitleManager.setLockedSelector(selector);
      rememberLockedAnchor(s, container);

      await browser.storage.local.set({
        subanySettings: s.settings,
        subanyLockedAnchor: s.lockedSubtitleAnchor,
      });

      startLockedMonitor(s);
    }

    this.deps.triggerGlow(container);
    this.deps.startVideoMonitor();
    updateLockedVisualProxy(s);
    s.notify();
  }

  /**
   * Detach the current lock and reset every tracking mode.
   *
   * After this returns, the app is in the same state it was before the user
   * ever locked anything. Auto-detection is deliberately left disabled until
   * the user changes modes; a heuristic grab right after the user pressed
   * "unlock" would be confusing.
   */
  async unlock(): Promise<void> {
    const s = this.state;

    this.deps.domSwapper.restore();

    resetLockState(s);
    stopLockedMonitor(s);

    s.autoDetectedElement = null;
    s.autoDetectedVideo = null;
    s.autoDetectedTrackKey = null;
    s.autoTracks.clear();
    s.autoLastVisibleAt = 0;
    s.autoNativeLastText = '';
    s.autoNativeLastVideo = null;
    s.autoNativeTranslationToken++;

    s.settings.lockedSelector = null;
    this.deps.subtitleManager.setLockedSelector(null);
    this.deps.stopAutoDetection();

    s.autoDetectionDisabled = true;

    s.bilingualSubtitleText = '';
    s.lastObservedSubtitleText = '';

    this.deps.stopVideoMonitor();

    await browser.storage.local.set({
      subanySettings: s.settings,
      subanyLockedAnchor: null,
    });

    s.notify();
  }
}