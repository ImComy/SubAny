# 003 — Lock died every cue because it targeted the leaf

**Status:** Fixed
**Severity:** Critical (lock unusable)
**Category:** Architecture
**Platforms:** YouTube, all players
**Discovered:** After the lock was implemented, captions stopped tracking as
soon as the first cue changed.

## Symptom

The user clicks a caption. It locks. It glows. The first cue is translated.
Then the second cue appears, and the lock is gone. No dashed box. No
translation. The extension behaves as if nothing was ever locked.

The bug only manifested on YouTube and videasy, not on simple players.

## Root cause

The lock stored a CSS selector to **the leaf** — the innermost element that
contained the current caption text (`.cineby-cue` on videasy,
`.ytp-caption-segment` on YouTube).

Every cue change replaces the leaf. YouTube destroys `ytp-caption-segment`
and creates a new one. Videasy does the same for `.cineby-cue`. So:

1. User locks the leaf.
2. Cue changes.
3. The leaf is removed from the DOM.
4. `document.querySelector(selector)` returns `null`.
5. The lock is treated as dead and dropped.

The recovery logic then tried to find a replacement leaf by scanning the
page, which is fix 001's problem all over again.

## Fix

The lock now stores a selector to **the container**, not the leaf.

The container is the highest ancestor of the clicked element that still
looks like a caption:

- Contains no buttons, sliders, or inputs.
- Is not wider than 90% of the video AND taller than 15% of it.
- Is not wider than 98% of the video.
- Is not taller than 35% of the video (capped at 300px).

On YouTube, the container is `.caption-window`. On videasy, it's the
`w-[90%] bottom-40` wrapper. Both survive cue changes.

The observer watches the container's `textContent`. When the text changes,
the observer fires and dispatches a translation. When the container is
momentarily empty (between cues), the observer fires but the empty text is
ignored — the lock stays alive and waits.

## Why this is general

The container-versus-leaf distinction is the core insight the whole engine
is built on. Every browser-based subtitle player mounts its container once
and only replaces the leaf. If a player destroyed the container on every
cue, the user would see the caption box flicker visibly on every sentence.
Nobody ships that.

This means: **if a DOM-based subtitle player exists at all, the container
exists and is stable.** That's the universal invariant.

## Invariant

**Lock the container, not the leaf. The container survives cue changes;
the leaf does not.**

## Regression test

1. Lock a subtitle on YouTube.
2. Let the video play through at least 5 cue changes.
3. The dashed box should remain on the caption throughout, and each new
   cue should be translated.
4. Do the same on videasy. Same result.