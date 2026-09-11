// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { getVideoForElement } from '../../utils/dom';
import { combineSubtitleLines } from '../detection/SubtitleGrouping';
import { isHealthyLockedElement } from './LockedAnchor';
import {
  rememberLockedAnchor,
  updateLockedVisualProxy,
} from './SubtitleLock';
import { tryRecoverLockedContainer } from './LockRecovery';

/**
 * One tick of lock maintenance.
 *
 * Fast path: the live element is healthy — optionally re-group stacked lines
 * and re-anchor on `force`. Slow path: selector is ied —
 * hand off to `tryRecoverLockedContainer`.
 *
 * `force` is used by media events where we know the player is about to (or
 * has just) rebuilt its overlay. It bypasses the 70 ms rate-limit and also
 * refreshes the anchor snapshot after recovery.
 */
export function maintainLockedContainer(state: ContentState, force = false): void {
  if (
    (!state.settings.lockedSelector && !state.lockedSubtitleAnchor) ||
    state.isRefreshingLockedContainer
  ) {
    return;
  }

  const now = performance.now();
  if (!force && now - state.lastLockedReattachAt < 70) return;
  state.lastLockedReattachAt = now;

  updateLockedVisualProxy(state);
  const activeHealthy = isHealthyLockedElement(state.activeContainerEl);

  let needsRecovery = !activeHealthy;

  // A selector resolving is NOT enough. This specifically fixes players that
  // leave a stale wrapper mounted while its actual subtitle child is removed
  // for a fraction of a second.
  if (!needsRecovery && state.settings.lockedSelector) {
    try {
      const selectorTarget = document.querySelector(state.settings.lockedSelector) as HTMLElement | null;
      if (!isHealthyLockedElement(selectorTarget)) needsRecovery = true;
    } catch (_) {
      needsRecovery = true;
    }
  }

  // Even when the current element is healthy, re-group its stacked lines.
  // This catches players that keep one line and replace only the other.
  if (!needsRecovery && state.activeContainerEl) {
    const video = getVideoForElement(state.activeContainerEl);
    const grouped = combineSubtitleLines(state.activeContainerEl, video?.getBoundingClientRect() ?? null);
    if (isHealthyLockedElement(grouped)) {
      if (grouped !== state.activeContainerEl) {
        state.activeContainerEl = grouped;
        if (force) rememberLockedAnchor(state, grouped);
        state.notify();
      } else if (force) {
        rememberLockedAnchor(state, grouped);
      }
      return;
    }
    needsRecovery = true;
  }

  if (!needsRecovery) return;

  state.isRefreshingLockedContainer = true;
  try {
    tryRecoverLockedContainer(state);
    updateLockedVisualProxy(state);
    state.notify();
  } finally {
    state.isRefreshingLockedContainer = false;
  }
}

export function stopLockedMonitor(state: ContentState): void {
  if (state.lockedMonitorTimer !== null) {
    window.clearInterval(state.lockedMonitorTimer);
    state.lockedMonitorTimer = null;
  }
  for (const binding of state.lockedVideoEvents) {
    binding.video.removeEventListener(binding.event, binding.handler);
  }
  state.lockedVideoEvents = [];
}

/**
 * Attach the interval + media event listeners. Safe to call repeatedly — it
 * always tears down previous bindings first.
 */
export function startLockedMonitor(state: ContentState): void {
  stopLockedMonitor(state);

  // MutationObserver + media events catch most rebuilds. The lightweight
  // interval handles players that mutate through shadow/native internals
  // without producing a useful DOM mutation, and it also catches brief
  // cue teardown/recreation windows during seeking/rate changes.
  state.lockedMonitorTimer = window.setInterval(() => maintainLockedContainer(state), 140);

  const events = [
    'ratechange', 'seeking', 'seeked', 'playing', 'play', 'pause', 'canplay',
    'loadedmetadata', 'durationchange', 'emptied', 'waiting', 'stalled',
    'timeupdate', 'progress',
  ];

  for (const video of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
    for (const event of events) {
      const handler = (() => { maintainLockedContainer(state, true); }) as EventListener;
      video.addEventListener(event, handler, { passive: true });
      state.lockedVideoEvents.push({ video, event, handler });
    }
  }
}

/**
 * Public entry point used by the app when it needs a synchronous reattach
 * (e.g. on mode change).
 */
export function reattachLockedContainer(state: ContentState): HTMLElement | null {
  return tryRecoverLockedContainer(state);
}