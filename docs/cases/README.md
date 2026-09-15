# Case Files

Every bug and edge case we've hit in the field. Numbered sequentially.
Never renumbered.

| ID | Title | Category | Status | Platforms |
|---|---|---|---|---|
| [001](./001-youtube-full-document-scan.md) | YouTube froze for seconds on every cue change | Performance | Fixed | YouTube |
| [002](./002-subtitleoverlay-raf-loop.md) | Overlay's rAF loop forced layout 60×/sec | Performance | Fixed | YouTube, all |
| [003](./003-lock-container-not-leaf.md) | Lock died every cue because it targeted the leaf | Architecture | Fixed | YouTube |
| [004](./004-caption-wrapper-reused-for-timecode.md) | Container's textContent became a timecode between cues | Detection | Fixed | Videasy |
| [005](./005-caption-wrapper-destroyed-between-cues.md) | Caption wrapper is created per cue, not reused | Detection | Fixed | Videasy |
| [006](./006-selection-hit-test-returns-player-container.md) | Hit-test returned the whole player container | Detection | Fixed | Videasy, all |
| [007](./007-caption-sits-above-30-percent.md) | Caption anchored above the 30% band was rejected | Detection | Fixed | Videasy |
| [008](./008-cross-origin-iframe-message-routing.md) | Popup message never reached the player iframe | Messaging | Fixed | Videasy, Braflix |
| [009](./009-video-less-frame-startup-guard.md) | Video-less frame guard broke mounting | Lifecycle | Fixed | Videasy, all |
| [010](./010-settings-panel-hijack-via-stale-selector.md) | Stale selector matched a settings panel | Detection | Fixed | Videasy |
| [011](./011-wrapper-locked-instead-of-leaf.md) | Dashed box was drawn around the wrapper, not the text | UI | Fixed | Videasy |
| [012](./012-host-hidden-by-page-css.md) | Page CSS hid the extension host | Environment | Fixed | TryEmbed, JWPlayer |
| [013](./013-near-miss-clicks.md) | Clicks 6–9px outside the caption didn't register | Detection | Fixed | All |
| [014](./014-auto-detect-dies-on-empty.md) | Auto-detect stopped permanently after first silence | Lifecycle | Fixed | All |
| [015](./015-dynamic-ids-in-selectors.md) | Selectors generated from counter IDs broke on rebuild | Persistence | Fixed | YouTube |

## Categories

- **Performance** — something forced layout on a hot path.
- **Architecture** — the engine's structural choices were wrong.
- **Detection** — the geometric walk or predicates failed.
- **Messaging** — popup ↔ content-script communication failed.
- **Lifecycle** — startup, teardown, or mode-switch behaviour was wrong.
- **Persistence** — the locked selector broke across a player rebuild.
- **UI** — the overlay or tooltip rendered incorrectly.
- **Environment** — the host page interfered with the extension.

## Template for new cases

Copy this into a new file, name it `NNN-title-in-kebab-case.md` with the
next available number, and add a row to the table above.

```markdown
# NNN — Short title

**Status:** Fixed | Mitigated | Open | Won't fix
**Severity:** Critical | High | Medium | Low
**Category:** [one of the categories above]
**Platforms:** [where this was seen, or "All"]
**Discovered:** [one line of context — what triggered the investigation]

## Symptom

What the user sees. Observable behaviour, not diagnosis.

## Root cause

The actual mechanism. Function names, line numbers if useful. Why the
symptom happens.

## Fix

The exact change. Code snippet if it clarifies.

## Why this is general

Why the fix applies beyond the one site it was found on. If it's a one-off,
say so.

## Invariant

One sentence. A rule that, if kept, would have prevented the bug.

## Regression test

How to confirm the fix works, precisely enough that a stranger can
reproduce it.