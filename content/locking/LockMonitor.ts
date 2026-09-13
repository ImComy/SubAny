// locking/LockMonitor.ts

import type { ContentState } from '../state/ContentState';
import { normalizeSubtitleText } from '../../utils/text';

export function resolveStableContainer(clickedElement: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  const leafRect = clickedElement.getBoundingClientRect();
  let current: HTMLElement | null = clickedElement;
  let lastRemembered: HTMLElement | null = clickedElement;
  const controlSelector = 'video, button, input, [role="button"], [role="slider"]';

  for (let i = 0; i < 8 && current && current !== document.body; i++) {
    const rect = current.getBoundingClientRect();

    if (videoRect) {
      if (rect.width > videoRect.width * 1.05) break;
      if (rect.height > Math.min(videoRect.height * 0.30, 400)) break;
      if (current.matches(controlSelector) || !!current.querySelector(controlSelector)) break;
    }

    if (rect.width >= leafRect.width * 0.9) {
      lastRemembered = current;
    }

    current = current.parentElement;
  }

  return lastRemembered ?? clickedElement;
}

export function maintainLockedContainer(state: ContentState): void {
  if (!state.activeContainerEl) return;
  if (!document.documentElement.contains(state.activeContainerEl)) {
    state.activeContainerEl = null;
    state.settings.lockedSelector = null;
  }
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
    const nextText = normalizeSubtitleText(container.textContent ?? '');
    if (nextText !== state.lastObservedSubtitleText) {
      onTextChange(nextText);
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  state.lockedContainerObserver = observer;
}

export function reattachLockedContainer(_state: ContentState): HTMLElement | null {
  return _state.activeContainerEl;
}