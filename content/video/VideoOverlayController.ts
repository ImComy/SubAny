// video/VideoOverlayController.ts

import type { VideoController } from '../../lib/VideoController';

/**
 * Facade for anything the content script needs to do to the *player's* own
 * video chrome (as opposed to our overlay, which lives in a Shadow root).
 *
 * Today this only covers one thing: hiding platform-specific overlays that
 * visually conflict with our translated subtitle overlay (big centre-play
 * buttons that never hide, watermark ribbons, native "CC" toggles, etc.).
 *
 * Kept as a small class instead of a free function so future per-video state
 * (e.g. "which platform am I on, and is its overlay currently hidden?") has
 * an obvious home without leaking into ContentState.
 */
export class VideoOverlayController {
  private readonly videoController: VideoController;
  private hidden = false;

  constructor(videoController: VideoController) {
    this.videoController = videoController;
  }

  /**
   * Hide the platform's native overlays. Idempotent — safe to call on
   * startup and again after a settings change that re-enables our overlay.
   *
   * Mirrors the original single call to
   * `videoController.hidePlatformOverlays()` at the end of `main()`.
   */
  hidePlatformOverlays(): void {
    if (this.hidden) return;
    this.videoController.hidePlatformOverlays();
    this.hidden = true;
  }

  /**
   * Whether the platform overlays have been hidden at least once. Exposed so
   * ContentApp / diagnostics can reason about initialisation order without
   * reaching into VideoController directly.
   */
  arePlatformOverlaysHidden(): boolean {
    return this.hidden;
  }
}