// state/ContentState.ts

import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../lib/types';
import type {
  AutoTrackState,
  HighlightMode,
  LockedSubtitleAnchor,
  TooltipState,
} from './types';

/**
 * Shared mutable state for a ContentApp instance.
 *
 * Every controller reads/writes this object. `notify()` triggers a React
 * re-render through the renderer callback wired up by ContentApp.
 */
export class ContentState {
  settings: ExtensionSettings = { ...DEFAULT_SETTINGS };

  // DOM container the extension is currently attached to (either locked or
  // auto-tracked).
  activeContainerEl: HTMLElement | null = null;

  // Transient glow highlight target.
  glowTargetEl: HTMLElement | null = null;

  // Selection mode.
  isSelecting = false;
  selectionCandidateEl: HTMLElement | null = null;

  // Hover/word highlight.
  hoveredWordRect: DOMRect | null = null;
  highlightMode: HighlightMode = 'word';
  isTranslating = false;

  // Shift+range anchor.
  rangeAnchorX: number | null = null;
  rangeAnchorY: number | null = null;

  // Tooltip.
  tooltipState: TooltipState | null = null;

  // Full-auto bilingual text.
  bilingualSubtitleText = '';
  lastObservedSubtitleText = '';
  externalSubtitleText = '';
  externalSubtitleVideo: HTMLVideoElement | null = null;

  // Locking.
  lockedSubtitleAnchor: LockedSubtitleAnchor | null = null;
  lockedVideoElement: HTMLVideoElement | null = null;
  lockedVideoSignature = '';
  lockedVisualProxyEl: HTMLDivElement | null = null;
  lockedVisualProxyStyle: CSSStyleDeclaration | null = null;
  lockedContainerObserver: MutationObserver | null = null;

  // Auto-tracking.
  autoDetectionTimer: number | null = null;
  autoDetectionRunning = false;
  autoDetectionDisabled = false;
  autoDetectionRequested = false;
  autoDetectedElement: HTMLElement | null = null;
  autoDetectedVideo: HTMLVideoElement | null = null;
  autoDetectedTrackKey: string | null = null;
  autoLastVisibleAt = 0;
  autoTracks = new Map<string, AutoTrackState>();
  autoNativeLastText = '';
  autoNativeLastVideo: HTMLVideoElement | null = null;
  autoNativeTranslationToken = 0;

  // Virtual native selection hit (SubtitleOverlay uses this rect).
  virtualSelectionHit: import('../detection/NativeSubtitleDetector').NativeSubtitleHit | null = null;

  // Video timeupdate handler currently bound by ContentApp (if any).
  videoTimeUpdateHandler: ((e: Event) => void) | null = null;

  // Render hook, installed by ContentRenderer.
  onRender: (() => void) | null = null;
  private renderScheduled = false;

  notify(): void {
    if (!this.onRender) return;
    if (this.renderScheduled) return;

    this.renderScheduled = true;
    window.requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.onRender?.();
    });
  }

  // Mode helpers (kept here so every controller uses the same source of truth).
  isAutomaticSubtitleMode(): boolean {
    return (
      this.settings.triggerMode === 'full-auto' ||
      this.settings.triggerMode === 'replace-native' ||
      this.settings.replaceNativeSubtitles
    );
  }

  isReplaceNativeMode(): boolean {
    return this.settings.replaceNativeSubtitles || this.settings.triggerMode === 'replace-native';
  }
}