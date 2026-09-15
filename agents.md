# AGENTS.md — SubAny Performance Contract

This file is a hard constraint on any change made to this codebase. Read it
before touching anything in `content/`, `utils/`, or `lib/`. If a change
would violate any invariant here, **stop and tell the user before
implementing it.**

Also read [`docs/ENGINE.md`](./docs/ENGINE.md) for the mental model behind
the code, and [`docs/cases/`](./docs/cases/) for the record of every bug
we've already solved. Do not re-solve solved problems.

---

## The One Rule

**The extension must never force the browser to recompute layout on a hot
path.**

"Hot path" means anything that runs more than once per cue change:

- `mousemove` / `pointermove` handlers
- `MutationObserver` callbacks
- `setInterval` / `setTimeout` callbacks
- `requestAnimationFrame` loops
- `video` media event handlers (`timeupdate`, `seeked`, `playing`, …)
- Anything called from the tracking tick
- Anything called from the auto-detect tick

Everything in this list runs dozens to hundreds of times per second on a
large page (YouTube: 30,000–80,000 DOM nodes). If any of them causes a
forced synchronous layout, the page freezes. Not "feels slow" — freezes
for seconds at a time.

---

## What Causes Forced Layout (Forbidden)

Any of the following, when called on an element that is part of the *host
page's* DOM (not our own shadow-root overlay):

| API | Why it forces layout |
|---|---|
| `el.getBoundingClientRect()` | Reads geometry, flushes pending style/layout |
| `el.innerText` | Requires rendering to compute visible text |
| `window.getComputedStyle(el)` | Flushes style recalculation |
| `el.offsetWidth` / `offsetHeight` / `offsetTop` / `offsetLeft` | Geometry read |
| `el.scrollWidth` / `scrollHeight` / `scrollTop` | Geometry read |
| `document.elementsFromPoint()` | Hit-test, forces layout on dirty trees |

Calling any of these **once** is fine. Calling any of them in a loop over
many elements, or calling any of them repeatedly on a hot path, is a
performance bug that will freeze the page.

### Safe alternatives

| Instead of | Use |
|---|---|
| `el.innerText` | `el.textContent` (V8 string, zero reflow) |
| `getComputedStyle(el).pointerEvents` | `el.matches('[style*="pointer-events:none"]')` only if truly needed; prefer not checking |
| `elementsFromPoint` on every move | `elementsFromPoint` on click only |
| Repeated `getBoundingClientRect()` in a loop | Read once, cache in a variable, reuse |

---

## The Two Hot Paths and Their Rules

### 1. Tracking hot path (cue change → translation)

**Trigger:** `MutationObserver` on the caption container (or on the video's
grandparent subtree, for players where the container itself is rebuilt).

**Allowed work per cue change:**
- Read `container.textContent`
- Compare to previous text
- Call `handleSubtitleTextChange` if the text changed and passes
  `isSubtitleText`

**Forbidden:**
- Any geometry read
- Any DOM walk outside the video's player subtree
- Any call to `combineSubtitleLines`, `collectAutoSubtitleCandidates`,
  `getAllElements`, or `scoreSubtitleCandidate` from a non-tick path

**Rationale:** The container persists across cues on most players. On the
ones where it doesn't, the recovery path is a single bounded scan.

### 2. Auto-detect tick

**Trigger:** `setInterval` at ~280ms, running only when the mode is set to
`full-auto` or `replace-native`.

**Allowed work per tick:**
- Walk the video's player subtree using `textContent` as a free pre-filter
- Call `getBoundingClientRect` only on elements whose `textContent` already
  looks like a subtitle (2–400 chars, passes `isSubtitleText`)
- Cap the walk at 300 elements visited per video

**Forbidden:**
- Any class-name-based `querySelectorAll` that scans the whole document
- Walking `document.body` or `document.documentElement`
- Calling `getBoundingClientRect` on every element unconditionally
- Running when the mode is not `full-auto` / `replace-native`

---

## Absolute Invariants

These have all been violated at some point in this project's history. Each
violation was a multi-day debugging session. Do not repeat them.

1. **Never call `getAllElements(document)`.** Ever. It walks 30k–80k nodes
   and is the single worst offender in the codebase's history.

2. **Never call `getBoundingClientRect` in a loop over an unbounded set.**
   If you need geometry for N elements, N must be small (< ~100) or the
   loop must be pruned by containment first.

3. **Never use `innerText`.** Use `textContent`. `innerText` forces layout;
   `textContent` does not.

4. **Never attach a `MutationObserver` to `document.body`.** Attach it to
   the specific container or the video's grandparent subtree. On YouTube,
   `document.body` mutates constantly.

5. **Never run a `requestAnimationFrame` loop in a React component.**
   Position overlays from event-driven triggers (prop change,
   `ResizeObserver`, `MutationObserver`, `scroll`, `resize`), never from a
   per-frame timer.

6. **Never use `setInterval` faster than 250ms on a hot path.** The only
   interval in this codebase is the auto-detect tick at ~280ms, and it only
   runs when auto mode is active.

7. **Never scan for a replacement container beyond the video's player
   subtree.** The only allowed scan is inside
   `video.parentElement.parentElement`, bounded to ~400 elements, and
   rate-limited to once per 150ms.

8. **Never attach hit-testing to `mousemove` without throttling.** Selection
   is click-only. Hover highlighting is throttled to ~16 Hz.

9. **Never store `innerText` snapshots.** Use `textContent` in anchors,
   text hints, and comparisons.

10. **Never generate selectors from IDs or class names containing digits.**
    These are counters that change on every player rebuild. Use stable
    classes or attribute selectors instead.

11. **Never mount the extension host to `document.body`.** Mount to
    `document.documentElement`. Pages routinely apply `body > *` selectors
    (`display: none`, `opacity: 0`, `transform`, `filter`) that would
    otherwise hide the extension. `<html > div` is not matched by
    `body > *` and is immune to scripts that clear
    `document.body.innerHTML`.

12. **Never lock the leaf; lock the container.** The leaf dies every cue.
    See `docs/cases/003`.

13. **Never trust a candidate without running the shared predicate.**
    Every path that finds a candidate must apply `isPlausibleSubtitleLeaf`.
    Two paths with different validation will eventually disagree, and the
    one that's wrong will return player chrome. See `docs/cases/006`.

14. **Never treat an empty container as a broken lock.** Silence between
    cues is normal. See `docs/cases/005` and `014`.

15. **Never terminate a polling loop on a single empty result.** Silence is
    a state, not a failure.

16. **Band checks use `centerY`, not `top`, and the floor is 15%.**
    Captions sit wherever the player puts them. See `docs/cases/007`.

---

## Documentation Workflow

When you fix a bug, add a case file. When you encounter an edge case that
isn't yet documented, add a case file. When you make an architectural
change that invalidates a case file, update it.

### Where docs live

- `docs/ENGINE.md` — the mental model. Read before changing architecture.
- `docs/cases/` — one file per bug or edge case.
- `docs/cases/README.md` — the index. Add a row when you add a file.

### How to write a case file

Every case file has this structure. Do not skip sections:

1. **Symptom** — what the user sees. Observable behaviour, not diagnosis.
2. **Root cause** — the actual mechanism. Function names, line numbers if
   useful.
3. **Fix** — the exact change. Include a code snippet if it clarifies.
4. **Why this is general** — the reason the fix applies beyond the one site
   it was found on. If it's a one-off, say so.
5. **Invariant** — one sentence. A rule that, if kept, would have prevented
   the bug.
6. **Regression test** — how to confirm the fix works, precisely enough
   that a stranger can reproduce it.

### When to add a case file

- Any bug that took more than 30 minutes to diagnose.
- Any bug whose root cause was non-obvious.
- Any edge case that shows a gap in the geometric detection model.
- Any performance regression.
- Any change to the "Absolute Invariants" list above.

### When NOT to add a case file

- Trivial typos, missing imports, etc.
- One-off player quirks that don't generalise — but note those in
  `docs/ENGINE.md` under a "Known limitations" section.

### Numbering

Files are numbered sequentially: `NNN-title-in-kebab-case.md`. Take the
next available number. Do not renumber existing files even if they become
obsolete. Deleting a case file would hide the fact that the problem
existed at all.

### Adding a new invariant

If a case's fix generalises, add the invariant to the "Absolute Invariants"
list above. Not every case produces a new invariant — sometimes the fix is
specific. But when it does, the invariant is more valuable than the fix,
because it prevents the whole class of bug.

---

## If the User Asks You to Do Something That Would Violate This

Examples of prompts that are **performance regressions in disguise**:

- "Add recovery when the container is missing" → **No.** If the container is
  missing, drop the lock. Do not scan.
- "Show a preview highlight while hovering over subtitles" → **No** if it
  means running unthrottled hit-testing on `mousemove`.
- "Score all candidates on the page to pick the best" → **No.** Scope
  scoring to the video's player subtree.
- "Detect subtitles automatically" → **OK**, but only via the auto-detect
  tick. Never on a pointer event.
- "Improve accuracy by matching class names" → **OK as a preference, not a
  requirement.** The final decision must remain geometric.

If a prompt asks for one of the above:

1. **Do not implement it as asked.** Reply with what the prompt would break
   and why.
2. Offer the version of the change that respects the invariant.
3. If the user insists, warn them explicitly: *"This will freeze large
   pages. Confirm you want to proceed."*

---

## Before You Commit Any Change

Answer these:

- [ ] Does any code I added call `getBoundingClientRect`, `innerText`, or
      `getComputedStyle` in a loop?
- [ ] Does any code I added run on a `mousemove`, `MutationObserver`,
      `setInterval`, or `requestAnimationFrame` hot path?
- [ ] Does any code I added walk `document.body`,
      `document.documentElement`, or the full player subtree
      unconditionally?
- [ ] Does any code I added try to recover the lock by scanning outside the
      video's player subtree?
- [ ] Does any code I added use class names as the primary signal, rather
      than as a preference on top of geometry?
- [ ] Does any new candidate-discovery path use the shared
      `isPlausibleSubtitleLeaf` predicate?
- [ ] If I fixed a bug that took more than 30 minutes to diagnose, did I
      add a case file?

If the answer to any of the first five is yes, revert and try again.

---

## Testing Protocol

Before claiming a performance fix works:

1. Open YouTube on a video with captions.
2. Open DevTools → Performance. Start recording.
3. Play the video for 30 seconds. Let at least 5 cues pass.
4. Stop recording.
5. Look at the flame graph for the caption-change moments:
   - No bar should be wider than 50ms.
   - No `[unattributed]` bucket should exceed 30% of total time.
   - `Recalculate Style` and `Layout` should be < 5% combined.
6. Grep the console for `[SubAny]` timing logs, if present. Every entry
   should be under 20ms. If any single entry exceeds 100ms, that's the bug.

"I tested it and it feels faster" is not evidence. The Performance panel
either shows the fix or it doesn't.

---

## Notes on Universality

The extension is universal because it uses **geometry**, not class names,
to find the caption container. Any site that renders subtitles into the DOM
produces a container with the same structural properties:

- It contains the caption text as a descendant.
- It stays mounted across cue changes (or is rebuilt and can be re-found).
- It's positioned in the video's lower portion.
- It's small relative to the video (never more than ~30% of video height).
- It does not contain buttons, sliders, or the `<video>` element itself.

The geometry walk in `resolveStableContainer` and
`getSubtitleElementAtPoint` relies on exactly these properties. If a site
breaks one of them, that site is not DOM-renderable and no DOM approach
will work.

The only hardcoded class-name pattern is the `caption-window` preference in
`resolveStableContainer`. It's a preference, not a requirement: if it
doesn't match, the geometric fallback runs and produces the same result.

Sites that render subtitles into `<canvas>` with no DOM element cannot be
handled by this extension. That's a known limitation, not a bug.

### Class names in the codebase

Class names are allowed in exactly three roles:

1. Browser standard enums (`TextTrack.kind === 'subtitles'`). Not
   site-specific.
2. Preferences once a candidate has been found geometrically. If they don't
   match, the geometric path runs anyway and produces the same result.
3. Selector generation for the lock, where a stable class is preferred over
   a positional path.

Class names are FORBIDDEN as a discovery mechanism.
`querySelectorAll('[class*="caption"]')` must never be the way you find a
subtitle. If you're adding a new discovery path, it must be geometric.

---

## When in Doubt

If you're about to write code that touches the DOM in a way you're not sure
about, ask the user:

> "This change will call X on Y elements per Z event. That's N calls per
> second on a large page. Is that within the performance budget?"

The user can answer. Don't guess.