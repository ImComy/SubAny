// translation/SubtitleTranslationController.ts

import type { ContentState } from '../state/ContentState';
import type { TranslationManager } from '../../lib/TranslationManager';
import type { DomTextSwapper } from '../replacement/DomTextSwapper';

export interface SubtitleTranslationDeps {
  translationManager: TranslationManager;
  domSwapper: DomTextSwapper;
}

/**
 * Called whenever the visible text of the active subtitle container changes
 * (from the DOM observer, the video timeupdate tick, or the auto-detection
 * monitor).
 *
 * Behaviour matches the original `handleSubtitleTextChange`:
 *
 *   - Only runs when the current trigger mode is `full-auto` or
 *     `replace-native` (or `replaceNativeSubtitles` is on).
 *   - Bails out when the text is empty or equals the last observed text.
 *   - In replace-native mode, swaps the DOM text of `activeContainerEl` with
 *     the translation, restoring the original on the next cue via the
 *     DomTextSwapper instance.
 *   - In full-auto mode, stores the translation as `bilingualSubtitleText`
 *     which SubtitleOverlay renders below the original.
 *   - Notifies the renderer at the end.
 *
 * The function is safe to call concurrently: the pending state is keyed by
 * the observed text, and the DomTextSwapper internally restores before each
 * swap.
 */
let domTranslationDebounceTimer: number | null = null;
let domTranslationToken = 0;

export async function handleSubtitleTextChange(
  state: ContentState,
  deps: SubtitleTranslationDeps,
  text: string,
): Promise<void> {
  const isReplaceNative =
    state.settings.replaceNativeSubtitles || state.settings.triggerMode === 'replace-native';
  const isFullAuto = state.settings.triggerMode === 'full-auto' && !isReplaceNative;

  if (!isReplaceNative && !isFullAuto) return;
  if (!text || text === state.lastObservedSubtitleText) return;

  const previousText = state.lastObservedSubtitleText;
  state.lastObservedSubtitleText = text;

  // Prefix growth detection: if the new text extends previous text
  // (live speech-to-text), debounce to avoid flooding translation requests.
  const isPrefixExtension = !!previousText && text.startsWith(previousText) && text.length - previousText.length < 15;
  const delay = isPrefixExtension ? 250 : 40;

  const token = ++domTranslationToken;

  if (domTranslationDebounceTimer) {
    window.clearTimeout(domTranslationDebounceTimer);
  }

  domTranslationDebounceTimer = window.setTimeout(async () => {
    try {
      const res = await deps.translationManager.translate(
        text,
        state.settings.targetLanguage,
        state.settings.sourceLanguage,
        state.settings.engine,
      );

      if (token !== domTranslationToken) return;
      if (!res.translation) return;

      if (isReplaceNative && state.activeContainerEl) {
        deps.domSwapper.swapText(state.activeContainerEl, res.translation);
      } else if (isFullAuto) {
        state.bilingualSubtitleText = res.translation;
      }

      state.notify();
    } catch (_) {
      // Ignore network errors in auto-translation
    }
  }, delay);
}

/**
 * Native TextTrack variant of the same flow. Called by the auto-detection
 * monitor when the active cue comes from `video.textTracks` rather than from
 * a DOM node.
 *
 * Uses the native token to discard results from stale requests — a new cue
 * bumps the token and any in-flight translation for the previous cue is
 * dropped on arrival.
 *
 * Behaviour matches the native-hit branch of the original
 * `updateAutoDetection`.
 */
export async function handleNativeSubtitleTextChange(
  state: ContentState,
  deps: SubtitleTranslationDeps,
  text: string,
): Promise<void> {
  const isReplaceNative =
    state.settings.replaceNativeSubtitles || state.settings.triggerMode === 'replace-native';
  const isFullAuto = state.settings.triggerMode === 'full-auto' && !isReplaceNative;

  if (!isReplaceNative && !isFullAuto) return;
  if (!text) return;

  // Note: native flow deliberately does NOT check against
  // lastObservedSubtitleText. The token comparison below is the staleness
  // guard, matching the original, which used
  // `nativeHit.text !== autoNativeLastText` for dedupe and
  // `token !== autoNativeTranslationToken` for cancellation.
  const token = ++state.autoNativeTranslationToken;

  const res = await deps.translationManager.translate(
    text,
    state.settings.targetLanguage,
    state.settings.sourceLanguage,
    state.settings.engine,
  );

  if (token !== state.autoNativeTranslationToken) return;
  if (!res.translation) return;

  if (isFullAuto) {
    state.bilingualSubtitleText = res.translation;
  }
  // Replace-native is a no-op here: there is no DOM node to swap for a
  // native TextTrack cue.

  state.notify();
}