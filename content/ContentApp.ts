// content/ContentApp.ts

import { DEFAULT_SETTINGS, type ExtensionSettings } from '../lib/types';
import { SubtitleManager } from '../lib/SubtitleManager.ts';
import { TranslationManager } from '../lib/TranslationManager';
import { VideoController } from '../lib/VideoController';

import { ContentState } from './state/ContentState';
import type { LockedSubtitleAnchor, TooltipState } from './state/types';
import { DomTextSwapper } from './replacement/DomTextSwapper';

import { reattachLockedContainer, startLockedMonitor, stopLockedMonitor } from './locking/LockMonitor';
import { updateLockedVisualProxy } from './locking/SubtitleLock';
import { LockController } from './locking/LockController';

import { startSelection, type SelectionDeps } from './selection/SelectionController';
import {
  cancelInteractiveHover,
  type InteractiveTranslationDeps,
} from './translation/InteractiveTranslationController';
import {
  handleSubtitleTextChange,
  type SubtitleTranslationDeps,
} from './translation/SubtitleTranslationController';

import { AutoDetectController } from './autodetect/AutoDetectController';
import { runTrackingTick } from './tracking/TrackingTick';

import { startMouseEvents } from './events/MouseEvents';
import { startKeyboardEvents } from './events/KeyboardEvents';
import { startStorageEvents } from './events/StorageEvents';
import { startRuntimeMessages } from './events/RuntimeMessages';
import { startDomObserver } from './events/DomObserver';

import { startVideoMonitor, stopVideoMonitor } from './video/VideoMonitor';
import { VideoOverlayController } from './video/VideoOverlayController';

import { ExtensionRoot } from './ui/ExtensionRoot';
import { ContentRenderer } from './ui/ContentRenderer';
import { SubtitleTrackController } from './subtitles/SubtitleTrackController';
import type { SubtitleTrack } from './subtitles/types';
import { getAllVideos } from '../utils/dom';

export interface ContentAppOptions {
  onTooltipChange?: (tooltip: TooltipState | null, isTranslating: boolean) => void;
}

/**
 * Top-level orchestrator for the content script.
 *
 * Every frame (top and iframe) mounts a full instance. Frames without a real
 * `<video>` will decline selection via `canOwnSelectionFrame()` when the
 * popup broadcasts `START_SELECTION`. This is cheap (one `querySelectorAll`
 * + a few rect reads, once per user action) and avoids the fragility of
 * trying to detect "am I a player frame" at startup — a check that broke
 * on players where the video is inserted before or after the content script
 * runs, in unpredictable order.
 *
 * Collaborators:
 *   LockController          – persistent user lock (lock / unlock)
 *   AutoDetectController    – transient auto-detection loop
 *   runTrackingTick         – shared DOM + media-event pulse
 *   SelectionController     – selection mode state machine
 *   InteractiveTranslation  – hover / click / Control-hover tooltip
 *   SubtitleTranslation     – full-cue translation
 *   VideoMonitor            – media event bindings
 *   ExtensionRoot/Renderer  – Shadow DOM mount + React projection
 *   events/*                – listeners with `dispose()` handles
 */
export class ContentApp {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly isTopFrame: boolean;
  private readonly options?: ContentAppOptions;
  private readonly childApps = new Map<HTMLIFrameElement, ContentApp>();
  private activeChildIframeTooltip: HTMLIFrameElement | null = null;

  private readonly state: ContentState;
  private readonly extensionRoot: ExtensionRoot;
  private readonly renderer: ContentRenderer;

  private readonly subtitleManager: SubtitleManager;
  private readonly translationManager: TranslationManager;
  private readonly videoController: VideoController;
  private readonly domSwapper: DomTextSwapper;
  private readonly overlayController: VideoOverlayController;
  private readonly subtitleTrackController: SubtitleTrackController;

  private readonly autoDetect: AutoDetectController;
  private readonly lockController: LockController;

  private readonly subtitleTranslationDeps: SubtitleTranslationDeps;
  private readonly interactiveDeps: InteractiveTranslationDeps;
  private readonly selectionDeps: SelectionDeps;

  private readonly handles: Array<{ dispose: () => void }> = [];
  private domObserverHandle: { dispose: () => void } | null = null;
  private glowTimer: number | null = null;
  private autoDetectionElected = false;
  private autoLeaseTimer: number | null = null;
  private autoElectionRetryTimer: number | null = null;

  constructor(
    doc: Document = document,
    win: Window = window,
    isTopFrame: boolean = (typeof window !== 'undefined' && win === window.top),
    options?: ContentAppOptions,
  ) {
    this.doc = doc;
    this.win = win;
    this.isTopFrame = isTopFrame;
    this.options = options;

    this.state = new ContentState();
    this.extensionRoot = new ExtensionRoot(this.doc);

    this.subtitleManager = new SubtitleManager();
    this.translationManager = new TranslationManager();
    this.videoController = new VideoController(this.doc);
    this.domSwapper = new DomTextSwapper();
    this.overlayController = new VideoOverlayController(this.videoController);
    this.subtitleTrackController = new SubtitleTrackController(this.state, this.doc);

    this.renderer = new ContentRenderer(this.state, this.extensionRoot, {
      onUnlock: () => { void this.unlockContainer(); },
      delegateTooltip: !this.isTopFrame,
    });

    // Every controller calls `state.notify()` — that must redraw the React
    // tree. Setting the hook here means no controller has to know about
    // ContentRenderer.
    this.state.onRender = () => {
      if (this.options?.onTooltipChange) {
        this.options.onTooltipChange(this.state.tooltipState, this.state.isTranslating);
      }
      if (!this.isTopFrame && typeof window !== 'undefined' && window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({
            type: 'SUBANY_CHILD_TOOLTIP',
            tooltip: this.state.tooltipState,
            isTranslating: this.state.isTranslating,
          }, '*');
        } catch (_) {}
      }
      this.renderer.render();
    };

    this.subtitleTranslationDeps = {
      translationManager: this.translationManager,
      domSwapper: this.domSwapper,
    };

    this.interactiveDeps = {
      translationManager: this.translationManager,
      videoController: this.videoController,
    };

    this.autoDetect = new AutoDetectController({
      state: this.state,
      domSwapper: this.domSwapper,
      subtitleTranslation: this.subtitleTranslationDeps,
    }, this.doc);

    this.lockController = new LockController({
      state: this.state,
      subtitleManager: this.subtitleManager,
      domSwapper: this.domSwapper,
      triggerGlow: (el) => this.triggerGlow(el),
      stopAutoDetection: () => this.autoDetect.stop(),
      startVideoMonitor: () => startVideoMonitor(this.state, { onMediaTick: () => this.tick() }, this.doc),
      stopVideoMonitor: () => stopVideoMonitor(),
      handleSubtitleTextChange: (text) => handleSubtitleTextChange(this.state, this.subtitleTranslationDeps, text),
    });

    this.selectionDeps = {
      lockContainer: async (element) => {
        this.releaseAutoDetectionLease();
        await this.lockController.lock(element, false);
      },
      stopAutoDetection: () => this.autoDetect.stop(),
      resumeAutoDetection: () => {
        const s = this.state;
        if (!s.settings.lockedSelector && !s.autoDetectionDisabled && s.isAutomaticSubtitleMode()) {
          void this.ensureAutoDetectionLease();
        }
      },
      startVideoMonitor: () => startVideoMonitor(this.state, { onMediaTick: () => this.tick() }, this.doc),
      stopVideoMonitor: () => stopVideoMonitor(),
    };
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  async start(): Promise<void> {
    const s = this.state;

    this.extensionRoot.attach();

    this.subtitleManager.setGlowCallback((el: HTMLElement) => this.triggerGlow(el));

    this.overlayController.hideYouTubeOverlays();

    this.handles.push(startMouseEvents(s, {
      selection: this.selectionDeps,
      interactive: this.interactiveDeps,
    }, this.doc, this.win));
    this.handles.push(startKeyboardEvents(s, {
      selection: this.selectionDeps,
      interactive: this.interactiveDeps,
    }, this.doc, this.win));
    this.handles.push(startStorageEvents(s, {
      onSettingsChanged: (next) => this.handleSettingsChanged(next),
      onSubtitleTrackChanged: (track) => this.applySubtitle(track),
    }));
    this.handles.push(startRuntimeMessages(s, {
      onStartSelection: () => {
        this.startSelection();
      },
      onResetSelection: () => {
        this.resetSelection();
      },
      onApplySubtitle: (track) => this.applySubtitle(track),
    }));

    this.win.addEventListener('resize', this.onResize, { passive: true });
    this.win.addEventListener('scroll', this.onResize, { passive: true, capture: true });

    if (this.isTopFrame) {
      const onWindowMessage = (event: MessageEvent) => {
        if (!event.data || event.data.type !== 'SUBANY_CHILD_TOOLTIP') return;
        let sourceIframe: HTMLIFrameElement | null = null;
        try {
          const iframes = Array.from(this.doc.querySelectorAll('iframe'));
          sourceIframe = iframes.find((f) => f.contentWindow === event.source) ?? null;
        } catch (_) {}
        if (!sourceIframe) return;

        const { tooltip, isTranslating } = event.data;
        if (!tooltip) {
          if (this.activeChildIframeTooltip === sourceIframe) {
            this.activeChildIframeTooltip = null;
            this.state.tooltipState = null;
            this.state.isTranslating = false;
            this.state.notify();
          }
          return;
        }

        this.activeChildIframeTooltip = sourceIframe;
        const rect = sourceIframe.getBoundingClientRect();
        this.state.tooltipState = {
          ...tooltip,
          x: rect.left + tooltip.x,
          y: rect.top + tooltip.y,
        };
        this.state.isTranslating = !!isTranslating;
        this.state.notify();
      };

      this.win.addEventListener('message', onWindowMessage);
      this.handles.push({
        dispose: () => this.win.removeEventListener('message', onWindowMessage),
      });
    }

    this.renderer.render();

    await this.loadSettings();

    this.syncDomObserver();
    this.syncSameOriginIframes();
  }

  dispose(): void {
    cancelInteractiveHover();

    if (this.glowTimer !== null) {
      this.win.clearTimeout(this.glowTimer);
      this.glowTimer = null;
    }

    this.win.removeEventListener('resize', this.onResize);
    this.win.removeEventListener('scroll', this.onResize, true);

    for (const child of this.childApps.values()) {
      child.dispose();
    }
    this.childApps.clear();

    for (const handle of this.handles.reverse()) {
      try { handle.dispose(); } catch (_) { /* ignore */ }
    }
    this.handles.length = 0;

    this.domObserverHandle?.dispose();
    this.domObserverHandle = null;
    stopLockedMonitor(this.state);
    this.autoDetect.stop();
    this.releaseAutoDetectionLease();
    stopVideoMonitor();
    this.subtitleTrackController.dispose();

    this.state.onRender = null;
    this.extensionRoot.dispose();
  }

  getDoc(): Document {
    return this.doc;
  }

  getWin(): Window {
    return this.win;
  }

  startSelection(): void {
    this.syncSameOriginIframes();
    if (this.canOwnSelectionFrame()) {
      startSelection(this.state, this.selectionDeps);
    }
    for (const child of this.childApps.values()) {
      child.startSelection();
    }
  }

  resetSelection(): void {
    void this.unlockContainer();
    for (const child of this.childApps.values()) {
      child.resetSelection();
    }
  }

  applySubtitle(track: SubtitleTrack): void {
    this.subtitleTrackController.apply(track);
    for (const child of this.childApps.values()) {
      child.applySubtitle(track);
    }
  }

  private syncSameOriginIframes(): void {
    if (!this.isTopFrame) return;

    let iframes: HTMLIFrameElement[] = [];
    try {
      iframes = Array.from(this.doc.querySelectorAll('iframe'));
    } catch (_) {
      return;
    }

    const currentIframes = new Set(iframes);

    // 1. Clean up removed iframes
    for (const [iframe, childApp] of Array.from(this.childApps.entries())) {
      if (!iframe.isConnected || !currentIframes.has(iframe)) {
        childApp.dispose();
        this.childApps.delete(iframe);
      }
    }

    // 2. Discover same-origin iframes
    for (const iframe of iframes) {
      try {
        const childDoc = iframe.contentDocument;
        const childWin = iframe.contentWindow;
        if (!childDoc || !childWin) continue;

        const attachChild = () => {
          try {
            const doc = iframe.contentDocument;
            const win = iframe.contentWindow;
            if (!doc || !win || !iframe.isConnected) return;
            if (!doc.body && !doc.documentElement) return;
            if (doc.getElementById('subany-extension-root')) return;

            const existing = this.childApps.get(iframe);
            if (existing) {
              if (existing.getDoc() === doc) return;
              existing.dispose();
              this.childApps.delete(iframe);
            }

            const childApp = new ContentApp(doc, win, false, {
              onTooltipChange: (childTooltip, isTranslating) => {
                if (!childTooltip) {
                  if (this.activeChildIframeTooltip === iframe) {
                    this.activeChildIframeTooltip = null;
                    this.state.tooltipState = null;
                    this.state.isTranslating = false;
                    this.state.notify();
                  }
                  return;
                }

                this.activeChildIframeTooltip = iframe;
                const rect = iframe.getBoundingClientRect();
                this.state.tooltipState = {
                  ...childTooltip,
                  x: rect.left + childTooltip.x,
                  y: rect.top + childTooltip.y,
                };
                this.state.isTranslating = isTranslating;
                this.state.notify();
              },
            });
            this.childApps.set(iframe, childApp);
            void childApp.start();
          } catch (_) {}
        };

        const anyIframe = iframe as any;
        if (!anyIframe.__subanySyncBound) {
          anyIframe.__subanySyncBound = true;
          iframe.addEventListener('load', () => {
            this.syncSameOriginIframes();
          });
          iframe.addEventListener('pointerenter', () => {
            this.syncSameOriginIframes();
          }, { passive: true });
        }

        attachChild();
      } catch (_) {
        // Cross-origin iframe (Access denied) - browser extension handles per-frame
      }
    }
  }

  // ---------------------------------------------------------------------
  // Public surface used by events/* callbacks
  // ---------------------------------------------------------------------

  private tick(): void {
    if (this.isTopFrame) this.syncSameOriginIframes();
    runTrackingTick({
      state: this.state,
      domSwapper: this.domSwapper,
      subtitleTranslation: this.subtitleTranslationDeps,
      updateAutoDetection: () => {
        if (this.autoDetectionElected) this.autoDetect.tick();
      },
    });
  }

  private async lockContainer(element: HTMLElement, isAuto = false): Promise<void> {
    return this.lockController.lock(element, isAuto);
  }

  private async unlockContainer(): Promise<void> {
    await this.lockController.unlock();
    void this.ensureAutoDetectionLease();
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  private syncDomObserver(): void {
    this.domObserverHandle?.dispose();
    this.domObserverHandle = startDomObserver(this.state, {
      onDomChange: () => {
        this.syncSameOriginIframes();
        this.tick();
      },
    }, this.doc);
  }

  private async loadSettings(): Promise<void> {
    const s = this.state;

    try {
      const stored = await browser.storage.local.get(['subanySettings', 'subanyLockedAnchor', 'subanySubtitleTrack']);

      if (stored?.subanySettings) {
        s.settings = { ...DEFAULT_SETTINGS, ...(stored.subanySettings as Partial<ExtensionSettings>) };
        s.autoDetectionRequested = s.isAutomaticSubtitleMode();
        if (s.settings.lockedSelector) {
          this.subtitleManager.setLockedSelector(s.settings.lockedSelector);
        }
      }

      const storedAnchor = stored?.subanyLockedAnchor as LockedSubtitleAnchor | null | undefined;
      if (storedAnchor && typeof storedAnchor === 'object') {
        s.lockedSubtitleAnchor = storedAnchor;
        s.lockedVideoSignature = storedAnchor.videoSignature || '';
      }

      const storedTrack = stored?.subanySubtitleTrack as { track?: SubtitleTrack } | undefined;
      if (storedTrack?.track) this.subtitleTrackController.apply(storedTrack.track);
    } catch (_) { /* fall back to defaults */ }

    s.notify();
    this.syncActiveContainer();
    this.syncDomObserver();

    if (s.settings.lockedSelector) {
      if (this.canOwnSelectionFrame()) {
        startVideoMonitor(s, { onMediaTick: () => this.tick() }, this.doc);
        startLockedMonitor(s, (text) => void handleSubtitleTextChange(this.state, this.subtitleTranslationDeps, text));
      }
    } else if (!s.autoDetectionDisabled && s.isAutomaticSubtitleMode()) {
      void this.ensureAutoDetectionLease();
    }
  }

  private handleSettingsChanged(next: Record<string, unknown>): void {
    const s = this.state;
    const oldSettings = s.settings;
    const oldReplace = oldSettings.replaceNativeSubtitles || oldSettings.triggerMode === 'replace-native';

    s.settings = { ...DEFAULT_SETTINGS, ...(next as Partial<ExtensionSettings>) };
    const newReplace = s.settings.replaceNativeSubtitles || s.settings.triggerMode === 'replace-native';

    if (oldReplace && !newReplace) {
      this.domSwapper.restore();
    }

    if (
      oldSettings.triggerMode !== s.settings.triggerMode ||
      oldSettings.replaceNativeSubtitles !== s.settings.replaceNativeSubtitles
    ) {
      s.autoDetectionDisabled = false;
      s.autoDetectionRequested = s.isAutomaticSubtitleMode();
      s.autoTracks.clear();
    }

    if (s.settings.lockedSelector) {
      this.releaseAutoDetectionLease();
      this.autoDetect.stop();
      if (this.canOwnSelectionFrame()) {
        startVideoMonitor(s, { onMediaTick: () => this.tick() }, this.doc);
        startLockedMonitor(s, (text) => void handleSubtitleTextChange(this.state, this.subtitleTranslationDeps, text));
      }
    } else {
      stopLockedMonitor(s);
      if (s.autoDetectionRequested && !s.autoDetectionDisabled && s.isAutomaticSubtitleMode()) void this.ensureAutoDetectionLease();
    }

    if (s.settings.triggerMode !== 'full-auto') s.bilingualSubtitleText = '';

    s.notify();
    this.syncActiveContainer();
    this.syncDomObserver();

    for (const child of this.childApps.values()) {
      child.handleSettingsChanged(next);
    }
  }

  private syncActiveContainer(): void {
    const s = this.state;

    if (s.settings.lockedSelector) {
      this.releaseAutoDetectionLease();
      if (!this.canOwnSelectionFrame()) return;
      const reattached = reattachLockedContainer(s);
      if (reattached) {
        this.autoDetect.stop();
        if (!s.glowTargetEl) this.triggerGlow(reattached);
        return;
      }
      startLockedMonitor(s, (text) => void handleSubtitleTextChange(this.state, this.subtitleTranslationDeps, text));
      return;
    }

    if (!s.autoDetectionRequested || s.autoDetectionDisabled) return;

    if (s.isAutomaticSubtitleMode()) {
      void this.ensureAutoDetectionLease();
    }
  }

  // ---------------------------------------------------------------------
  // Glow
  // ---------------------------------------------------------------------

  private triggerGlow(el: HTMLElement): void {
    const s = this.state;
    if (!s.settings.enableGlowEffect) return;

    s.glowTargetEl = el;
    s.notify();

    if (this.glowTimer !== null) this.win.clearTimeout(this.glowTimer);
    this.glowTimer = this.win.setTimeout(() => {
      if (s.glowTargetEl === el) {
        s.glowTargetEl = null;
        s.notify();
      }
    }, 1600);
  }

  // ---------------------------------------------------------------------
  // Bound handlers
  // ---------------------------------------------------------------------

  private readonly onResize = (): void => {
    const s = this.state;
    if (s.settings.lockedSelector || s.lockedSubtitleAnchor) {
      updateLockedVisualProxy(s);
      s.notify();
    }
  };

  /**
   * A frame is allowed to own the selection UI if it has a genuinely sized
   * `<video>` inside it. On cross-origin iframe players (videasy, braflix,
   * embedded players), only the iframe passes this check — the top frame
   * correctly declines.
   *
   * Runs once per START_SELECTION broadcast, not on any hot path.
   */
  private canOwnSelectionFrame(): boolean {
    const videos = getAllVideos(this.doc);
    return videos.some((video) => {
      if (video.ownerDocument !== this.doc) return false;
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  private async ensureAutoDetectionLease(): Promise<void> {
    const s = this.state;
    if (s.settings.lockedSelector || !s.autoDetectionRequested || s.autoDetectionDisabled || !s.isAutomaticSubtitleMode()) {
      this.autoDetect.stop();
      return;
    }
    if (this.autoDetectionElected) {
      this.autoDetect.start();
      return;
    }

    try {
      const response = await browser.runtime.sendMessage({ action: 'acquire-auto-detection' }) as { granted?: boolean };
      if (!response?.granted) {
        this.autoDetect.stop();
        if (this.autoElectionRetryTimer === null) {
          this.autoElectionRetryTimer = this.win.setTimeout(() => {
            this.autoElectionRetryTimer = null;
            void this.ensureAutoDetectionLease();
          }, 1200);
        }
        return;
      }
      this.autoDetectionElected = true;
      this.autoLeaseTimer = this.win.setInterval(() => {
        void this.renewAutoDetectionLease();
      }, 1000);
      this.autoDetect.start();
    } catch {
      this.autoDetect.stop();
    }
  }

  private async renewAutoDetectionLease(): Promise<void> {
    try {
      const response = await browser.runtime.sendMessage({ action: 'acquire-auto-detection' }) as { granted?: boolean };
      if (!response?.granted) {
        this.autoDetectionElected = false;
        this.autoDetect.stop();
      }
    } catch {
      this.autoDetectionElected = false;
      this.autoDetect.stop();
    }
  }

  private releaseAutoDetectionLease(): void {
    if (this.autoLeaseTimer !== null) {
      this.win.clearInterval(this.autoLeaseTimer);
      this.autoLeaseTimer = null;
    }
    if (this.autoElectionRetryTimer !== null) {
      this.win.clearTimeout(this.autoElectionRetryTimer);
      this.autoElectionRetryTimer = null;
    }
    if (!this.autoDetectionElected) return;
    this.autoDetectionElected = false;
    void browser.runtime.sendMessage({ action: 'release-auto-detection' }).catch(() => {});
  }
}