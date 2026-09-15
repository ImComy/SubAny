# 006 — Hit-test returned the whole player container

**Status:** Fixed
**Severity:** High (selection impossible)
**Category:** Detection
**Platforms:** Videasy, all players whose wrappers contain hidden text
**Discovered:** Manual selection on videasy returned the whole player div
instead of the caption.

## Symptom

The user clicks a caption on videasy. The extension locks onto
`.videasy-container` — the entire player element, 582×327 — instead of
`.cineby-cue`, which is 384×44.

The dashed box is drawn around the whole video, not the caption.

## Root cause

`getSubtitleElementAtPoint` has two paths:

1. **Path A — hit-stack.** Uses `elementsFromPoint` to find whatever is
   under the cursor. Fast, works when captions have `pointer-events: auto`.

2. **Path B — geometric walk.** Walks the video's grandparent subtree,
   pruning by containment and rejecting anything too large or too high.

Path B has a size cap that rejects elements bigger than 95% of the video.
Path A had no such cap. On videasy, `elementsFromPoint` returned
`.videasy-container` because its `textContent` includes the caption text
plus a bunch of hidden control labels (`Play`, `Bookmark`, `Report`, and
the timecode). Path A saw plausible text, returned the container, and never
ran Path B.

The two paths had different definitions of "plausible candidate."

## Fix

Extract the definition of "plausible candidate" into a single predicate
that both paths must run.

```ts
function isPlausibleSubtitleLeaf(el: HTMLElement, videoRect: DOMRect | null): boolean {
  if (isExtensionElement(el)) return false;
  if (SKIP_TAGS.has(el.tagName.toLowerCase())) return false;
  if (containsInteractiveControls(el)) return false;

  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;

  if (videoRect) {
    // Reject player wrappers.
    if (r.width > videoRect.width * 0.95 && r.height > videoRect.height * 0.15) return false;
    // Reject thin-wide chrome.
    if (r.width / r.height > 20) return false;
    // Reject the top chrome band.
    const centerY = r.top + r.height / 2;
    if (centerY < videoRect.top + videoRect.height * 0.15) return false;
  }

  const text = (el.textContent ?? '').trim();
  if (text.length < 2 || text.length > 400) return false;
  return isSubtitleText(text);
}
```

## Why this is general

This was not a Videasy-only quirk. Any site whose player wrapper contains hidden text or control labels can fool a hit-test that accepts the container without checking the candidate size or shape. The fix is general because it defines one candidate predicate and uses it in both the hit-stack and geometric paths.

## Invariant

A subtitle candidate must be text-bearing, visually small relative to the video, and not a player wrapper or control chrome before it is accepted as the lock target.

## Regression test

1. Open a player whose wrapper includes hidden subtitle text or UI labels.
2. Click the visible caption text.
3. Confirm the extension locks onto the caption element, not the whole player container.
4. Trigger a cue change and confirm tracking still follows the correct subtitle element.
5. Repeat on a normal subtitle player to confirm the default path still works unchanged.