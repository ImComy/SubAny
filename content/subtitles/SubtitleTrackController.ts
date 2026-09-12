import type { SubtitleCue, SubtitleTrack } from './types';
import type { ContentState } from '../state/ContentState';

export class SubtitleTrackController {
  private readonly state: ContentState;
  private track: SubtitleTrack | null = null;
  private timer: number | null = null;
  private videos: HTMLVideoElement[] = [];
  private readonly onTimeUpdate = () => this.update();

  constructor(state: ContentState) {
    this.state = state;
  }

  apply(track: SubtitleTrack): void {
    this.track = track;
    this.refreshVideos();
    if (this.timer === null) this.timer = window.setInterval(() => this.update(), 100);
    this.update();
  }

  clear(): void {
    this.track = null;
    this.state.externalSubtitleText = '';
    this.state.externalSubtitleVideo = null;
    this.state.notify();
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.videos.forEach((video) => video.removeEventListener('timeupdate', this.onTimeUpdate));
    this.videos = [];
    this.clear();
  }

  private update(): void {
    if (!this.track) return;
    if (!this.state.settings.subtitleEnabled) {
      if (this.state.externalSubtitleText) {
        this.state.externalSubtitleText = '';
        this.state.notify();
      }
      return;
    }
    this.refreshVideos();
    const video = this.videos.find((candidate) => !candidate.paused && candidate.readyState >= 2) || this.videos[0];
    if (!video) return;
    const adjustedTime = video.currentTime - this.state.settings.subtitleDelayMs / 1000;
    const cue = findCue(this.track.cues, adjustedTime);
    const nextText = cue?.text || '';
    if (nextText === this.state.externalSubtitleText && video === this.state.externalSubtitleVideo) return;
    this.state.externalSubtitleText = nextText;
    this.state.externalSubtitleVideo = video;
    this.state.notify();
  }

  private refreshVideos(): void {
    const currentVideos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    for (const video of this.videos) {
      if (!currentVideos.includes(video)) video.removeEventListener('timeupdate', this.onTimeUpdate);
    }
    for (const video of currentVideos) {
      if (!this.videos.includes(video)) video.addEventListener('timeupdate', this.onTimeUpdate, { passive: true });
    }
    this.videos = currentVideos;
  }
}

function findCue(cues: SubtitleCue[], time: number): SubtitleCue | undefined {
  return cues.find((cue) => time >= cue.start && time < cue.end);
}
