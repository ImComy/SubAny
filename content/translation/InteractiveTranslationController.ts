// translation/InteractiveTranslationController.ts

import type { ContentState } from '../state/ContentState';
import { TextExtractor, type TextExtractionResult } from '../../lib/TextExtractor';
import type { TranslationManager } from '../../lib/TranslationManager';
import type { VideoController } from '../../lib/VideoController';
import { findNativeSubtitleAtPoint } from '../detection/SubtitleDetector';
import { getHitAt, isOverActiveContainer } from '../selection/SubtitleHitTester';
import {
  beginInteractiveTranslation,
  clearInteractiveTranslation,
  completeInteractiveTranslation,
  resetRangeAnchor,
} from './TranslationState';

function isPointerNearSubtitleBand(clientX: number, clientY: number, padding = 28): boolean {
  const videos = document.querySelectorAll('video');
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const bandTop = rect.top + rect.height * 0.55;
    const bandBottom = rect.bottom;
    if (
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= bandTop - padding &&
      clientY <= bandBottom + padding
    ) {
      return true;
    }
  }
  return false;
}

export interface InteractiveTranslationDeps {
  translationManager: TranslationManager;
  videoController: VideoController;
}

/**
 * Hover debounce timer. Module-scoped because there is exactly one
 * InteractiveTranslationController per content script instance, and the
 * original also kept this in the outer closure.
 */
let hoverWordTimeout: number | null = null;

/**
 * Read the current translation target from the DOM, honouring the
 * Ctrl (full phrase) and Shift (range anchor) modifiers.
 *
 * Mirrors the original `extractAt` exactly, including the side effect of
 * storing/clearing the shift-range anchor in state.
 */
export function extractAt(state: ContentState, e: MouseEvent): TextExtractionResult {
  if (e.ctrlKey) {
    return TextExtractor.getFullPhrase(e.clientX, e.clientY, state.activeContainerEl);
  }
  if (e.shiftKey) {
    if (state.rangeAnchorX !== null && state.rangeAnchorY !== null) {
      return TextExtractor.getRangeBetweenPoints(
        state.rangeAnchorX,
        state.rangeAnchorY,
        e.clientX,
        e.clientY,
      );
    }
    state.rangeAnchorX = e.clientX;
    state.rangeAnchorY = e.clientY;
    return TextExtractor.getWord(e.clientX, e.clientY, state.activeContainerEl);
  }
  resetRangeAnchor(state);
  return TextExtractor.getWord(e.clientX, e.clientY, state.activeContainerEl);
}

/**
 * Extraction that can work when the visible subtitle has no DOM node.
 * Falls back to the active native TextTrack cue when DOM extraction yields
 * nothing. Mirrors the original `extractAtUniversal`.
 */
export function extractAtUniversal(state: ContentState, e: MouseEvent): TextExtractionResult {
  const domExtraction = extractAt(state, e);
  if (domExtraction.text) return domExtraction;

  const nativeHit = findNativeSubtitleAtPoint(e.clientX, e.clientY);
  if (nativeHit) {
    return {
      text: nativeHit.text,
      rect: nativeHit.rect,
      mode: e.ctrlKey || e.shiftKey ? 'phrase' : 'word',
    };
  }

  return domExtraction;
}

/**
 * Kick off a translation for the given extraction and pop the tooltip.
 *
 * Mirrors the original `doTranslate`. Notably:
 *   - Empty text clears tooltip/highlight and returns without rendering a
 *     stale tooltip.
 *   - Video is paused (when the setting is on) before the network call.
 *   - The result is only applied if the tooltip's original text still
 *     matches, so a newer request is never overwritten by an older one.
 */
export async function doTranslate(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  extraction: TextExtractionResult,
  clientX: number,
  clientY: number,
): Promise<void> {
  if (!extraction.text) {
    clearInteractiveTranslation(state);
    state.notify();
    return;
  }

  beginInteractiveTranslation(state, extraction, clientX, clientY, state.settings.engine);
  state.notify();

  if (state.settings.pauseVideoOnHover) deps.videoController.pause();

  const { translation, engineUsed } = await deps.translationManager.translate(
    extraction.text,
    state.settings.targetLanguage,
    state.settings.sourceLanguage,
    state.settings.engine,
  );

  completeInteractiveTranslation(state, extraction.text, translation, engineUsed);
  state.notify();
}

/**
 * Document-level mousemove handler.
 *
 * Matches the original anonymous listener:
 *   - Skipped while selection mode is active.
 *   - When the cursor is over the active container (DOM) or over a native
 *     cue, arms a short debounce that reads the current target and translates.
 *   - When the cursor leaves, clears the tooltip/highlight and resumes video
 *     if it was paused by the extension.
 */
export function handleInteractiveMouseMove(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  e: MouseEvent,
): void {
  if (state.isSelecting || state.settings.triggerMode !== 'hover') return;
  if (!state.activeContainerEl && !state.tooltipState && !state.hoveredWordRect && !state.virtualSelectionHit) return;
  if (!isPointerNearSubtitleBand(e.clientX, e.clientY, 28) && !state.tooltipState && !state.hoveredWordRect) return;

  const universalHit = getHitAt(e.clientX, e.clientY);
  const overDomSubtitle = isOverActiveContainer(state, e);
  const overNativeSubtitle = !!universalHit.native;

  if (overDomSubtitle || overNativeSubtitle) {
    if (overNativeSubtitle && universalHit.native) {
      state.hoveredWordRect = universalHit.native.rect;
    }

    if (hoverWordTimeout) window.clearTimeout(hoverWordTimeout);
    hoverWordTimeout = window.setTimeout(() => {
      const extraction = extractAtUniversal(state, e);
      if (extraction.text) {
        void doTranslate(state, deps, extraction, e.clientX, e.clientY);
      }
    }, 35);
  } else if (state.tooltipState || state.hoveredWordRect) {
    clearInteractiveTranslation(state);
    state.notify();
    if (state.settings.pauseVideoOnHover) deps.videoController.resume(180);
  }
}

/**
 * Document-level click handler.
 *
 * Matches the original listener: only fires a translation when the user is
 * in `click` trigger mode and the cursor is over the active container or a
 * native cue.
 */
export function handleInteractiveClick(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  e: MouseEvent,
): void {
  if (state.isSelecting || state.settings.triggerMode !== 'click') return;
  if (!state.activeContainerEl && !state.virtualSelectionHit) return;
  if (!isPointerNearSubtitleBand(e.clientX, e.clientY, 28)) return;

  const universalHit = getHitAt(e.clientX, e.clientY);
  if (isOverActiveContainer(state, e) || universalHit.native) {
    const extraction = extractAtUniversal(state, e);
    if (extraction.text) {
      void doTranslate(state, deps, extraction, e.clientX, e.clientY);
    }
  }
}

/**
 * Document-level keydown handler for the Ctrl-held phrase refresh.
 *
 * Matches the original listener: while a tooltip is visible, pressing
 * Control re-reads the full phrase at the tooltip's stored position and
 * re-translates when the text differs from what is already shown.
 *
 * Note the deliberate difference from `extractAt`'s Ctrl path: the original
 * passes no container to `getFullPhrase` here, so we do the same.
 */
export function handleInteractiveKeyDown(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  e: KeyboardEvent,
): void {
  if (!state.tooltipState || !state.activeContainerEl) return;
  if (e.key !== 'Control') return;

  const fresh = TextExtractor.getFullPhrase(state.tooltipState.x, state.tooltipState.y);
  if (fresh.text && fresh.text !== state.tooltipState.originalText) {
    void doTranslate(state, deps, fresh, state.tooltipState.x, state.tooltipState.y);
  }
}

/**
 * Cancel any pending hover debounce. Called on teardown / mode change so a
 * queued timer cannot fire against a torn-down state.
 */
export function cancelInteractiveHover(): void {
  if (hoverWordTimeout) {
    window.clearTimeout(hoverWordTimeout);
    hoverWordTimeout = null;
  }
}