// autodetect/AutoDetectController.ts

import type { ContentState } from '../state/ContentState';
import type { DomTextSwapper } from '../replacement/DomTextSwapper';
import {
  findCurrentNativeAutoCue,
} from '../detection/SubtitleDetector';
import { isPlayerControlRegion } from '../detection/CandidateScorer';
import { isHealthyLockedElement } from '../locking/LockedAnchor';
import {
  handleSubtitleTextChange,
  handleNativeSubtitleTextChange,
  type SubtitleTranslationDeps,
} from '../translation/SubtitleTranslationController';
import { isPlaybackTimeText, normalizeSubtitleText } from '../../utils/text';
import { collectAutoSubtitleCandidates } from './AutoDetectScorer';
import { pruneStaleTracks, rankEligibleTracks, upsertTrack, pickStickyTrack } from './AutoTrackStore';

const AUTO_SCAN_INTERVAL_MS = 420;
const AUTO_EMPTY_GRACE_MS = 750;
const AUTO_TRACK_MAX_AGE_MS = 2800;

export interface AutoDetectDeps {
  state: ContentState;
  domSwapper: DomTextSwapper;
  subtitleTranslation: SubtitleTranslationDeps;
}

/**
 * Owns the auto-detection subsystem: the polling loop, the per-region
 * trackers, the sticky selection, and the native-TextTrack branch.
 *
 * Reads and writes ContentState, but never touches storage, the React tree,
 * or `SubtitleManager`. It reports translation-worthy text changes through
 * `SubtitleTranslationController`; the app is responsible for telling it
 * when to run and when to stop.
 */
export class AutoDetectController {
  private readonly state: ContentState;
  private readonly domSwapper: DomTextSwapper;
  private readonly translation: SubtitleTranslationDeps;

  constructor(deps: AutoDetectDeps) {
    this.state = deps.state;
    this.domSwapper = deps.domSwapper;
    this.translation = deps.subtitleTranslation;
  }

  start(): void {
    const s = this.state;
    if (
      s.autoDetectionRunning ||
      s.autoDetectionDisabled ||
      s.settings.lockedSelector ||
      !s.isAutomaticSubtitleMode()
    ) {
      return;
    }

    s.autoDetectionRunning = true;
    s.autoDetectionTimer = window.setInterval(() => this.tick(), AUTO_SCAN_INTERVAL_MS);
    this.tick();
  }

  stop(): void {
    const s = this.state;
    if (s.autoDetectionTimer !== null) {
      window.clearInterval(s.autoDetectionTimer);
      s.autoDetectionTimer = null;
    }
    s.autoDetectionRunning = false;
  }

  isRunning(): boolean {
    return this.state.autoDetectionRunning;
  }

  /**
   * One auto-detection pass.
   *
   *   - Score every candidate on the page and persist per-region trackers
   *     keyed by a quantized video-relative position.
   *   - Prune trackers that have not been seen recently.
   *   - Pick the best *stable* candidate with sticky behaviour.
   *   - Native TextTrack cues get their own branch — they never become a
   *     fake DOM lock.
   */
  tick(): void {
    const s = this.state;
    if (s.autoDetectionDisabled || s.settings.lockedSelector || !s.isAutomaticSubtitleMode()) return;

    const now = performance.now();
    const candidates = collectAutoSubtitleCandidates();

    for (const candidate of candidates) {
      upsertTrack(s.autoTracks, candidate, now);
    }
    pruneStaleTracks(s.autoTracks, now, AUTO_TRACK_MAX_AGE_MS);

    const ranked = rankEligibleTracks(s.autoTracks);
    const best = pickStickyTrack(ranked, s.autoDetectedTrackKey);

    // Native TextTrack branch. Independent of DOM candidate tracking, and
    // never converted into a fake DOM lock.
    const nativeHit = findCurrentNativeAutoCue();
    if (nativeHit && !best) {
      s.activeContainerEl = null;
      s.autoDetectedElement = null;
      s.autoDetectedVideo = nativeHit.video;
      s.autoDetectedTrackKey = 'native';

      if (nativeHit.text !== s.autoNativeLastText || nativeHit.video !== s.autoNativeLastVideo) {
        s.autoNativeLastText = nativeHit.text;
        s.autoNativeLastVideo = nativeHit.video;
        void handleNativeSubtitleTextChange(s, this.translation, nativeHit.text);
      }
      s.autoLastVisibleAt = now;
      s.notify();
      return;
    }

    if (!best) {
      this.handleEmptyWindow(now);
      return;
    }

    const element = best.element;
    if (!element || !document.documentElement.contains(element)) return;

    const bestVideoRect = best.video?.getBoundingClientRect() ?? null;
    if (
      isPlayerControlRegion(element, bestVideoRect) ||
      isPlaybackTimeText(element.innerText || element.textContent || '')
    ) {
      this.discardTrack(best.key, now);
      return;
    }

    const changedElement = s.autoDetectedElement !== element;
    const changedTrack = s.autoDetectedTrackKey !== best.key;

    s.autoDetectedElement = element;
    s.autoDetectedVideo = best.video;
    s.autoDetectedTrackKey = best.key;
    s.activeContainerEl = element;
    s.autoLastVisibleAt = now;
    s.autoNativeLastText = '';
    s.autoNativeLastVideo = null;

    if (changedElement || changedTrack) {
      if (s.settings.triggerMode === 'full-auto') s.bilingualSubtitleText = '';
      s.notify();
    }

    const currentText = normalizeSubtitleText(element.innerText || element.textContent || '');
    if (currentText && currentText !== s.lastObservedSubtitleText) {
      void handleSubtitleTextChange(s, this.translation, currentText);
    }
  }

  /**
   * No candidate survived this tick. After a short grace window, treat the
   * absence as a real subtitle gap and clear the auto-detected visuals.
   */
  private handleEmptyWindow(now: number): void {
    const s = this.state;
    if (now - s.autoLastVisibleAt <= AUTO_EMPTY_GRACE_MS) return;

    const needsClear =
      !!s.autoDetectedElement ||
      !s.activeContainerEl ||
      !isHealthyLockedElement(s.activeContainerEl);

    if (!needsClear) return;

    s.activeContainerEl = null;
    s.autoDetectedElement = null;
    s.autoDetectedVideo = null;
    s.autoDetectedTrackKey = null;
    s.autoNativeLastText = '';
    s.autoNativeLastVideo = null;

    if (s.isReplaceNativeMode()) this.domSwapper.restore();
    if (s.settings.triggerMode === 'full-auto') s.bilingualSubtitleText = '';

    s.notify();
  }

  /**
   * A previously-chosen track turned out to be a control region. Drop it and
   * reset if it was the active one.
   */
  private discardTrack(key: string, now: number): void {
    const s = this.state;
    s.autoTracks.delete(key);

    if (s.autoDetectedTrackKey !== key) return;

    s.activeContainerEl = null;
    s.autoDetectedElement = null;
    s.autoDetectedVideo = null;
    s.autoDetectedTrackKey = null;
    s.autoLastVisibleAt = now;

    if (s.settings.triggerMode === 'full-auto') s.bilingualSubtitleText = '';
    s.notify();
  }
}