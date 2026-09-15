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
- **Fix** — the code change, or the architectural change.
- **Why this is general** — the reason the fix applies beyond the one site
  it was found on. If it doesn't generalise, that's noted explicitly.
- **Invariant** — a one-sentence rule that, if kept, would have prevented
  the bug. If the same class of bug shows up again, it means an invariant
  was violated.
- **Regression test** — how to confirm the bug is gone, precisely enough
  that a stranger can reproduce it.

## The two rules of the case files

1. Every case ends with an **invariant**.
2. Every case has a **status** — `Fixed`, `Mitigated`, `Open`, or `Won't fix`.
   Open cases are known limitations, not oversights.

## A note on the numbering

Case numbers are sequential and never reused. If a later fix invalidates an
earlier case file, the earlier file is annotated and its status is changed —
but the number stays. Deleting a case file would hide the fact that the
problem existed at all.