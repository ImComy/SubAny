# 002 — Overlay's rAF loop forced layout 60×/sec

**Status:** Fixed
**Severity:** High (page-wide layout storm)
**Category:** Performance
**Platforms:** All
**Discovered:** After fix 001, the page still felt sluggish on YouTube while
the extension was locked onto a caption.

## Symptom

Even after 001 removed the document-wide scans, the page was still
noticeably janky on YouTube whenever a subtitle was locked. DevTools
Performance showed continuous `Layout` and `Recalculate Style` bars running
at roughly 60 Hz, correlated with SubAny's overlay.

## Root cause

`SubtitleOverlay.tsx` had a `requestAnimationFrame` loop that ran on every
frame, forever, and did the following per frame:

1. `glowTarget.getBoundingClientRect()`
2. `lockedElement.getBoundingClientRect()`
3. `selectionCandidate.getBoundingClientRect()`
4. Up to three `setState` calls with fresh `DOMRect` objects.

Because `lockedElement` was often a YouTube DOM node, each
`getBoundingClientRect()` forced a synchronous layout flush of the entire
YouTube page. 60 flushes per second = continuous layout. Worse, the state
updates caused React to re-render the overlay every frame, and the fresh
`DOMRect` objects were allocated and GC'd continuously — that churn showed
up as `[unattributed]`.

The video looked fine because decode runs on the GPU. But every other
UI element on the page had to queue behind the constant layout work.

## Fix

The rAF loop was removed entirely. Positioning is now event-driven:

- A `useLayoutEffect` with a deps array re-positions on prop change.
- `window.addEventListener('scroll', …)` and `resize` re-position when the
  page moves.
- A `ResizeObserver` on each element target re-positions when the target's
  size changes.
- A `MutationObserver` on the target's parent re-positions when the
  player swaps a class or style.

The overlay no longer calls `setState` from any of these handlers. It writes
to `ref.current.style` directly. React re-renders only when a prop actually
changes, and never because of a frame timer.

## Why this is general

The pattern "read geometry into React state on every frame" is common in
overlay libraries and it's always wrong on large pages. React's reconciler
was not designed for 60 Hz input, and `getBoundingClientRect` is not free
on a page with a video element and an animated progress bar.

The correct pattern is: read geometry once per event that actually changes
the target's position, write to the DOM directly, and only reach for React
when the set of targets changes.

## Invariant

**Never run a `requestAnimationFrame` loop inside a React component.**
Position overlays from event-driven triggers (prop change, `ResizeObserver`,
`MutationObserver`, `scroll`, `resize`), never from a per-frame timer.

## Regression test

1. Open YouTube on a video with captions. Lock a subtitle.
2. Open DevTools → Performance. Record for 30 seconds while the video plays.
3. Confirm:
   - The `Layout` and `Recalculate Style` buckets are close to zero.
   - The overlay tracks the caption without visual lag.
   - Scrolling the page moves the overlay smoothly.
