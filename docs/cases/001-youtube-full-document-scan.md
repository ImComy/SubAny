# 001 — YouTube froze for seconds on every cue change

**Status:** Fixed
**Severity:** Critical (page freeze)
**Category:** Performance
**Platforms:** YouTube and any page with >20k DOM nodes
**Discovered:** Early, after adding auto-detection and locking.

## Symptom

On YouTube, the page froze for 3–6 seconds every time the subtitle changed.
The video kept playing (GPU decode is on the compositor, not the main thread),
but the pause button, seek bar, right-click menu, and every other UI element
stopped responding. DevTools Performance showed SubAny attributed roughly 5
seconds of main-thread time over a 55-second recording, with `[unattributed]`
at 92%.

The video was always fine. Everything *around* it was frozen.

## Root cause

Two functions walked the entire document on every tick:

- `combineSubtitleLines` — called from LockMonitor's 140ms interval.
- `findLockedReplacement` — called from the recovery path.

Both called `getAllElements(document)` and then, for every element in the
returned list, called `el.getBoundingClientRect()`. On YouTube that's 30,000
to 80,000 elements per call. Every `getBoundingClientRect()` flushes the
browser's pending layout if the DOM has changed since the last flush. On
YouTube, the DOM changes constantly, so every one of those calls triggered
a full-page re-layout.

50,000 elements × ~7 ticks per second ≈ 350,000 forced reflows per second.
The main thread never got a break.

The profiler couldn't attribute the layout time to a specific function
because Chrome reports internal layout work as `[unattributed]`. That's why
SubAny looked small (~5s) while the page was clearly frozen (~350s of work).

## Fix

1. **`combineSubtitleLines` now scans siblings only.** Subtitles that belong
   to the same cue are always visually adjacent and structurally close.
   The function looks at the anchor's siblings, the parent's siblings, and
   the grandparent's siblings — at most ~20 elements, not 50,000.

2. **`findLockedReplacement` was deleted entirely.** Recovery now only does
   `document.querySelector(selector)`. If the selector doesn't resolve, the
   lock is dropped and the user re-clicks. The absence of recovery is a
   feature: it makes the failure mode "user re-clicks" instead of "page
   freezes for six seconds."

## Why this is general

Any function that walks `document` and reads geometry in a loop is a
landmine. It works fine on a blog with 200 elements. It freezes YouTube.
The correct scope is always "the smallest subtree that contains what I need."

"Bounded" scans are not a loophole. Scoping `findLockedReplacement` to the
player subtree was tried first — it still took 3–6 seconds on YouTube,
because the player subtree is 500–2000 elements and every geometry read
inside it forces a full-page layout.

## Invariant

**Never call `getBoundingClientRect` in a loop over an unbounded set.**
If you need geometry for N elements, N must be small (< ~100) or the loop
must be pruned by containment first.

## Regression test

1. Open YouTube on any video with captions. Start playback.
2. Open DevTools → Performance. Record for 60 seconds.
3. Confirm:
   - No `[SubAny]` timing log exceeds 20ms.
   - `[unattributed]` is below 30% of the recording.
   - No long task exceeds 50ms.
   - The pause button responds instantly while captions are changing.