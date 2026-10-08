# Case Files

Every bug and edge case we've hit in the field. Numbered sequentially.
Never renumbered, except when a case turns out to have been a misfiled
fix attempt — see **Misfiled cases** below.

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
| [016](./016-native-cue-selection-drift.md) | Native cue selection box was broad, static, and not word-interactive | UI | Fixed | Native TextTrack players |
| [019](./019-top-and-out-of-frame-captions.md) | Top-of-screen and out-of-frame captions rejected by bottom-band gates | Detection | Fixed | All |
| [020](./020-multi-span-leaf-selection.md) | Multi-span caption selection isolated single word instead of full sentence | Detection | Fixed | All |
| [021](./021-transform-motion-tracking-stall.md) | Transform motion tracking stopped after empty cue gap until hover | Lifecycle | Fixed | All |
| [022](./022-multi-line-block-captions.md) | Multi-line and dual-subtitle block containers isolated to single line | Grouping & Locking | Fixed | All |
| [023](./023-shadow-dom-and-iframe-captions.md) | Captions inside Shadow DOM and iframes not selected or tracked | Detection & Environment | Fixed | Shadow DOM, iframes, all |

Numbers 017 and 018 are retired. They were fix attempts during the
diagnosis of case 016 that were mislabelled as their own cases. Their
content is folded into case 016's `Fix attempts` section. Do not reuse
the numbers.

## Categories

- **Performance** — something forced layout on a hot path.
- **Architecture** — the engine's structural choices were wrong.
- **Detection** — the geometric walk or predicates failed.
- **Messaging** — popup ↔ content-script communication failed.
- **Lifecycle** — startup, teardown, or mode-switch behaviour was wrong.
- **Persistence** — the locked selector broke across a player rebuild.
- **UI** — the overlay or tooltip rendered incorrectly.
- **Environment** — the host page interfered with the extension.

## The two rules of the case files

1. **One case per bug, not per attempt.** Two false leads and a working
   fix are one case file, not three. Every attempt to fix a bug goes in
   the `Fix attempts` section of the file for that bug, in chronological
   order, with an explicit `✅ Worked` / `❌ Failed` / `⚠️ Partial`
   marker. Only the last entry may be `✅ Worked`, and only a case whose
   last entry is `✅ Worked` may be marked `Fixed`.

2. **Failed attempts are recorded, not deleted.** A failed attempt with
   a clear *"why it looked plausible"* note is the single most valuable
   thing a case file contains. It is the only mechanism that prevents
   the same diagnostic trap from being re-entered by a future
   maintainer.

## What counts as a "major" attempt

An attempt belongs in the `Fix attempts` section if it meets **any** of:

- It changed a hypothesis about the root cause.
- It changed the code path that handles the bug, not just a constant or
  a log line.
- It took more than 30 minutes to design, implement, or test.

Cosmetic tweaks (adding a log line, fixing a typo, adjusting a threshold
within the same design) do not belong. If you are unsure, ask: *"Would a
future maintainer benefit from knowing I tried this and it didn't
work?"*

## Status values

- **`Fixed`** — root cause identified, working fix present in the code,
  regression test has been run against the current build at least once.
- **`Mitigated`** — partial fix. The symptom is reduced but the case is
  still observable in some conditions. The residual is described in the
  case body.
- **`In progress`** — actively being worked on. One or more failed
  attempts are present in the `Fix attempts` section. Used while a case
  is moving.
- **`Open`** — known limitation, not actively being worked on. A file in
  this state describes the bug clearly but may not have any fix attempts
  yet.
- **`Won't fix`** — acknowledged, deliberately not fixing. The case body
  must state why.

## Misfiled cases

A misfiled case is a file that turns out to have been a fix attempt
mislabelled as its own case. Symptoms of a misfiled case:

- Its `Status` field says `Fixed`, but the code change it describes is
  no longer in the tree.
- Its root cause describes a hypothesis, not a proven mechanism.
- Its fix was a step on the way to a different case's working fix, and
  that other case now covers the same user-visible symptom.
- Its `Invariant` and `Regression test` sections describe the same
  thing as another case file's.

When you discover a misfiled case:

1. Add the attempt to the parent case's `Fix attempts` section, in its
   original chronological position, with the `❌ Failed` marker and a
   `Why it looked plausible` subsection.
2. Delete the misfiled file.
3. Remove its row from the table above, and add a line under the table
   noting the retired number.
4. **Do not reuse the retired number.** The point of the number is to
   prevent the codebase from forgetting that the attempt existed. The
   parent case carries that memory; the number itself is retired.

Retiring a number is a deliberate act. It says: *"this was not a bug, it
was a mistake in the diagnostic process."* It is the only circumstance
in which a case number disappears.

## Adding a new case

### When to add

- Any bug that took more than 30 minutes to diagnose.
- Any bug whose root cause was non-obvious.
- Any edge case that shows a gap in the geometric detection model.
- Any performance regression.
- Any change to the "Absolute Invariants" list in `AGENTS.md`.

### When not to add

- Trivial typos, missing imports, etc.
- One-off player quirks that don't generalise — note those in
  `docs/ENGINE.md` under "Known limitations" instead.
- A failed fix attempt — add it to the existing case file for the bug
  it was trying to fix. Do not create a new case file for an attempt.

### Numbering

Take the next available number. Files are named
`NNN-title-in-kebab-case.md`. Do not renumber existing files. Do not
reuse retired numbers.

## Template for new cases

Copy this into a new file, name it `NNN-title-in-kebab-case.md` with the
next available number, and add a row to the table above.

```markdown
# NNN — Short title

**Status:** Fixed | Mitigated | In progress | Open | Won't fix
**Severity:** Critical | High | Medium | Low
**Category:** [one of the categories above]
**Platforms:** [where this was seen, or "All"]
**Discovered:** [one line of context — what triggered the investigation]

## Symptom

What the user sees. Observable behaviour, not diagnosis.

## Root cause

The actual mechanism. Function names, line numbers if useful. Why the
symptom happens. Written in past tense from the perspective of what is
now known, even if the root cause was not identified until the working
attempt.

## Fix attempts (chronological)

Every major attempt to fix this bug, in the order it was made. The last
entry is the working fix. A case can only be marked `Fixed` when the
last entry has `✅ Worked`.

### 1. Short description of the attempt — ✅ Worked | ❌ Failed | ⚠️ Partial

**Hypothesis.** What the attempt believed was wrong.

**Change.** The code or architectural change that was made. Code
snippet only if it clarifies the attempt.

**Result.** What actually happened. If it failed, state *why* it failed,
not just *that* it failed.

**Why it looked plausible.** (Failed and partial attempts only.) The
reasoning that made the attempt look correct at the time. This is the
section that prevents the same trap from being re-entered. If the
failure was obvious in hindsight, say so; if it was subtle, explain
the thing that made it look right.

## Why this is general

Why the fix applies beyond the one site it was found on. If it's a
one-off, say so explicitly.

## Invariant

One sentence. A rule that, if kept, would have prevented the bug.

## Regression test

How to confirm the fix works, precisely enough that a stranger can
reproduce it.