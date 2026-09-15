# 005 — Caption wrapper is created per cue, not reused

**Status:** Fixed
**Severity:** High (lock unusable on some players)
**Category:** Detection
**Platforms:** Videasy
**Discovered:** The lock worked for a cue or two, then the container was
removed entirely during silence and never came back.

## Symptom

On videasy, the lock is stored but tracking stops after a silence gap. The
dashed box disappears and never returns for the next cue. In the DOM, the
caption wrapper (`div.absolute.w-[90%].bottom-40`) is not present during
silence; a fresh wrapper is created for each new cue.

This contradicted fix 003's assumption: "the container is stable across
cues."

## Root cause

Videasy is a Next.js app. Its React tree unmounts the caption wrapper
between cues and mounts a new one for the next cue. The container has
the same *class names* but is a different DOM node.

The observer, attached to the old wrapper, is now observing a detached
node. It never fires again. The stored selector (`div.absolute:nth-child(2)`)
still resolves — but to a different element in the same position, often
a settings panel or the controls, which is why the box was sometimes drawn
on chrome.

## Fix

The observer is now attached to the **video's grandparent subtree**, not
to the specific container.

When the caption wrapper is removed, the observer fires on the childList
mutation. A single, bounded, rate-limited recovery scan runs:

- Filtered to the player subtree (`video.parentElement.parentElement`).
- Bounded to 400 elements visited.
- Text-first: reads `textContent` before any geometry.
- Rate-limited to once per 150ms (coalesces rebuild bursts).

If the scan finds a plausible caption, it's used and the observer is
re-attached to it. If nothing is found (silence), `activeContainerEl` is
cleared and the box hides. The next cue creates a new wrapper; the observer
fires; the scan finds it.

## Why this is general

Some players (especially React-based ones) do not honor the "container is
stable" invariant at the DOM-node level, only at the conceptual level. The
*class of element* is stable, but the specific node is not.

Observing the player subtree instead of the container is more expensive per
mutation, but the mutations are rare — only on cue transitions and player
rebuilds. The rate-limit keeps a rebuild burst from stacking up.

## Invariant

**Observe the video's grandparent subtree, not the caption container.**
The container is conceptually stable but not always a stable DOM node.

## Regression test

1. Lock a caption on videasy. Let the video play through a silence gap.
2. When the next cue appears, the box should reappear on the new caption.
3. Repeat through at least 5 cues.
4. Same test on YouTube should still work.