# 016 — Native cue selection box was broad, static, and not word-interactive

**Status:** Fixed
**Severity:** High
**Category:** UI
**Platforms:** Native TextTrack players
**Discovered:** A native-caption player showed a dashed box much wider than the visible subtitle. The box stayed in one place as cues changed, and hovering words produced no word highlight or translation.

## Symptom

The console reported `leaf: undefined` when the user clicked a visible caption. The click was valid, but the subtitle had no DOM leaf because it was rendered by the browser's native `TextTrack` renderer.

The selection indicator was a large video-relative rectangle instead of a box around the text. It did not refresh when the active cue changed. Native captions also had no DOM text node for `TextExtractor` to inspect, so word hover and click translation did nothing.

## Root cause

The native fallback used a fixed proxy rectangle derived from a large percentage of the video. It stored one `NativeSubtitleHit` at selection time, but manual native selection stopped auto-detection and never started the media monitor. Consequently, later cues could not update the selected geometry or text.

The interactive controller only called DOM extraction when `activeContainerEl` existed. Native selection intentionally has no active DOM container, so the existing universal extraction fallback was never reached for native hover.

## Fix

Native cue rectangles are now sized from the cue text using canvas text metrics instead of a fixed 86%-wide proxy. Manual native selection starts the existing video media monitor, and each media tick checks only the selected video's active text tracks using the previous cue rectangle as the geometry reference.

Native word extraction uses the selected cue's text and canvas metrics to calculate the word under the pointer. It does not require a subtitle DOM node and does not read host layout during mousemove handling.

The native selection box and interactive word highlight remain separate visual states:

- Native cue selection: dashed outline around the current cue.
- Word or phrase translation: filled highlight around the measured word or phrase.

## Why this is general

Browser-native captions are rendered outside the page DOM, so DOM caret and range APIs cannot provide their text or word rectangles. The video and active `TextTrack` are the stable source of truth. Reusing the existing media-event monitor keeps manual native selection synchronized without adding another polling loop.

## Invariant

Native subtitle selection must be driven by the selected video's active text track and must not depend on a DOM leaf, a fixed full-video proxy, or DOM caret extraction.

## Regression test

1. Open a player that renders captions through `video.textTracks` without a subtitle DOM element.
2. Enter selection mode and click a visible caption.
3. Confirm `leaf: undefined` may be logged, but the dashed box closely surrounds the visible caption text.
4. Let several different cues pass and confirm the box moves and resizes with each cue.
5. Hover a word inside the selected caption and confirm the filled word highlight follows that word.
6. Use hover or click translation and confirm the selected native word is translated.
7. Click outside the cue or press Escape and confirm the native selection state clears.
8. Repeat with a DOM-rendered subtitle player and confirm stable-container locking still follows cue changes.
9. Record a performance trace while captions change. Confirm the manual native media tick does not scan the document or call host-element geometry APIs in a loop.
