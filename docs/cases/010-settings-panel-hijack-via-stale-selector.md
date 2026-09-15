# 010 — Stale selector matched a settings panel

**Status:** Fixed
**Severity:** High
**Category:** Detection
**Platforms:** Videasy
**Discovered:** A stale locked selector pointed to the settings panel instead of the subtitle container

## Symptom

After a player rebuild or interface swap, the extension keeps drawing the selection box around a settings panel or another non-caption UI element. The correct subtitle container is still present, but the extension is locked to the wrong target.

## Root cause

The lock stored an element selector that remained valid in the rendered DOM until the player replaced the relevant subtree. When the selector was later re-used, it matched a nearby settings panel because the underlying DOM structure had shifted and the selector no longer uniquely identified the caption container.

## Fix

The lock validation path now checks whether the selected node still matches the expected geometry before it is treated as authoritative. If the stale selector resolves to a non-subtitle target, the system clears the lock and re-establishes the correct one instead of silently reusing the wrong container.

```ts
if (!isPlausibleSubtitleContainer(el)) {
  clearLock();
  return;
}
```

This protects the lock from stale DOM identities and ensures the selection target remains a text-bearing subtitle container.

## Why this is general

The bug arises from persisting a selector across a DOM refresh, which can happen on any site with ephemeral UI panels or re-rendered player chrome. The validation step is generic: a stale selector is not accepted without re-checking the candidate against the subtitle rules.

## Invariant

A stored selector is only valid if the resolved node still satisfies the subtitle geometry and content predicates.

## Regression test

1. Open a player that swaps UI panels during playback or after a settings action.
2. Lock onto a subtitle.
3. Trigger the UI rebuild or settings view.
4. Confirm the extension does not keep drawing on the settings panel.
5. Ensure the lock rebinds to the real subtitle container after the player settles.
