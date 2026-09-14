// ui/ContentRenderer.ts

import React from 'react';
import { SubtitleOverlay } from '../../components/SubtitleOverlay';
import { Tooltip } from '../../components/Tooltip';
import type { ContentState } from '../state/ContentState';
import type { ExtensionRoot } from './ExtensionRoot';
import { getDeepestTextContainer } from '../../utils/dom';

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
   * The lock points at a *stable wrapper* (survives cue changes). That wrapper
   * often has a fixed width — on videasy it's `w-[90%]`, so 524 px regardless
   * of the visible text. The dashed indicator must be drawn around the
   * *visible text*, not the wrapper, or it spans the entire video width when
   * the cue is short.
   *
   * So: the lock observer targets `state.activeContainerEl`, but the overlay
   * targets `getDeepestTextContainer(state.activeContainerEl)` — the current
   * leaf. On every cue change, the observer fires `state.notify()`, this
   * renderer re-runs, `getDeepestTextContainer` returns the new leaf, and the
   * box snaps to the new text bounds.
   *
   * `getDeepestTextContainer` descends through single-child wrappers using
   * only `textContent` and `children` — no `innerText`, no `getComputedStyle`,
   * no forced layout. Cost is O(depth), typically 1–4 levels. This satisfies
   * the AGENTS.md performance contract.
   *
   * Fallback order:
   *   1. Deepest text descendant of `activeContainerEl`, when renderable.
   *   2. `activeContainerEl` itself, when the deepest leaf is temporarily
   *      empty (a normal cue transition) but the wrapper still has size.
   *   3. `lockedVisualProxyEl` (the invisible proxy at the remembered anchor
   *      position) when the container is genuinely absent.
   */
  render(): void {
    const state = this.state;
    const isFullAuto = state.settings.triggerMode === 'full-auto';

    const rectTarget = this.resolveRectTarget();

    const activeRect = rectTarget?.getBoundingClientRect();
    const renderable =
      !!rectTarget &&
      document.documentElement.contains(rectTarget) &&
      !!activeRect &&
      activeRect.width > 0 &&
      activeRect.height > 0;

    const lockedElement = renderable
      ? rectTarget
      : state.lockedVisualProxyEl;

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

  /**
   * Resolve which DOM element the overlay should position itself against.
   *
   * Priority:
   *   1. The deepest text-bearing descendant of the locked container —
   *      this is what the user actually sees as the caption.
   *   2. The locked container itself, when the leaf is temporarily empty
   *      (a normal cue transition) but the wrapper still has non-zero size.
   *   3. `null` — the caller falls back to `lockedVisualProxyEl`.
   */
  private resolveRectTarget(): HTMLElement | null {
    const container = this.state.activeContainerEl;
    if (!container) return null;
    if (!document.documentElement.contains(container)) return null;

    // Descend to the current leaf. On most players this is 1–4 levels deep.
    // Never forces layout: uses textContent and children only.
    const leaf = getDeepestTextContainer(container);

    // Prefer the leaf when it has real text.
    const leafText = (leaf.textContent ?? '').trim();
    if (leafText.length > 0) {
      const r = leaf.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return leaf;
    }

    // Cue transition: leaf is momentarily empty. Use the wrapper if it still
    // has non-zero size, so the dashed box doesn't flicker off and on between
    // sentences.
    const wrapperRect = container.getBoundingClientRect();
    if (wrapperRect.width > 0 && wrapperRect.height > 0) return container;

    return null;
  }
}