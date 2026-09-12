// content/ContentApp.ts

import { DEFAULT_SETTINGS, type ExtensionSettings } from '../lib/types';
import { SubtitleManager } from '../lib/SubtitleManager.ts';
import { TranslationManager } from '../lib/TranslationManager';
import { VideoController } from '../lib/VideoController';

import { ContentState } from './state/ContentState';
import type { LockedSubtitleAnchor } from './state/types';
import { DomTextSwapper } from './replacement/DomTextSwapper';

import { reattachLockedContainer, startLockedMonitor, stopLockedMonitor, maintainLockedContainer } from './locking/LockMonitor';
import { updateLockedVisualProxy } from './locking/SubtitleLock';
import { LockController } from './locking/LockController';

import { startSelection, type SelectionDeps } from './selection/SelectionController';
import {
  cancelInteractiveHover,
  type InteractiveTranslationDeps,
} from './translation/InteractiveTranslationController';
import type { SubtitleTranslationDeps } from './translation/SubtitleTranslationController';

import { AutoDetectController } from './autodetect/AutoDetectController';
import { runTrackingTick } from './tracking/TrackingTick';

import { startDomObserver } from './events/DomObserver';
import { startMouseEvents } from './events/MouseEvents';
import { startKeyboardEvents } from './events/KeyboardEvents';
import { startStorageEvents } from './events/StorageEvents';
import { startRuntimeMessages } from './events/RuntimeMessages';

import { startVideoMonitor, stopVideoMonitor } from './video/VideoMonitor';
import { VideoOverlayController } from './video/VideoOverlayController';

import { ExtensionRoot } from './ui/ExtensionRoot';
import { ContentRenderer } from './ui/ContentRenderer';

/**
 * Top-level orchestrator for the content script.
 *
 * Owns the lifecycle and the wiring. Every concrete behaviour lives in one
 * of the collaborators below:
 *
 *   LockController          – persistent user lock (lock / unlock)
 *   AutoDetectController    – transient auto-detection loop
 *   runTrackingTick         – shared DOM + media-event pulse
 *   SelectionController     – selection mode state machine
 *   InteractiveTranslation  – hover / click / Control-hover tooltip
 *   SubtitleTranslation     – full-cue translation
 *   VideoMonitor            – media event bindings
 *   ExtensionRoot/Renderer  – Shadow DOM mount + React projection
 *   events/*                – listeners with `dispose()` handles
 *
 * What remains here is genuinely cross-cutting: reacting to settings
 * changes, deciding which tracking mode should be active, and the initial
 * startup / teardown sequence.
 */
export class ContentApp {
  private readonly state: ContentState;
  private readonly extensionRoot: ExtensionRoot;
  private readonly renderer: ContentRenderer;

  private readonly subtitleManager: SubtitleManager;
  private readonly translationManager: TranslationManager;
  private readonly videoController: VideoController;
  private readonly domSwapper: DomTextSwapper;
  private readonly overlayController: VideoOverlayController;

  private readonly autoDetect: AutoDetectController;
  private readonly lockController: LockController;

  private readonly subtitleTranslationDeps: SubtitleTranslationDeps;
  private readonly interactiveDeps: InteractiveTranslationDeps;
  private readonly selectionDeps: SelectionDeps;

  private readonly handles: Array<{ dispose: () => void }> = [];
  private glowTimer: number | null = null;
  private autoDetectionElected = false;
  private autoLeaseTimer: number | null = null;
  private autoElectionRetryTimer: number | null = null;

  constructor() {
    this.state = new ContentState();
    this.extensionRoot = new ExtensionRoot();

    this.subtitleManager = new SubtitleManager();
    this.translationManager = new TranslationManager();
    this.videoController = new VideoController();
    this.domSwapper = new DomTextSwapper();
    this.overlayController = new VideoOverlayController(this.videoController);

    this.renderer = new ContentRenderer(this.state, this.extensionRoot, {
      onUnlock: () => { void this.unlockContainer(); },
    });

    // Every controller calls `state.notify()` — that must redraw the React
    // tree. Setting the hook here means no controller has to know about
    // ContentRenderer.
    this.state.onRender = () => this.renderer.render();

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
    });

    this.lockController = new LockController({
      state: this.state,
      subtitleManager: this.subtitleManager,
      domSwapper: this.domSwapper,
      triggerGlow: (el) => this.triggerGlow(el),
      stopAutoDetection: () => this.autoDetect.stop(),
      startVideoMonitor: () => startVideoMonitor(this.state, { onMediaTick: () => this.tick() }),
      stopVideoMonitor: () => stopVideoMonitor(),
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

    this.handles.push(startDomObserver(s, {
      onDomChange: () => this.tick(),
    }));
    this.handles.push(startMouseEvents(s, {
      selection: this.selectionDeps,
      interactive: this.interactiveDeps,
    }));
    this.handles.push(startKeyboardEvents(s, {
      selection: this.selectionDeps,
      interactive: this.interactiveDeps,
    }));
    this.handles.push(startStorageEvents(s, {
      onSettingsChanged: (next) => this.handleSettingsChanged(next),
    }));
    this.handles.push(startRuntimeMessages(s, {
      onStartSelection: () => {
        if (this.canOwnSelectionFrame()) startSelection(s, this.selectionDeps);
      },
      onResetSelection: () => { void this.unlockContainer(); },
    }));

    window.addEventListener('resize', this.onResize, { passive: true });

    this.renderer.render();

    await this.loadSettings();
  }

  dispose(): void {
    cancelInteractiveHover();

    if (this.glowTimer !== null) {
      window.clearTimeout(this.glowTimer);
      this.glowTimer = null;
    }

    window.removeEventListener('resize', this.onResize);

    for (const handle of this.handles.reverse()) {
      try { handle.dispose(); } catch (_) { /* ignore */ }
    }
    this.handles.length = 0;

    stopLockedMonitor(this.state);
    this.autoDetect.stop();
    this.releaseAutoDetectionLease();
    stopVideoMonitor();

    this.state.onRender = null;
    this.extensionRoot.dispose();
  }

  // ---------------------------------------------------------------------
  // Public surface used by events/* callbacks
  // ---------------------------------------------------------------------

  /** Shared DOM + media-event pulse. */
  private tick(): void {
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

  private async loadSettings(): Promise<void> {
    const s = this.state;

    try {
      // Load both keys at once. The original asked only for `subanySettings`
      // and then read `subanyLockedAnchor` off the result — which was never
      // present, so the anchor was silently never restored. Fixed here.
      const stored = await browser.storage.local.get(['subanySettings', 'subanyLockedAnchor']);

      if (stored?.subanySettings) {
        s.settings = { ...DEFAULT_SETTINGS, ...(stored.subanySettings as Partial<ExtensionSettings>) };
        if (s.settings.lockedSelector) {
          this.subtitleManager.setLockedSelector(s.settings.lockedSelector);
        }
      }

      const storedAnchor = stored?.subanyLockedAnchor as LockedSubtitleAnchor | null | undefined;
      if (storedAnchor && typeof storedAnchor === 'object') {
        s.lockedSubtitleAnchor = storedAnchor;
        s.lockedVideoSignature = storedAnchor.videoSignature || '';
      }
    } catch (_) { /* fall back to defaults */ }

    s.notify();
    this.syncActiveContainer();

    if (s.settings.lockedSelector) {
      startLockedMonitor(s);
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

    // Changing modes is an explicit configuration action, so allow auto
    // detection to start again. A user pressing the overlay's unlock button
    // does NOT change the mode and therefore remains detached.
    if (
      oldSettings.triggerMode !== s.settings.triggerMode ||
      oldSettings.replaceNativeSubtitles !== s.settings.replaceNativeSubtitles
    ) {
      s.autoDetectionDisabled = false;
      s.autoTracks.clear();
    }

    if (s.settings.lockedSelector) {
      this.releaseAutoDetectionLease();
      this.autoDetect.stop();
      startLockedMonitor(s);
    } else {
      stopLockedMonitor(s);
      if (!s.autoDetectionDisabled && s.isAutomaticSubtitleMode()) void this.ensureAutoDetectionLease();
    }

    if (s.settings.triggerMode !== 'full-auto') s.bilingualSubtitleText = '';

    s.notify();
    this.syncActiveContainer();
  }

  /**
   * Bring the active-tracking mode in line with current settings.
   *
   * Deliberately kept on ContentApp: it spans locking, auto-detection, and
   * glow, so no single collaborator can own it without reaching into the
   * others.
   */
  private syncActiveContainer(): void {
    const s = this.state;

    if (s.settings.lockedSelector) {
      this.releaseAutoDetectionLease();
      const reattached = reattachLockedContainer(s);
      if (reattached) {
        this.autoDetect.stop();
        if (!s.glowTargetEl) this.triggerGlow(reattached);
        return;
      }
      // The selector can be temporarily stale while a player is rebuilding.
      // Keep the logical lock alive and let the locked monitor recover it.
      startLockedMonitor(s);
      return;
    }

    if (s.autoDetectionDisabled) return;

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

    if (this.glowTimer !== null) window.clearTimeout(this.glowTimer);
    this.glowTimer = window.setTimeout(() => {
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
      maintainLockedContainer(s, true);
    }
  };

  private canOwnSelectionFrame(): boolean {
    if (this.autoDetectionElected) return true;
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    return videos.some((video) => {
      const rect = video.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  private async ensureAutoDetectionLease(): Promise<void> {
    const s = this.state;
    if (s.settings.lockedSelector || s.autoDetectionDisabled || !s.isAutomaticSubtitleMode()) {
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
          this.autoElectionRetryTimer = window.setTimeout(() => {
            this.autoElectionRetryTimer = null;
            void this.ensureAutoDetectionLease();
          }, 1200);
        }
        return;
      }
      this.autoDetectionElected = true;
      this.autoLeaseTimer = window.setInterval(() => {
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
      window.clearInterval(this.autoLeaseTimer);
      this.autoLeaseTimer = null;
    }
    if (this.autoElectionRetryTimer !== null) {
      window.clearTimeout(this.autoElectionRetryTimer);
      this.autoElectionRetryTimer = null;
    }
    if (!this.autoDetectionElected) return;
    this.autoDetectionElected = false;
    void browser.runtime.sendMessage({ action: 'release-auto-detection' }).catch(() => {});
  }
}