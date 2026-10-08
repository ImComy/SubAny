// ui/ContentRenderer.ts

import React from 'react';
import { SubtitleOverlay } from '../../components/SubtitleOverlay';
import { Tooltip } from '../../components/Tooltip';
import type { ContentState } from '../state/ContentState';
import type { ExtensionRoot } from './ExtensionRoot';
import { getVideoForElement, resolveCaptionLineContainer } from '../../utils/dom';
import { combineSubtitleLines, isMultiLineSubtitleContainer } from '../detection/SubtitleGrouping';

export interface ContentRendererDeps {
  onUnlock: () => void;
  delegateTooltip?: boolean;
}

/**
 * Elements whose text is UI chrome, never part of the caption itself.
 * Text nodes found inside these (or their descendants) are excluded from
 * the visual-bounds calculation.
 */
const NON_CAPTION_CLOSEST =
  'button, a, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]';

/**
 * Union of the on-screen glyph bounds of every caption text node inside
 * `root`, excluding anything inside interactive/UI elements.
 *
 * Critically, this uses a Range over individual TEXT NODES, never over an
 * element. `Range.selectNodeContents(blockElement)` can return the block's
 * line-box (full container width) even when the visible glyphs occupy only
 * a small centered span. Range over a text node always returns the actual
 * rendered run.
 *
 * Returns null when no visible text was found.
 */
function measureCaptionBounds(root: Element): DOMRect | null {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ?? '';
      if (!text.trim()) return NodeFilter.FILTER_REJECT;

      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(NON_CAPTION_CLOSEST)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('#subany-extension-root')) return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  let found = false;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const range = doc.createRange();
    range.selectNodeContents(node);

    for (const r of Array.from(range.getClientRects())) {
      if (r.width <= 0 && r.height <= 0) continue;
      if (r.left < minL) minL = r.left;
      if (r.top < minT) minT = r.top;
      if (r.right > maxR) maxR = r.right;
      if (r.bottom > maxB) maxB = r.bottom;
      found = true;
    }
  }

  if (!found) return null;
  return new DOMRect(minL, minT, maxR - minL, maxB - minT);
}

/**
 * Fallback used only when the text-node walk yields nothing (rare — e.g.
 * a container whose caption is drawn by an element with no text nodes,
 * such as an image-replacement or an SVG-caption player).
 */
function measureElementBounds(target: Element): DOMRect | null {
  const range = (target.ownerDocument || document).createRange();
  range.selectNodeContents(target);

  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0,
  );
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Projects `ContentState` onto the React tree.
 */
export class ContentRenderer {
  private readonly state: ContentState;
  private readonly extensionRoot: ExtensionRoot;
  private readonly deps: ContentRendererDeps;

  constructor(
    state: ContentState,
    extensionRoot: ExtensionRoot,
    deps: ContentRendererDeps,
  ) {
    this.state = state;
    this.extensionRoot = extensionRoot;
    this.deps = deps;
  }

  render(): void {
    const state = this.state;
    const isFullAuto = state.settings.triggerMode === 'full-auto';

    const target = this.resolveRectTarget();
    const visualRect = this.resolveVisualRect(target);

    // The lock target may be a stable wrapper (survives cue changes).
    // Renderability is judged from the wrapper itself, not from the visual
    // rect, so an empty-but-present wrapper still counts as "locked".
    const activeRect = target?.getBoundingClientRect();
    const activeRenderable =
      !!target &&
      target.isConnected &&
      !!activeRect &&
      activeRect.width > 0 &&
      activeRect.height > 0;

    const lockedElement = activeRenderable ? target : null;

    const root = this.extensionRoot.getRoot();

    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SubtitleOverlay, {
          glowTarget: state.settings.enableGlowEffect ? state.glowTargetEl : null,
          lockedElement,
          lockedRect: activeRenderable ? visualRect : null,
          selectionCandidate: state.selectionCandidateEl,
          isSelecting: state.isSelecting,
          nativeSelectionRect: state.virtualSelectionHit?.rect ?? null,
          hoveredWordRect: state.hoveredWordRect,
          highlightMode: state.highlightMode,
          isLoading: state.isTranslating,
          bilingualText: isFullAuto ? state.bilingualSubtitleText : undefined,
          externalSubtitleText: state.externalSubtitleText,
          externalSubtitleVideo: state.externalSubtitleVideo,
          subtitleDelayMs: state.settings.subtitleDelayMs,
          targetLang: state.settings.targetLanguage,
          onUnlock: this.deps.onUnlock,
        }),
        (state.tooltipState && !this.deps.delegateTooltip)
          ? React.createElement(Tooltip, {
              x: state.tooltipState.x,
              y: state.tooltipState.y,
              originalText: state.tooltipState.originalText,
              translatedText: state.tooltipState.translatedText,
              engineUsed: state.tooltipState.engineUsed,
              mode: state.tooltipState.mode,
              isLoading: state.isTranslating,
              targetLang: state.settings.targetLanguage,
            })
          : null,
      ),
    );
  }

  /**
   * The lock target is the container itself.
   *
   * We deliberately do NOT descend to a "deepest text leaf". On real
   * players the caption is often split across multiple sibling spans (one
   * per line, one per speaker change, one per karaoke fragment). Picking a
   * single leaf produces a box around one line only, which is worse than
   * useless.
   *
   * The container's own `getBoundingClientRect` is only used to check
   * renderability. The visible dashed box is driven by `resolveVisualRect`,
   * which measures text nodes.
   */
  private resolveRectTarget(): HTMLElement | null {
    const container = this.state.activeContainerEl;
    if (!container || !container.isConnected) return null;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const video = getVideoForElement(container);
    const videoRect = video?.getBoundingClientRect() ?? null;

    if (isMultiLineSubtitleContainer(container, videoRect)) {
      return container;
    }

    const lineTarget = resolveCaptionLineContainer(container, videoRect);
    return combineSubtitleLines(lineTarget, videoRect);
  }

  /**
   * Tight on-screen bounds of the caption text inside `target`.
   *
   * Primary path: union of Range rects over every non-UI text node.
   * Fallback: element-level Range (used only if there are no text nodes
   * to walk — e.g. an image-replacement caption).
   */
  private resolveVisualRect(target: HTMLElement | null): DOMRect | null {
    if (!target) return null;

    const tight = measureCaptionBounds(target);
    if (tight) return tight;

    const elementRect = measureElementBounds(target);
    if (elementRect) return elementRect;

    const liveRect = target.getBoundingClientRect();
    if (liveRect.width > 0 && liveRect.height > 0) {
      return liveRect;
    }

    return null;
  }
}