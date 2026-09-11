// translation/TranslationState.ts

import type { ContentState } from '../state/ContentState';
import type { TextExtractionResult } from '../../lib/TextExtractor';
import type { HighlightMode, TooltipState } from '../state/types';

/**
 * Pure transition helpers over the translation-related fields on
 * `ContentState`. These do NOT touch the DOM, the network, or the renderer —
 * they only shape state. The controllers wire them together.
 */

/**
 * Prepare a fresh interactive-translation request: highlight the extracted
 * rect, stash the pending tooltip, mark as loading.
 *
 * Mirrors the state mutations at the top of the original `doTranslate`.
 */
export function beginInteractiveTranslation(
  state: ContentState,
  extraction: TextExtractionResult,
  clientX: number,
  clientY: number,
  engine: string,
): void {
  state.hoveredWordRect = extraction.rect;
  state.highlightMode = extraction.mode as HighlightMode;
  state.isTranslating = true;
  state.tooltipState = {
    x: clientX,
    y: clientY,
    originalText: extraction.text,
    translatedText: '',
    engineUsed: engine,
    mode: extraction.mode as HighlightMode,
  };
}

/**
 * Apply a completed translation to the pending tooltip.
 *
 * Guarded by the original text so a stale request cannot overwrite a newer
 * one. Mirrors the tail of the original `doTranslate`.
 */
export function completeInteractiveTranslation(
  state: ContentState,
  originalText: string,
  translation: string,
  engineUsed: string | undefined,
): void {
  state.isTranslating = false;
  if (state.tooltipState && state.tooltipState.originalText === originalText) {
    state.tooltipState = { ...state.tooltipState, translatedText: translation, engineUsed };
  }
}

/**
 * Drop any in-flight / displayed interactive translation. Used when the
 * pointer leaves the subtitle, when the extraction is empty, and on teardown.
 */
export function clearInteractiveTranslation(state: ContentState): void {
  state.tooltipState = null;
  state.hoveredWordRect = null;
  state.isTranslating = false;
}

/**
 * Reset the shift+drag anchor used by range extraction. Called whenever a
 * fresh extraction occurs without the shift modifier held.
 */
export function resetRangeAnchor(state: ContentState): void {
  state.rangeAnchorX = null;
  state.rangeAnchorY = null;
}

/**
 * Bump the native-auto translation token. Any previously-started async
 * translation that captured an older token is considered stale.
 *
 * Mirrors the `++autoNativeTranslationToken` pattern in the original content
 * script.
 */
export function bumpNativeToken(state: ContentState): number {
  return ++state.autoNativeTranslationToken;
}

export function isCurrentNativeToken(state: ContentState, token: number): boolean {
  return state.autoNativeTranslationToken === token;
}