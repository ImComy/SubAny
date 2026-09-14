// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { normalizeSubtitleText } from '../../utils/text';

export function resolveStableContainer(clickedElement: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  let current: HTMLElement | null = clickedElement;
  let bestContainer: HTMLElement = clickedElement;
  const controlSelector = 'video, button, input, [role="button"], [role="slider"]';

  for (let i = 0; i < 6 && current && current !== document.body && current !== document.documentElement; i++) {
    if (current.tagName.toLowerCase() === 'video') break;
    if (current.classList.contains('html5-video-player') || current.classList.contains('video-stream')) break;
    if (current.matches(controlSelector) || !!current.querySelector(controlSelector)) break;

    const rect = current.getBoundingClientRect();
    if (videoRect) {
      if (rect.width > videoRect.width * 0.90 && rect.height > videoRect.height * 0.15) break;
      if (rect.width > videoRect.width * 0.98) break;
      if (rect.height > Math.min(videoRect.height * 0.35, 300)) break;
    }

    const className = typeof current.className === 'string' ? current.className : '';
    const isExplicitCaptionWindow =
      /(caption-window|ytp-caption-window|subtitle-window|captions-display|cue-container)/i.test(className) &&
      !className.includes('caption-window-container');
    if (isExplicitCaptionWindow) {
      bestContainer = current;
      break;
    }

    if (/(caption|subtitle|cue|timedtext)/i.test(className) && !className.startsWith('subany-')) {
      bestContainer = current;
    } else if (bestContainer === clickedElement && current.parentElement) {
      bestContainer = current;
    }

    current = current.parentElement;
  }

  console.log('[SubAny] locked container:', bestContainer.className, bestContainer.getBoundingClientRect());
  return bestContainer;
}

export function maintainLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  const selector = state.settings.lockedSelector;
  if (!selector) return;

  // 1. If activeContainerEl is still connected to the DOM, no-op (0.0001 ms)
  if (state.activeContainerEl && document.documentElement.contains(state.activeContainerEl)) {
    return;
  }

  // 2. Disconnected: try fast querySelector using the lockedSelector (0.01 ms)
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) {
      state.activeContainerEl = el;
      startLockedMonitor(state, onTextChange);
      return;
    }
  } catch (_) {
    // Ignore invalid selector syntax
  }

  // 3. Not found currently (e.g. captions unmounted during silence/pause):
  // Do NOTHING! Do not scan player elements. Do not delete lockedSelector!
  state.activeContainerEl = null;
}

export function stopLockedMonitor(state: ContentState): void {
  state.lockedContainerObserver?.disconnect();
  state.lockedContainerObserver = null;
}

export function startLockedMonitor(
  state: ContentState,
  onTextChange?: (text: string) => void,
): void {
  stopLockedMonitor(state);

  const container = state.activeContainerEl;
  if (!container || !onTextChange) return;

  const observer = new MutationObserver(() => {
    // Zero forced reflow: uses textContent
    const nextText = normalizeSubtitleText(container.textContent ?? '');
    if (nextText !== state.lastObservedSubtitleText) {
      if (!nextText) {
        state.bilingualSubtitleText = '';
        state.lastObservedSubtitleText = '';
        state.notify();
      } else {
        onTextChange(nextText);
      }
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  state.lockedContainerObserver = observer;
}

export function reattachLockedContainer(
  state: ContentState,
  onTextChange?: (text: string) => void,
): HTMLElement | null {
  maintainLockedContainer(state, onTextChange);
  return state.activeContainerEl;
}