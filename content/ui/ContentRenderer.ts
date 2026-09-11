// ui/ContentRenderer.ts

import React from 'react';
import { SubtitleOverlay } from '../../components/SubtitleOverlay';
import { Tooltip } from '../../components/Tooltip';
import type { ContentState } from '../state/ContentState';
import type { ExtensionRoot } from './ExtensionRoot';

export interface ContentRendererDeps {
  /**
   * Called when the user clicks the overlay's unlock button. Wired by
   * ContentApp to `unlockContainer`.
   */
  onUnlock: () => void;
}

/**
 * Projects `ContentState` onto the React tree.
 *
 * The renderer holds no state of its own — it reads the current ContentState
 * every time `render()` is called and pushes a fresh tree into the React
 * root. SubtitleOverlay and Tooltip remain fully controlled components.
 *
 * Calling `render()` is cheap enough to do on every notify. The React
 * reconciler diffs the tree; if nothing changed, it does nothing.
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

  /**
   * Push the current state to React.
   *
   * Matches the original `render()`:
   *   - chooses the live container when it is renderable, otherwise falls
   *     back to the invisible locked visual proxy so the overlay keeps
   *     tracking the remembered anchor through a player rebuild
   *   - passes `bilingualText` only in full-auto mode
   *   - renders Tooltip only when `tooltipState` exists
   */
  render(): void {
    const state = this.state;
    const isFullAuto = state.settings.triggerMode === 'full-auto';

    const activeRect = state.activeContainerEl?.getBoundingClientRect();
    const activeRenderable =
      !!state.activeContainerEl &&
      document.documentElement.contains(state.activeContainerEl) &&
      !!activeRect &&
      activeRect.width > 0 &&
      activeRect.height > 0;

    const root = this.extensionRoot.getRoot();

    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SubtitleOverlay, {
          glowTarget: state.settings.enableGlowEffect ? state.glowTargetEl : null,
          lockedElement: activeRenderable
            ? state.activeContainerEl
            : state.lockedVisualProxyEl,
          selectionCandidate: state.selectionCandidateEl,
          isSelecting: state.isSelecting,
          hoveredWordRect: state.hoveredWordRect,
          highlightMode: state.highlightMode,
          isLoading: state.isTranslating,
          bilingualText: isFullAuto ? state.bilingualSubtitleText : undefined,
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
}