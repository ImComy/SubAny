# 016 — Native cue selection box was broad, static, and not word-interactive

**Status:** Fixed
**Severity:** High
**Category:** UI
**Platforms:** Native TextTrack players
**Discovered:** A native-caption player showed a dashed box much wider than
the visible subtitle. The box stayed in one place as cues changed, and
hovering words produced no word highlight or translation.

## Symptom

The console reported `leaf: undefined` when the user clicked a visible
caption. The click was valid, but the subtitle had no DOM leaf because it
was rendered by the browser's native `TextTrack` renderer.

The selection indicator was a large video-relative rectangle instead of a
box around the text. It did not refresh when the active cue changed.
Native captions also had no DOM text node for `TextExtractor` to inspect,
so word hover and click translation did nothing.

## Root cause

The native fallback used a fixed proxy rectangle derived from a large
percentage of the video. It stored one `NativeSubtitleHit` at selection
time, but manual native selection stopped auto-detection and never started
the media monitor. Consequently, later cues could not update the selected
geometry or text.

The interactive controller only called DOM extraction when
`activeContainerEl` existed. Native selection intentionally has no active
DOM container, so the existing universal extraction fallback was never
reached for native hover.

## Fix attempts (chronological)

Three attempts were made. The first two were false leads — both assumed
the caption was DOM-rendered, which it was not on the player that exposed
this bug. They are recorded here so a future maintainer recognises the
same diagnostic trap.

### 1. Compute `lockedRect` from the caption wrapper's text bounds — ❌ Failed

**Hypothesis.** The dashed border was drawn from
`lockedElement.getBoundingClientRect()`, which on this player returned the
full-width caption wrapper. The fix should compute a tighter `lockedRect`
by walking the wrapper's text nodes with a `Range`.

**Change.** Added a `measureCaptionBounds` walk in `ContentRenderer` that
unions the client rects of every non-interactive text node inside the
wrapper. Passed the result to `SubtitleOverlay` as `lockedRect` and used
it exclusively for the dashed border. A separate fallback computed the
bounds with an element-level `Range` when no text nodes were found.

**Result.** Failed. The caption on this player is rendered by the
browser's native `TextTrack` layer, not the page DOM. There is no wrapper
to walk. `activeContainerEl` was already `null` at the time the overlay
rendered, so `measureCaptionBounds` never ran. The visible dashed box was
the native fallback rectangle, not the DOM lock border.

**Why it looked plausible.** The console reported a live DOM node at the
click point — `span.mui-fncw26` containing the caption text — because the
player *also* renders the same cue into a DOM node for accessibility and
for the click-target area. Two rendering paths existed on the same page:
the DOM node (which the click hit) and the native `TextTrack` layer
(which drew the visible box). The extension had no way to distinguish
them at click time, so the DOM path was assumed.

### 2. Remove the overlay's per-frame RAF loop — ❌ Failed

**Hypothesis.** After attempt 1, the box was still wrong. The
`SubtitleOverlay` component scheduled a `requestAnimationFrame` loop that
re-read `getBoundingClientRect()` on every frame and kept mutating overlay
styles. If the loop was reading a stale target, the box would stay at the
wrong position even after the lock was re-established.

**Change.** Replaced the RAF loop with a `useLayoutEffect` that
repositions the overlay only when its input props change.

**Result.** Failed. The box did not move. Two reasons: (a) the box was
the native fallback rectangle, which is positioned once at click time and
is not driven by the overlay's RAF loop; (b) the native proxy was being
refreshed by the media-event monitor, but the media monitor was never
started for manual native selection, so the refresh had nothing to do.

**Why it looked plausible.** The RAF loop was a genuine issue under the
performance contract — invariant 5 in `AGENTS.md` explicitly forbids it —
and the loop *did* hold a `lockedRect` prop that could go stale between
React renders. Removing it was the right call in isolation, and it
survived the refactor. It just was not the cause of the visible bug.

### 3. Drive native selection from the active `TextTrack` cues — ✅ Worked

**Hypothesis.** The caption is native, so the selection must be driven by
the video's active `TextTrack`. Manual native selection must start the
same media monitor that auto-detection uses, and the proxy rectangle must
be sized from the cue text rather than from a fixed percentage of the
video.

**Change.**

- Native cue rectangles are now sized from the cue text using canvas text
  metrics (`CanvasRenderingContext2D.measureText`) instead of a fixed
  percentage of the video.
- Manual native selection starts the existing video media-event monitor.
- Each media tick checks only the selected video's active text tracks,
  using the previous cue rectangle as the geometry reference. No
  document-wide scan, no host-layout reads.
- Native word extraction uses the selected cue's text and canvas metrics
  to compute the word rectangle under the pointer. It does not require a
  DOM node and does not read host layout during `mousemove`.
- The native selection box and the interactive word highlight remain
  separate visual states: dashed outline for cue selection, filled
  highlight for word or phrase translation.

**Result.** Works. The dashed box surrounds the visible cue text, resizes
and moves with each cue change, and word hover and click translation both
function. DOM-based locking on DOM-rendered players is unaffected.

## Why this is general

Browser-native captions are rendered outside the page DOM, so DOM caret and
range APIs cannot provide their text or word rectangles. The video and
active `TextTrack` are the stable source of truth. Any player that uses
`TextTrack` and renders cues in the browser's native overlay will hit the
same set of failures if the extension tries to treat it as a DOM player.

The diagnostic trap — a DOM node exists at the caption position, so the
extension assumes the caption is DOM-rendered — is also general. Players
commonly mirror the current cue into a hidden or partially-visible DOM
node for accessibility while still drawing the visible box from the native
track. `getSubtitleElementAtPoint` will find that DOM node; the visual
lock must still fall through to the native path.

## Invariant

Native subtitle selection must be driven by the selected video's active
text track. It must not depend on a DOM leaf, a fixed full-video proxy
rectangle, or DOM caret extraction.

## Regression test

1. Open a player that renders captions through `video.textTracks` without
   a subtitle DOM element. The player used during diagnosis was
   `vidfast.vc` on `braflix.bz`.
2. Enter selection mode and click a visible caption.
3. Confirm `leaf: undefined` may still be logged, but the dashed box
   closely surrounds the visible caption text.
4. Let several different cues pass. Confirm the box moves and resizes with
   each cue.
5. Hover a word inside the selected caption. Confirm the filled word
   highlight follows that word.
6. Use hover or click translation. Confirm the selected native word is
   translated.
7. Click outside the cue or press Escape. Confirm the native selection
   state clears.
8. Repeat with a DOM-rendered subtitle player (YouTube). Confirm
   stable-container locking still follows cue changes.
9. Record a performance trace while captions change. Confirm the manual
   native media tick does not scan the document or call host-element
   geometry APIs in a loop.