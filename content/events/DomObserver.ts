import type { ContentState } from '../state/ContentState';
import { debounce } from '../../utils/debounce';
import { invalidateVideoCache } from '../../utils/dom';

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
  doc: Document = document,
): DomObserverHandle {
  const debounced = debounce(() => {
    invalidateVideoCache();
    deps.onDomChange();
  }, DEBOUNCE_MS);
  const observer = new MutationObserver(debounced);
  const target = doc.body || doc.documentElement;
  if (target) {
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcdoc'],
    });
  }

  return {
    dispose: () => observer.disconnect(),
  };
}