// events/DomObserver.ts

import type { ContentState } from '../state/ContentState';
import { debounce } from '../../utils/debounce';

export interface DomObserverDeps {
  /**
   * Called (debounced) whenever the document body mutates.
   *
   * ContentApp implements this to:
   *   - maintain the locked container, or run auto-detection
   *   - re-translate when the active container's text changed
   *   - clear bilingual state on an empty cue
   *
   * Matches the body of the original `onDomChange`.
   */
  onDomChange: () => void;
}

export interface DomObserverHandle {
  dispose: () => void;
}

const DEBOUNCE_MS = 240;

/**
 * Attach a subtree MutationObserver to `document.body`. Debounced so a burst
 * of player mutations produces a single orchestration pass.
 *
 * Matches:
 *   const onDomChange = debounce(() => { ... }, 180);
 *   const subtitleObserver = new MutationObserver(onDomChange);
 *   subtitleObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
 */
export function startDomObserver(
  _state: ContentState,
  deps: DomObserverDeps,
): DomObserverHandle {
  const debounced = debounce(() => deps.onDomChange(), DEBOUNCE_MS);
  const observer = new MutationObserver(debounced);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return {
    dispose: () => observer.disconnect(),
  };
}