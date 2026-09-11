export function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPlaybackTimeText(text: string): boolean {
  const value = normalizeSubtitleText(text);
  if (!value) return false;

  const time = '(?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:\\.\\d{1,3})?';
  return new RegExp(`^${time}$`).test(value) ||
    new RegExp(`^${time}\\s*(?:/|\\|)\\s*${time}$`).test(value) ||
    new RegExp(`^${time}\\s*(?:-|→)\\s*${time}$`).test(value);
}

export function isSubtitleText(text: string): boolean {
  const value = normalizeSubtitleText(text);
  if (value.length < 2) return false;
  if (isPlaybackTimeText(value)) return false;
  if (/^\d+(\.\d+)?%?$/.test(value)) return false;
  if (/^(Settings|Quality|Speed|Audio|Subtitles|CC|Off|On|Play|Pause|Mute|Volume|Fullscreen|Next|Previous|Bookmark|Report)$/i.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

export function cueToPlainText(cue: TextTrackCue): string {
  const raw =
    typeof (cue as VTTCue).text === 'string'
      ? (cue as VTTCue).text
      : '';
  if (!raw) return '';

  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return (doc.body.textContent || raw)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}