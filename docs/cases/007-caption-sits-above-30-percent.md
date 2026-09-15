# 007 — Caption sits above the 30% band and was rejected

**Status:** Fixed
**Severity:** High (selection impossible)
**Category:** Detection
**Platforms:** Videasy
**Discovered:** The geometric walk rejected videasy's caption entirely,
even though the caption was clearly visible and manual inspection confirmed
the walk "should" have found it.

## Symptom

`getSubtitleElementAtPoint` returned `null` for every click on videasy's
caption. The caption was rendered and readable. A manual reproduction of
the walk — running the same code in the browser console — also returned
`undefined`.

## Root cause

The walk contained a band check:

```ts
if (r.top < vr.top + vr.height * 0.30) continue;
```

This says: "if the element's **top edge** is above 30% of the video, skip
it."

Videasy anchors its caption at `bottom-40` — 160px from the bottom of the
video. On a 327px-tall video, the caption's top edge is at `y = 82`. The
threshold is `327 × 0.30 = 98`. So `82 < 98` — the caption was rejected
before it could be scored.

The check had been written with YouTube in mind. YouTube's captions sit at
roughly 85% of the video height, so their top edge is nowhere near the 30%
line. Videasy anchors captions much higher — roughly 25% of the video — so
their top edge is well above 30%.

## Fix

Two changes to the band check:

1. Use the element's **center** Y coordinate, not its top edge.
2. Lower the floor from 30% to 15%.

```ts
const centerY = r.top + r.height / 2;
if (centerY < vr.top + vr.height * 0.15) continue;
```

For videasy's caption: `centerY = 82 + 43 = 125`, and the threshold is
`15% of 327 = 49`. `125 >= 49` — passes.

For YouTube's caption: `centerY ≈ 85% of video` — passes trivially.

For a video title bar at the top of the player: `centerY ≈ 5–10%` —
still rejected. The check keeps its original purpose (excluding top
chrome) while accepting any legitimate caption position.

## Why this is general

A band check based on the element's **top edge** excludes any element whose
top happens to fall above the threshold, even if most of the element is
inside the acceptable band. A caption anchored at the top of its own box
loses by a few pixels even though it sits well within the video's lower
portion.

The **center** of an element is a much better proxy for "where is this
visually located." A caption at any normal position — top-anchored,
mid-video, bottom-anchored, RTL, in a short 4:3 video, in a tall 9:16
vertical video — has its center within the video's lower 85%. Only actual
top chrome has its center in the top 15%.

## Invariant

**Band checks use the element's `centerY`, not its `top`. The floor is 15%,
not 30%.**

## Regression test

1. Lock a caption on videasy. It should register.
2. Lock a caption on YouTube. It should still register.
3. A video title at the top of the player should not be selectable.
4. A caption that appears mid-video (during a title card, for example)
   should still be selectable.

