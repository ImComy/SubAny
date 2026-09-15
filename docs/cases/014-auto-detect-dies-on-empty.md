# 014 — Auto-detect stopped permanently after first silence

**Status:** Fixed
**Severity:** Medium
**Category:** Lifecycle
**Platforms:** All
**Discovered:** Auto-detect never resumed after the first subtitle-free segment

## Symptom

The user enables auto-detect, the extension finds a subtitle track once, and then it silently stops working when the next cue is empty or silent. Subsequent captions are never discovered again until the page reloads.

## Root cause

The auto-detect lifecycle treated a skipped or empty pass as a terminal state. Once the detector saw no subtitle text in one tick, it marked the track as dead and stopped scheduling future scans. That prevented later, valid captions from being found even when the stream recovered.

## Fix

The auto-detect tick was changed to treat empty results as a temporary condition, not as a fatal error. It keeps scanning on the regular cadence and resets its state when the next cue resumes, rather than permanently disabling detection.

```ts
if (!candidate) {
  continue;
}
```

This ensures a brief silence cannot permanently poison the detection loop.

## Why this is general

Any subtitle stream can include silent gaps, empty cue periods, or brief scene changes with no caption text. The detector must stay alive through those intervals. The fix generalizes because it treats silence as a valid transient state rather than as a sign of total failure.

## Invariant

An empty scan result is not a permanent failure; the auto-detect loop must continue until a valid subtitle is found or the player is truly gone.

## Regression test

1. Open a video with an initial subtitle cue followed by a silent segment.
2. Enable auto-detect.
3. Wait for the silence to pass and for captions to resume.
4. Confirm the extension re-discovers the subtitle track without a reload.
5. Repeat with different video lengths and silence intervals to confirm stability.
