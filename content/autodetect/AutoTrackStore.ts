// autodetect/AutoTrackStore.ts

import { isPlaybackTimeText, normalizeSubtitleText } from '../../utils/text';
import type { AutoTrackState } from '../state/types';
import type { AutoCandidate } from './AutoDetectScorer';

/**
 * Pure operations on the auto-detection tracker map.
 *
 * All three functions mutate/read the Map they are given. Keeping them
 * separate from `AutoDetectController` means they can be unit tested without
 * a DOM, a monitor, or a ContentState.
 */

export function upsertTrack(
  tracks: Map<string, AutoTrackState>,
  candidate: AutoCandidate,
  now: number,
): void {
  const existing = tracks.get(candidate.key);

  if (!existing) {
    tracks.set(candidate.key, {
      key: candidate.key,
      video: candidate.video,
      element: candidate.element,
      lastText: candidate.text,
      seen: 1,
      textChanges: 0,
      staticScore: candidate.score,
      lastSeenAt: now,
      lastElementAt: now,
    });
    return;
  }

  if (existing.lastText && candidate.text !== existing.lastText) {
    existing.textChanges += 1;
  }
  existing.lastText = candidate.text;
  existing.seen += 1;
  // Exponential moving average — a track's identity score should not be
  // rewritten by a single unusual frame.
  existing.staticScore = existing.staticScore * 0.65 + candidate.score * 0.35;
  existing.element = candidate.element;
  existing.video = candidate.video;
  existing.lastSeenAt = now;
  existing.lastElementAt = now;
}

export function pruneStaleTracks(
  tracks: Map<string, AutoTrackState>,
  now: number,
  maxAgeMs: number,
): void {
  for (const [key, track] of tracks) {
    if (now - track.lastSeenAt > maxAgeMs) tracks.delete(key);
  }
}

/**
 * Rank tracks that qualify as "stable subtitle regions".
 *
 * A track qualifies when it has been seen multiple times, has a strong
 * static score, and has either demonstrated text changes (live subtitles)
 * or is otherwise so confident that one observation suffices.
 */
export function rankEligibleTracks(
  tracks: Map<string, AutoTrackState>,
): Array<{ track: AutoTrackState; total: number }> {
  return Array.from(tracks.values())
    .map((track) => {
      const dynamicBonus = Math.min(42, track.textChanges * 14);
      const persistenceBonus = Math.min(24, Math.max(0, track.seen - 1) * 6);
      const total = track.staticScore + dynamicBonus + persistenceBonus;
      const currentText = normalizeSubtitleText(track.lastText);
      const qualifies =
        !isPlaybackTimeText(currentText) &&
        track.seen >= 3 &&
        track.staticScore >= 58 &&
        (track.textChanges >= 1 || track.staticScore >= 92);
      return { track, total, qualifies };
    })
    .filter((item) => item.qualifies)
    .sort((a, b) => b.total - a.total);
}

/**
 * Sticky selection: prefer the currently-active track unless another track
 * beats it by a meaningful margin. This prevents the extension from
 * flickering between two regions that score within a few points of each
 * other.
 */
export function pickStickyTrack(
  ranked: Array<{ track: AutoTrackState; total: number }>,
  currentKey: string | null,
  margin = 28,
): AutoTrackState | null {
  const best = ranked[0]?.track ?? null;
  if (!currentKey) return best;

  const current = ranked.find((item) => item.track.key === currentKey);
  if (!current) return best;

  const bestTotal = ranked[0]?.total ?? -Infinity;
  if (current.total + margin >= bestTotal) return current.track;
  return best;
}