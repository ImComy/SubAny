# 013 — Clicks a few pixels outside the caption didn't register

**Status:** Fixed
**Severity:** Medium (selection occasionally does nothing)
**Category:** Detection
**Platforms:** All
**Discovered:** On a JWPlayer page, a click 9px above the caption returned
`leaf: undefined` even though the user was clearly aiming at the subtitle.

## Symptom

Two consecutive clicks, logged by the extension:

```
[SubAny] click 273 224 leaf: undefined leafRect: null             ← miss
[SubAny] click 373 249 leaf: jw-text-track-cue rect: y=246 h=21   ← hit
```

The caption occupied `y = 246–267` and `x = 142–525`. The first click was
at `y = 224`, which is 22px above the caption's top edge. The second click
was inside. The user experienced this as "sometimes clicking on the
subtitle does nothing."

## Root cause

The geometric walk's containment check was strict:

```ts
if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
  continue;
}
```

An element was only considered as a candidate if the click point fell
strictly inside its bounding box. Real users don't click to the pixel.
They click near the visual centre of the caption text, and the caption's
bounding box is often a few pixels tighter or looser than what the user
perceives as "the caption."

A 4–10px offset from the caption's true rect is normal human aiming error.
The strict check treated every such offset as a miss.

## Fix

Add a small amount of padding to the containment check:

```ts
const PAD = 6;
if (
  clientX < r.left - PAD ||
  clientX > r.right + PAD ||
  clientY < r.top - PAD ||
  clientY > r.bottom + PAD
) {
  continue;
}
```

The padding is applied to every element visited by the walk. Candidates
that already fail the other predicates (too big, no text, contains
controls) still fail them regardless of padding. Only the containment
check is loosened.

6px is large enough to absorb normal aiming error and small enough that
it can't accidentally reach player chrome. On a typical player, the gap
between a caption and the nearest control button is 40px or more. A
6px halo around the caption is nowhere near the controls.

## Why this is general

Any click-driven geometric hit-test has this problem. The user's mental
model is "click the caption," not "click a pixel inside the caption's
bounding rectangle." A few pixels of slop is the difference between
"works every time" and "works most of the time."

The right amount of padding is small enough to exclude genuine misses
and large enough to tolerate the user's aim. 6px is a reasonable default
across most input devices and screen densities.

## Invariant

**Containment checks include a few pixels of padding. Strict pixel-exact
containment is never the right choice for user clicks.**

## Regression test

1. On any site, click within 6px of the caption's visible edge, on each
   of the four sides. It should lock every time.
2. Click 20px or more away from the caption on each side. Nothing should
   happen.
3. Click on a player control button that's within 20px of the caption
   (rare, but possible in compact layouts). The control should still be
   recognised as a control, not as the caption — the interactive-controls
   predicate handles this regardless of padding.
