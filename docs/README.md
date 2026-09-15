# SubAny Documentation

SubAny is a universal subtitle translation extension for Chromium browsers. It
detects, tracks, and translates subtitles on any HTML5 video player — no
site-specific code, no per-player configuration.

The extension works because of one architectural decision, and every bug
we've hit has been a violation of that decision. This folder is where we
record the decision, and the violations, so the codebase doesn't wander
backwards.

## What's in here

| File | Read if you want to... |
|---|---|
| [`ENGINE.md`](./ENGINE.md) | Understand how the engine works — the mental model, the constraints, the non-obvious design decisions. Read this first. |
| [`cases/`](./cases/) | See every bug and edge case we've hit in the field, why it happened, and how it was fixed. |

If you are an AI agent working on this codebase, read
[`../AGENTS.md`](../AGENTS.md) **before anything else**, then come back here.

## How to read the case files

Each case is a self-contained record of a real bug or edge case. The
structure is always the same:

- **Symptom** — what the user sees.
- **Root cause** — the actual mechanism, not the surface effect.
- **Fix attempts (chronological)** — every major attempt to fix the bug,
  in the order it was made. Each attempt records the hypothesis, the
  change, and the result. Failed attempts include a *"why it looked
  plausible"* subsection so the same diagnostic trap is not re-entered.
  The last entry in the list is the working fix.
- **Why this is general** — the reason the fix applies beyond the one site
  it was found on. If it doesn't generalise, that's noted explicitly.
- **Invariant** — a one-sentence rule that, if kept, would have prevented
  the bug. If the same class of bug shows up again, it means an invariant
  was violated.
- **Regression test** — how to confirm the bug is gone, precisely enough
  that a stranger can reproduce it.

## The three rules of the case files

1. **One case per bug, not per attempt.** Two false leads and a working
   fix are one case file, not three. Attempts go in the `Fix attempts`
   section of the file for the bug they were trying to fix.
2. Every case ends with an **invariant**.
3. Every case has a **status** — `Fixed`, `Mitigated`, `In progress`,
   `Open`, or `Won't fix`.
   - `Fixed` — working fix present in the code, regression test passes.
   - `Mitigated` — partial fix; the residual is described in the body.
   - `In progress` — actively being worked on; has one or more failed
     attempts in the `Fix attempts` section.
   - `Open` — known limitation, not actively being worked on.
   - `Won't fix` — acknowledged, deliberately not fixing.

## What counts as a "major" attempt

An attempt is worth recording in the `Fix attempts` section if it meets
**any** of:

- It changed a hypothesis about the root cause.
- It changed the code path that handles the bug, not just a constant or a
  log line.
- It took more than 30 minutes to design, implement, or test.

Cosmetic changes (log lines, typos, threshold tweaks within the same
design) do not belong in the file. If you are unsure, ask: *"Would a
future maintainer benefit from knowing I tried this and it didn't work?"*

## A note on the numbering

Case numbers are sequential and never reused. If a later fix invalidates an
earlier case file, the earlier file is annotated and its status is
changed — but the number stays.

The one exception is a **misfiled case**: a file that turns out to have
been a fix attempt mislabelled as its own case. When this is discovered,
the attempt is folded into the parent case's `Fix attempts` section and
the file is deleted. The number is retired — not reused for a new case —
because the point of the number is to prevent the codebase from
forgetting that the attempt existed. The parent case carries that memory.

Deleting a case file for any other reason would hide the fact that the
problem existed at all.