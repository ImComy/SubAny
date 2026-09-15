# The Engine

How SubAny finds, tracks, and translates subtitles — the mental model behind
the code. Read this before touching `content/`.

## The one invariant everything rests on

Every browser-based subtitle player mounts a **stable container** once for
the whole video, and only replaces the **leaf** (the innermost text node)
as cues change.

If a player destroyed and recreated the container on every cue, the caption
box would visibly flicker — background, padding, border, position — on every
sentence. No production player does this. YouTube doesn't. Netflix doesn't.
Vimeo doesn't. JWPlayer doesn't. Videasy doesn't. Custom players don't.

This is a universal property of subtitle rendering, and it's the entire
reason the engine exists.

## What the engine does, in one paragraph

The user clicks a subtitle once. The click lands on some DOM node — usually
the leaf, sometimes the container's padding. We walk *up* from there to find
the highest ancestor that still looks like a caption: small relative to the
video, no interactive controls inside, sitting in the video's lower portion.
That ancestor is the *container*. It is the thing that survives cue changes.
We attach a `MutationObserver` to it, and from then on every cue change is
just a mutation callback that reads `container.textContent` and hands it to
the translation pipeline. That's the whole engine.

## Why we never scan

`getBoundingClientRect()`, `innerText`, `getComputedStyle()`, and friends
force the browser to flush pending layout. On a page with 30,000 to 80,000
DOM nodes (YouTube), a single layout flush takes hundreds of milliseconds.

If any of that happens on a hot path — a mousemove handler, a mutation
callback, a timer — the page freezes for seconds. Not "feels slow" — freezes.
The main thread is saturated and every UI element on the page (pause button,
seek bar, right-click menu) stops responding.

The design constraint is therefore:

> **No geometry read on any path that fires more than once per cue.**

That constrains everything else. It's why we lock the container instead of
the leaf. It's why we don't do per-frame positioning. It's why the recovery
path is a single `querySelector`, not a bounded scan.

## The four things that can go wrong

Every bug we've hit fits into one of four buckets. If you're debugging a
new player, ask which bucket you're in.

### 1. The click lands on the wrong element

The user clicks near the caption. The hit-test returns a player wrapper, a
control bar, a settings panel, or a text label next to the video. Detection
fails silently — the extension appears to do nothing.

**Fix in practice:** strict geometric predicates. A valid caption candidate
must:
- Contain the click point (with a few pixels of padding).
- Contain no buttons, sliders, or inputs.
- Be smaller than 95% of video width OR shorter than 15% of video height.
- Be wider than 20:1 aspect ratio? No.
- Have plausible subtitle text (`isSubtitleText`).

The same predicate is used by every path — hit-stack, geometric walk, and
recovery — so they cannot disagree.

*See cases 006, 007, 010, 013.*

### 2. The container is destroyed between cues

Some players (`videasy`) remove the caption wrapper entirely during silence
and create a new one for the next cue. The observer attached to the old
container is now orphaned.

**Fix in practice:** the observer is attached to the video's grandparent
subtree, not to a specific container. When the container is removed, the
observer fires on the childList mutation; a bounded, rate-limited recovery
scan finds the new container. If nothing is found, the lock is dropped and
the user re-clicks.

*See case 005.*

### 3. The container is reused for something else

Some players swap the caption text for the timecode between cues. The
observer sees `textContent === "38:05 / 01:07:17"` and — without a guard —
translates it. The dashed box jumps to the controls.

**Fix in practice:** every text path applies `isSubtitleText`. That rejects
timecodes, pure percentages, and player control labels. It's site-agnostic
because it uses the *shape* of the text, not player-specific knowledge.

*See cases 004, 014.*

### 4. The host page hides or moves our overlay

The extension host is a `<div>` appended to the page. Some players apply
`body > * { display: none !important }` to strip everything except their own
root. Our host was a direct child of `<body>`, so it got hidden — the lock
was fine, the box just wasn't visible.

**Fix in practice:** mount the host to `document.documentElement` (`<html>`),
not `document.body`. `body > *` doesn't match it. It also survives scripts
that clear `document.body.innerHTML`.

*See case 012.*

## The four lifecycle states

At any moment, the extension is in one of four states. Each is a distinct
code path and each has its own failure mode.

| State | What runs | How it ends |
|---|---|---|
| **Idle** | Nothing. No observers, no timers, no listeners beyond the standard ones. | User opens the popup, or navigates to a video page. |
| **Selecting** | A click-driven hit-test flow. `mousemove` is throttled to ~16 Hz. | User clicks a caption (lock), Escape, or right-click. |
| **Locked** | Observer on the caption container. Every cue = one mutation = one `textContent` read. | User unlocks, or the container is permanently removed. |
| **Auto-detecting** | A 280ms tick that scans the video's player subtree. Only runs in `full-auto` / `replace-native` modes. | User switches modes or locks manually. |

The extension spends 99% of its time in Idle or Locked.

## The four hot paths, and what's allowed on each

1. **`mousemove` (interactive translation).** Throttled. Bands pre-filter.
   Never runs while selection is active.
2. **`MutationObserver` on the caption container.** Reads `textContent` only.
   No geometry. This is the cue-change path.
3. **`MutationObserver` on the video's grandparent (recovery).** Coalesced
   to 150ms. Only scans when the fast path fails.
4. **Auto-detect tick (280ms).** Only in auto modes. Text-first, bounded to
   300 elements per video.

Everything else is event-driven, one-shot, or state-driven.

## What "universal" means here

- **Geometry, not class names.** Class names are used as preferences on
  top of geometry. Removing every class-name check from the codebase would
  still produce correct results — it might just be slower or less precise.
- **The invariant, not the platform.** We rely on "the caption container
  is stable across cues." That's true on every platform. It's not true
  for canvas-rendered captions — those have no DOM element to lock onto,
  and no DOM-based approach will ever handle them.

## Where each piece lives

- `content/detection/` — geometric candidate walk, predicates, scoring.
- `content/locking/` — container resolution, observer attachment, recovery.
- `content/selection/` — click-driven selection mode.
- `content/translation/` — cue text translation and interactive word/phrase.
- `content/ui/` — Shadow DOM host and React overlay.
- `utils/` — DOM helpers, text predicates, debounce.

## Non-obvious decisions, in one line each

- **We lock the container, not the leaf.** The leaf dies every cue.
- **We observe the video's grandparent, not the container.** The container
  sometimes dies too.
- **We never recover by scanning.** If the container is gone, the lock is
  gone.
- **We mount to `documentElement`, not `body`.** Page CSS targets `body > *`.
- **We draw around the leaf, not the container.** Wrappers are often wider
  than the text.
- **We never run a `requestAnimationFrame` loop.** Positioning is event-driven.
- **We never use `innerText`.** `textContent` is a V8 string; `innerText`
  forces layout.