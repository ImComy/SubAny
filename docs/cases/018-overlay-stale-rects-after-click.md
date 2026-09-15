# 018 — Overlay kept a stale rect after click

**Status:** Fixed
**Severity:** High (selection box appears in the wrong place and can fill a large area)
**Category:** UI
**Platforms:** All DOM subtitle players
**Discovered:** During subtitle selection, the dashed lock box disappeared or a solid blue box appeared offset from the actual subtitle after the click, even though the click had landed on the caption text.

## Symptom

The user clicked on the subtitle text to lock it, but the visible blue overlay was drawn around the wrong element or stayed on a stale rectangle. In some cases the box appeared only after click, not at the moment the subtitle was selected. The overlay could cover a larger area than the subtitle itself, and the console showed that the click had resolved to a live text leaf but the actual overlay render still used stale geometry.

## Root cause

The issue was in `components/SubtitleOverlay.tsx`.

The overlay used an effect that scheduled a continuous `requestAnimationFrame` loop:

```tsx
const update = () => {
  ...
  const rect = target.getBoundingClientRect();
  ...
  animId = requestAnimationFrame(update);
};
update();
return () => cancelAnimationFrame(animId);
```

That loop re-read `getBoundingClientRect()` on every frame and kept mutating overlay styles even when the lock target had changed or the player had already reflowed controls. The target list could still include a stale `selectionCandidate` or an older bound from the click lifecycle, so the box remained in the wrong place after the user had already selected the live subtitle.

The effect also ran as a hot-path animation loop rather than as a state-driven update, which is exactly the kind of behavior that violates the extension's performance contract.

## Fix

The overlay no longer keeps a per-frame RAF loop. Instead, it recomputes positions once from the current DOM rects whenever the relevant inputs change:

```tsx
useLayoutEffect(() => {
  const targets = [
    [glowTarget, glowRef.current, 6],
    [lockedElement && bilingualText ? lockedElement : null, bilingualRef.current, 0],
    [selectionCandidate && isSelecting ? selectionCandidate : null, candidateRef.current, 0],
  ] as const;

  for (const [target, overlay, padding] of targets) {
    if (!overlay) continue;
    if (!target) {
      overlay.style.display = 'none';
      continue;
    }

    const rect = target.getBoundingClientRect();
    overlay.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
    overlay.style.left = `${rect.left - padding}px`;
    overlay.style.top = `${rect.top - padding}px`;
    overlay.style.width = `${rect.width + padding * 2}px`;
    overlay.style.height = `${rect.height + padding * 2}px`;
  }

  if (lockedRef.current && lockedRect) {
    lockedRef.current.style.left = `${lockedRect.left - 4}px`;
    lockedRef.current.style.top = `${lockedRect.top - 4}px`;
    lockedRef.current.style.width = `${lockedRect.width + 8}px`;
    lockedRef.current.style.height = `${lockedRect.height + 8}px`;
  }
}, [glowTarget, lockedElement, lockedRect, selectionCandidate, isSelecting, bilingualText, isGlowActive]);
```

This keeps the box synchronized with the live subtitle bounds while avoiding the per-frame geometry churn that caused stale placement.

## Why this is general

Any UI overlay that repeatedly calls `getBoundingClientRect()` inside a frame loop can drift away from the actual live DOM target whenever the page reflows or swaps caption nodes. The bug is not specific to one player; it is a general problem of stale-target rendering on any page that mutates subtitle DOM on cue changes.

## Invariant

**Never re-read DOM geometry in an animation loop while positioning a subtitle overlay.**

## Regression test

1. Open a subtitle-enabled page.
2. Click a subtitle caption to lock it.
3. Confirm the dashed lock box appears immediately and stays aligned with the subtitle text, not the surrounding player chrome.
4. Trigger a player cue change or a control-state change (seek, toggle controls, or advance the video) and confirm the box stays attached to the live subtitle rather than reusing a stale rectangle.
5. Inspect the browser Performance panel: the overlay should not emit a continuous rAF/layout loop while idle.
