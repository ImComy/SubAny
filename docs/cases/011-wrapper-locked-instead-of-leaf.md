# 011 — Dashed box was drawn around the wrapper, not the text

**Status:** Fixed
**Severity:** Medium
**Category:** UI
**Platforms:** Videasy
**Discovered:** The selection overlay surrounded the caption wrapper instead of the actual subtitle text element

## Symptom

The dashed highlight is drawn around a parent wrapper element rather than the caption text itself. The selection area is larger, misaligned, and visually wrong even though the caption is readable.

## Root cause

The lock logic sometimes captured the nearest stable container, not the actual leaf text node that the user clicked. That meant the selection overlay followed the wrapper, which could be broader than the true caption and could also contain unrelated text or spacing. The UI box therefore described the container, not the text.

## Fix

The lock resolution was refined to prefer the leaf-most plausible subtitle element when the wrapper is only a structural container. The selection overlay now tracks the actual text-bearing node, while the container remains the stable anchor for cue updates.

```ts
const target = resolveStableContainer(leaf, videoRect);
return pickLeafOrStableContainer(target);
```

This preserves the architecture of a stable container for persistence while forcing the visual box to follow the actual subtitle text.

## Why this is general

Wrappers are common in subtitle rendering systems. They are useful for a stable lock, but they are not necessarily the right visual reference for the dashed box. The rule generalizes to any site where caption text is nested under non-text container elements.

## Invariant

The visual selection target must be the displayed subtitle text, not the outer structural wrapper that happens to own it.

## Regression test

1. Select a subtitle on a player with nested caption wrappers.
2. Confirm the dashed box aligns with the actual text bounds.
3. Run a cue change and confirm the box remains anchored to the same caption text.
4. Repeat on a normal site to confirm the stable-container logic remains intact.
