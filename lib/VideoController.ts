export class VideoController {
  private resumeTimer: number | null = null;
  private wasPlayingBeforeHover = false;

  /**
   * Find the most relevant <video> element on the page
   */
  getActiveVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    if (videos.length === 0) return null;

    // Prefer currently playing video
    const playing = videos.find((v) => !v.paused && !v.ended && v.readyState > 2);
    if (playing) return playing;

    // Otherwise largest video in viewport
    let best: HTMLVideoElement | null = videos[0] ?? null;
    let maxArea = -1;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea) {
        maxArea = area;
        best = v;
      }
    }
    return best;
  }

  /**
   * Pauses video playback when hovering over a subtitle word
   */
  pause(): void {
    const video = this.getActiveVideo();
    if (!video) return;

    if (!video.paused) {
      this.wasPlayingBeforeHover = true;
      try {
        video.pause();
      } catch {
        // Best-effort
      }
    }

    if (this.resumeTimer) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  /**
   * Resumes video playback after pointer leaves subtitle
   */
  resume(delay = 250): void {
    if (!this.wasPlayingBeforeHover) return;

    const video = this.getActiveVideo();
    if (!video) return;

    if (this.resumeTimer) {
      window.clearTimeout(this.resumeTimer);
    }

    this.resumeTimer = window.setTimeout(() => {
      try {
        if (this.wasPlayingBeforeHover && video.paused) {
          void video.play().catch(() => {});
        }
      } catch {
        // Ignore autoplay policy restrictions
      } finally {
        this.wasPlayingBeforeHover = false;
      }
    }, delay);
  }

  /**
   * Hides YouTube pause overlay cards that obstruct the subtitle view
   */
  hidePlatformOverlays(): void {
    const styleId = 'subany-platform-overlay-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .ytp-pause-overlay { display: none !important; }
        .ytp-cards-teaser { display: none !important; }
      `;
      document.head.appendChild(style);
    }
  }
}
