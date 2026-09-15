# 017 — Locked border used the wrapper rectangle instead of text bounds

**Status:** Fixed
**Severity:** Medium
**Category:** UI
**Platforms:** DOM subtitle players
**Discovered:** The subtitle was correctly locked and tracked, but the dashed border stretched across the full caption wrapper instead of surrounding the visible words.

## Symptom

The dashed border was much wider than the rendered subtitle. The subtitle text occupied only the center portion of the player, while the border followed a broad wrapper from near the left edge to near the right edge.

Cue tracking still worked, which made the issue look like a positioning problem rather than a failed lock.

## Root cause

The locking architecture correctly stores the stable wrapper in `activeContainerEl`, because that wrapper survives cue changes. `ContentRenderer.resolveRectTarget` tried to find a deepest text element, but when a caption wrapper contained multiple text children it fell back to returning the wrapper itself.

`SubtitleOverlay` then positioned the dashed border from `lockedElement.getBoundingClientRect()`. That rectangle described the stable structural container, not the visible text content.

## Fix

The stable wrapper remains the lock and tracking target. The renderer now creates a `Range` over the wrapper's contents, unions its non-empty client rectangles, and passes that rectangle separately as `lockedRect`.

The overlay positions the dashed border exclusively from `lockedRect`; it no longer reads or uses the wrapper rectangle for the border. The wrapper is still used for cue observation, translation text, and lifecycle recovery.

## Why this is general

Subtitle implementations commonly use a stable layout wrapper containing several inline spans, line nodes, or cue fragments. A stable tracking target and a precise visual target are different concerns. Separating them keeps cue tracking reliable while making the UI describe the text the user actually sees.

## Invariant

The persistent lock may target a stable caption wrapper, but the visual border must use the rendered text-content bounds rather than the wrapper bounds.

## Regression test

1. Select a DOM-rendered subtitle whose wrapper contains multiple text children or inline cue fragments.
2. Confirm the dashed border surrounds the visible subtitle text and does not span the full player width.
3. Let several cues pass and confirm the border updates with each rendered subtitle.
4. Hover a word and confirm the word highlight remains aligned with the text.
5. Repeat with a native TextTrack player and confirm the native cue rectangle path remains separate.
6. Confirm the stable wrapper is still used for mutation tracking and recovery.
