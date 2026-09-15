# 004 — Container's textContent became a timecode between cues

**Status:** Fixed
**Severity:** Medium (visual glitch, wrong element locked)
**Category:** Detection
**Platforms:** Videasy
**Discovered:** After fix 003, the lock survived cue changes but jumped to
the wrong position when a cue went silent.

## Symptom

The lock worked for the first few cues. Then, during a pause in the
dialogue, the dashed box jumped from the caption to the video controls.
Hovering over the controls translated them. The extension appeared to be
locked onto the timecode / control bar.

## Root cause

Videasy uses the same DOM node for two purposes:

- While a caption is showing, the wrapper contains the caption text.
- While there is no caption, the wrapper is repurposed and its text becomes
  the timecode: `"38:05 / 01:07:17"`.

The observer fires on both transitions. Without a guard, the observer
treated the timecode as a new cue and dispatched it to the translation
pipeline. The renderer then drew the dashed box around whatever element
had `"38:05 / 01:07:17"` as its text — which happened to be the controls
region.

## Fix

Two guards, both applying `isSubtitleText`:

1. **In the observer callback** (LockMonitor): if the container's new text
   fails `isSubtitleText`, treat it as "no cue." Clear bilingual output,
   hide the box, keep the lock alive.

2. **In the renderer** (`ContentRenderer.resolveRectTarget`): when resolving
   the element to draw around, require the leaf's text to pass
   `isSubtitleText`. If it doesn't, return null and hide the box.

`isSubtitleText` already rejects pure timecodes (`38:05`,
`38:05 / 01:07:17`), percentages, and player control labels
(`Settings`, `Quality`, `Play`, `Pause`, etc.).

## Why this is general

Any player that reuses its caption node for non-caption content will hit
this. The check uses the *shape* of the text, not player-specific
knowledge, so it works everywhere. A timecode always looks like a timecode.

## Invariant

**Every path that reads subtitle text must guard with `isSubtitleText`.**
If text doesn't look like a subtitle, it isn't one.

## Regression test

1. Lock a caption on videasy. Let the video go silent.
2. The dashed box should disappear — not jump to the controls.
3. When the next cue appears, the box should reappear on the caption.
4. Hovering over the timecode region while the caption is showing should
   translate nothing.