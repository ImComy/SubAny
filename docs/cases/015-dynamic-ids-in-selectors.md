# 015 — Selectors generated from counter IDs broke on rebuild

**Status:** Fixed
**Severity:** Medium (lock breaks on player rebuild)
**Category:** Persistence
**Platforms:** YouTube and any player whose caption elements have counter
IDs
**Discovered:** After a player rebuild, the stored selector no longer
resolved, or resolved to a different element.

## Symptom

The stored selector was `#caption-window-1`. After the player rebuilt its
caption overlay — which YouTube does on certain transitions — the selector
no longer matched anything. A fresh lookup found `#caption-window-2`
instead.

In the worst case, the selector still resolved, but to a stale element,
and the lock silently attached to the wrong node.

## Root cause

`generateUniqueSelector` preferred `element.id` if it was unique on the
page:

```ts
if (element.id && !element.id.includes(':')) {
  return `#${CSS.escape(element.id)}`;
}
```

YouTube's caption window uses an incrementing ID: `caption-window-1`,
`caption-window-2`, `caption-window-3`, etc. The selector was technically
unique at the moment it was generated, but the identity it pointed to was
not stable across the player's lifecycle.

A similar problem exists for class names. React-based players commonly
generate class names containing a counter or hash — `caption-window-1f2a`,
`cue-4e5b` — that change on every render.

## Fix

`generateUniqueSelector` now rejects IDs and class names that contain
digits:

```ts
// IDs with digits are usually counters. Never use them.
if (element.id && !/\d/.test(element.id) && !element.id.includes(':')) {
  return `#${CSS.escape(element.id)}`;
}

// Later, when picking a class:
const primaryClass =
  Array.from(current.classList).find((name) =>
    !/^(hover|active|selected|focus)$/.test(name) &&
    !name.startsWith('subany-') &&
    !/\d/.test(name)             // ← rejects generated class names
  ) ?? null;
```

When no stable ID or class is available, the function falls back to a
positional path (`tag.class:nth-child(N)`) and, if that fails too, to
`tag` alone. The positional path is brittle, but it is used only as a
last resort — and the recovery logic in `maintainLockedContainer` will
re-find the caption geometrically if the selector goes stale.

## Why this is general

Digits in IDs and class names almost always indicate generated values:
session hashes, render pass numbers, React keys, incrementing counters.
They are exactly the values that change between renders and between
page loads. They are never stable identifiers.

Any selector that depends on a digit-containing ID or class is a
selector that will break on the next rebuild. The rule "never use a
digit-containing identifier in a persisted selector" is universal.

## Invariant

**Never generate a selector from an ID or class name containing digits.**

## Regression test

1. Lock a caption on YouTube. Check the stored selector — it should not
   contain `caption-window-1` or any other digit-containing name.
2. Seek the video (which forces a player rebuild). The lock should survive.
3. Reload the page. The stored selector should still resolve.
4. Lock a caption on a React-based player (videasy, or a custom test page).
   Same test — the selector should not depend on any generated class.
