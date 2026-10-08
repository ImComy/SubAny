// translation/InteractiveTranslationController.ts

import type { ContentState } from '../state/ContentState';
import { TextExtractor, type TextExtractionResult } from '../../lib/TextExtractor';
import type { TranslationManager } from '../../lib/TranslationManager';
import type { VideoController } from '../../lib/VideoController';
import { findNativeSubtitleAtPoint, findNativeWordAtPoint } from '../detection/SubtitleDetector';
import { getHitAt, isOverActiveContainer } from '../selection/SubtitleHitTester';
import { isSubtitleText } from '../../utils/text';
import { getSubtitleAcceptanceRegion } from '../../utils/dom';
import {
  beginInteractiveTranslation,
  clearInteractiveTranslation,
  completeInteractiveTranslation,
  resetRangeAnchor,
} from './TranslationState';

function isPointerNearSubtitleBand(clientX: number, clientY: number, padding = 28): boolean {
  const videos = document.querySelectorAll('video');
  for (const video of videos) {
    const region = getSubtitleAcceptanceRegion(video);
    if (
      clientX >= region.left - padding &&
      clientX <= region.right + padding &&
      clientY >= region.top - padding &&
      clientY <= region.bottom + padding
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
 * InteractiveTranslationController per content script instance.
 */
let hoverWordTimeout: number | null = null;

/**
 * Read the current translation target from the DOM, honouring the
 * Ctrl (full phrase) and Shift (range anchor) modifiers.
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
 * nothing.
 */
export function extractAtUniversal(state: ContentState, e: MouseEvent): TextExtractionResult {
  if (state.virtualSelectionHit) {
    const rect = state.virtualSelectionHit.rect;
    const insideNativeCue =
      e.clientX >= rect.left - 8 && e.clientX <= rect.right + 8 &&
      e.clientY >= rect.top - 8 && e.clientY <= rect.bottom + 8;
    if (!insideNativeCue) return { text: '', rect: null, mode: 'word' };

    if (e.ctrlKey || e.shiftKey) {
      return {
        text: state.virtualSelectionHit.text,
        rect: state.virtualSelectionHit.rect,
        mode: 'phrase',
      };
    }

    const nativeWord = findNativeWordAtPoint(state.virtualSelectionHit, e.clientX, e.clientY);
    if (nativeWord) {
      return { text: nativeWord.text, rect: nativeWord.rect, mode: 'word' };
    }

    return { text: '', rect: null, mode: 'word' };
  }

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
 * The `isSubtitleText` guard is the single funnel that catches anything
 * an extraction path can accidentally return when a site reuses the caption
 * node for other content. The most common case is a player that swaps its
 * caption text for the timeline between cues (`38:05 / 01:07:17`), causing
 * a hover over that region to extract the digits `"38"` and "translate"
 * them into `"38"`. Without this guard the tooltip looks like the extension
 * is confusing player chrome for a subtitle.
 *
 * Because every extraction path (getWord, getFullPhrase,
 * getRangeBetweenPoints, native TextTrack fallback) funnels through here,
 * one check is enough to cover all of them.
 */
export async function doTranslate(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  extraction: TextExtractionResult,
  clientX: number,
  clientY: number,
): Promise<void> {
  if (!extraction.text || !isSubtitleText(extraction.text)) {
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
 * Skipped while selection mode is active, or when the trigger mode is not
 * `hover`. When the cursor is over the active container (DOM) or a native
 * cue, arms a short debounce that reads the target and translates. When the
 * cursor leaves, clears the tooltip/highlight and resumes video if it was
 * paused by the extension.
 */
export function handleInteractiveMouseMove(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  e: MouseEvent,
): void {
  if (state.isSelecting || state.settings.triggerMode !== 'hover') return;
  if (!state.activeContainerEl && !state.tooltipState && !state.hoveredWordRect && !state.virtualSelectionHit) return;
  if (!isPointerNearSubtitleBand(e.clientX, e.clientY, 28) && !state.tooltipState && !state.hoveredWordRect && !isOverActiveContainer(state, e)) return;

  const activeRect = state.activeContainerEl?.getBoundingClientRect();
  const activeContainsPointer = !!activeRect &&
    e.clientX >= activeRect.left - 6 &&
    e.clientX <= activeRect.right + 6 &&
    e.clientY >= activeRect.top - 6 &&
    e.clientY <= activeRect.bottom + 6;

  if (state.activeContainerEl && activeContainsPointer) {
    const extraction = extractAt(state, e);
    if (extraction.text) {
      state.hoveredWordRect = extraction.rect;
      state.notify();
      if (hoverWordTimeout) window.clearTimeout(hoverWordTimeout);
      hoverWordTimeout = window.setTimeout(() => {
        void doTranslate(state, deps, extraction, e.clientX, e.clientY);
      }, 35);
      return;
    } else {
      if (hoverWordTimeout) {
        window.clearTimeout(hoverWordTimeout);
        hoverWordTimeout = null;
      }
      if (state.hoveredWordRect || state.tooltipState) {
        clearInteractiveTranslation(state);
        state.notify();
        if (state.settings.pauseVideoOnHover) deps.videoController.resume(180);
      }
      return;
    }
  }

  if (state.virtualSelectionHit) {
    const extraction = extractAtUniversal(state, e);
    if (extraction.text) {
      state.hoveredWordRect = extraction.rect;
      state.notify();
      if (hoverWordTimeout) window.clearTimeout(hoverWordTimeout);
      hoverWordTimeout = window.setTimeout(() => {
        void doTranslate(state, deps, extraction, e.clientX, e.clientY);
      }, 35);
      return;
    } else {
      if (hoverWordTimeout) {
        window.clearTimeout(hoverWordTimeout);
        hoverWordTimeout = null;
      }
      if (state.hoveredWordRect || state.tooltipState) {
        clearInteractiveTranslation(state);
        state.notify();
        if (state.settings.pauseVideoOnHover) deps.videoController.resume(180);
      }
      return;
    }
  }

  const hoveredTarget = e.target as HTMLElement | null;
  const tContainsActive = !!state.activeContainerEl && !!hoveredTarget && state.activeContainerEl.contains(hoveredTarget);
  const overDomSubtitle = activeContainsPointer || tContainsActive || isOverActiveContainer(state, e);

  if (overDomSubtitle) {
    const extraction = extractAt(state, e);
    if (extraction.text) {
      state.hoveredWordRect = extraction.rect;
      state.notify();
      if (hoverWordTimeout) window.clearTimeout(hoverWordTimeout);
      hoverWordTimeout = window.setTimeout(() => {
        void doTranslate(state, deps, extraction, e.clientX, e.clientY);
      }, 35);
    } else {
      if (hoverWordTimeout) {
        window.clearTimeout(hoverWordTimeout);
        hoverWordTimeout = null;
      }
      if (state.hoveredWordRect || state.tooltipState) {
        clearInteractiveTranslation(state);
        state.notify();
        if (state.settings.pauseVideoOnHover) deps.videoController.resume(180);
      }
    }
  } else if (state.tooltipState || state.hoveredWordRect) {
    if (hoverWordTimeout) {
      window.clearTimeout(hoverWordTimeout);
      hoverWordTimeout = null;
    }
    clearInteractiveTranslation(state);
    state.notify();
    if (state.settings.pauseVideoOnHover) deps.videoController.resume(180);
  }
}

/**
 * Document-level click handler.
 *
 * Only fires a translation when the user is in `click` trigger mode and the
 * cursor is over the active container or a native cue.
 */
export function handleInteractiveClick(
  state: ContentState,
  deps: InteractiveTranslationDeps,
  e: MouseEvent,
): void {
  if (state.isSelecting || state.settings.triggerMode !== 'click') return;
  if (!state.activeContainerEl && !state.virtualSelectionHit) return;
  if (!isPointerNearSubtitleBand(e.clientX, e.clientY, 28) && !isOverActiveContainer(state, e)) return;

  const activeRect = state.activeContainerEl?.getBoundingClientRect();
  const activeContainsPointer = !!activeRect &&
    e.clientX >= activeRect.left - 6 &&
    e.clientX <= activeRect.right + 6 &&
    e.clientY >= activeRect.top - 6 &&
    e.clientY <= activeRect.bottom + 6;

  if (state.activeContainerEl && activeContainsPointer) {
    const extraction = extractAt(state, e);
    if (extraction.text) {
      void doTranslate(state, deps, extraction, e.clientX, e.clientY);
    }
    return;
  }

  if (state.virtualSelectionHit) {
    const extraction = extractAtUniversal(state, e);
    if (extraction.text) {
      void doTranslate(state, deps, extraction, e.clientX, e.clientY);
    }
  }

  const hoveredTarget = e.target as HTMLElement | null;
  const tContainsActive = !!state.activeContainerEl && !!hoveredTarget && state.activeContainerEl.contains(hoveredTarget);
  if (activeContainsPointer || tContainsActive || isOverActiveContainer(state, e)) {
    const extraction = extractAt(state, e);
    if (extraction.text) {
      void doTranslate(state, deps, extraction, e.clientX, e.clientY);
    }
  }
}

/**
 * Document-level keydown handler for the Ctrl-held phrase refresh.
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
 * Cancel any pending hover debounce. Called on teardown / mode change.
 */
export function cancelInteractiveHover(): void {
  if (hoverWordTimeout) {
    window.clearTimeout(hoverWordTimeout);
    hoverWordTimeout = null;
  }
}