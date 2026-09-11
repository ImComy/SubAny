// events/RuntimeMessages.ts

import type { ContentState } from '../state/ContentState';

export interface RuntimeMessagesDeps {
  /**
   * Enter selection mode. Wired by ContentApp to `startSelection`.
   */
  onStartSelection: () => void;

  /**
   * Reset the current lock and detach. Wired by ContentApp to
   * `unlockContainer`.
   */
  onResetSelection: () => void;
}

export interface RuntimeMessagesHandle {
  dispose: () => void;
}

/**
 * Handle messages from the popup / background.
 *
 * Three message types, matching the original listener:
 *
 *   - `START_SELECTION` → begin selection mode, respond `{ success: true }`
 *   - `RESET_SELECTION` → drop the lock and detach, respond `{ success: true }`
 *   - `GET_STATUS`      → respond with lock state + current settings
 *
 * `GET_STATUS` is the only one that reads `ContentState` directly; the two
 * action messages are delegated so ContentApp keeps ownership of the lock
 * side effects.
 *
 * Returning `true` from the listener keeps the `sendResponse` channel open
 * for the asynchronous handlers.
 */
export function startRuntimeMessages(
  state: ContentState,
  deps: RuntimeMessagesDeps,
): RuntimeMessagesHandle {
  const listener = (
    message: { type?: string } | undefined,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    if (!message || typeof message !== 'object') return undefined;

    if (message.type === 'START_SELECTION') {
      deps.onStartSelection();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'RESET_SELECTION') {
      deps.onResetSelection();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({
        hasLockedContainer: !!state.settings.lockedSelector,
        selector: state.settings.lockedSelector,
        settings: state.settings,
      });
      return true;
    }

    return undefined;
  };

  browser.runtime.onMessage.addListener(listener);

  return {
    dispose: () => browser.runtime.onMessage.removeListener(listener),
  };
}