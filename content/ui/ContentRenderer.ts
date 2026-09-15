// ui/ContentRenderer.ts

import React from 'react';
import { SubtitleOverlay } from '../../components/SubtitleOverlay';
import { Tooltip } from '../../components/Tooltip';
import type { ContentState } from '../state/ContentState';
import type { ExtensionRoot } from './ExtensionRoot';
import { getDeepestTextContainer } from '../../utils/dom';
import { isSubtitleText } from '../../utils/text';

export interface ContentRendererDeps {
  onUnlock: () => void;
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

    const activeRect = target?.getBoundingClientRect();
    const activeRenderable =
      !!target &&
      document.documentElement.contains(target) &&
      !!activeRect &&
      activeRect.width > 0 &&
      activeRect.height > 0;

    // No fallback to the visual proxy. If nothing valid was found, hide the
    // box. Attempting to project a stale position onto the player chrome is
    // exactly the bug that made the box jump to the controls during silence.
    const lockedElement = activeRenderable ? target : null;

    const root = this.extensionRoot.getRoot();

    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SubtitleOverlay, {
          glowTarget: state.settings.enableGlowEffect ? state.glowTargetEl : null,
          lockedElement,
          selectionCandidate: state.selectionCandidateEl,
          isSelecting: state.isSelecting,
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
        state.tooltipState
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

  private resolveRectTarget(): HTMLElement | null {
    const container = this.state.activeContainerEl;
    if (!container || !document.documentElement.contains(container)) return null;

    const leaf = getDeepestTextContainer(container);
    const leafText = (leaf.textContent ?? '').trim();
    if (leafText.length > 0 && isSubtitleText(leafText)) {
      const r = leaf.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return leaf;
    }

    const containerText = (container.textContent ?? '').trim();
    if (containerText.length === 0) return null;
    if (!isSubtitleText(containerText)) return null;

    const wrapperRect = container.getBoundingClientRect();
    if (wrapperRect.width > 0 && wrapperRect.height > 0) return container;

    return null;
  }
}