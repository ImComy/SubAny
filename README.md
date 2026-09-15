# SubAny

A Chrome extension that puts subtitles under a microscope. It finds the caption on any HTML5 video player, tracks it across cue changes, and lets you hover or click a word to translate it — without any per-site code.

Works on YouTube. Works on Braflix. Works on the sketchy streaming site your friend swears by. Works on the one you found at 2 AM and can't remember the name of. If the caption is in the DOM or in a `<track>`, SubAny can probably see it.

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#how-it-works">How It Works</a> · <a href="#case-files">Case Files</a> · <a href="#contributing">Contributing</a>
</p>

---

## Why this exists

Every other subtitle translator I tried fell into one of two categories:

1. **Site-specific.** Nice on YouTube, useless anywhere else.
2. **DOM-fragile.** Selector-based. Broke the moment the player re-rendered, which for a video player is *constantly*.

So this one uses geometry instead of class names. It doesn't care what the caption is *called*. It cares where it *is*: below the video's midpoint, small relative to the video, contains text, isn't a button. That's it. That's the whole detection model.

The tradeoff: SubAny can't find captions rendered to a `<canvas>` with no DOM representation. That's a known limitation, not a bug. There are also three class-name exceptions in the whole codebase — all documented in `AGENTS.md`, all preferences rather than requirements.

---

## The one rule

> **Never force the browser to recompute layout on a hot path.**

This is not a suggestion. It's the reason the extension works at all.

A video player is a live document. On YouTube, `document.body` has tens of thousands of descendants and mutates dozens of times per second. Call `getBoundingClientRect()` in a loop over that tree and you don't get "a bit slow" — you get freezes measured in seconds. I know because I did this. The case file is `docs/cases/001`.

The whole codebase is shaped around that one rule. Every performance decision traces back to it. Every invariant in `AGENTS.md` is a scar from violating it.

> [!WARNING]
> If you're contributing, read `AGENTS.md` before anything else. It's short and it will save you a week.

---

## Quick start

```bash
git clone https://github.com/your-username/SubAny.git
cd SubAny
npm install
npm run dev
```

`npm run dev` launches the extension in a dev Chrome profile with hot reload. If WXT can't find Chrome, point it at one manually or load the built extension from `dist/` via `chrome://extensions` → *Load unpacked*.

Then:

1. Open a video with subtitles.
2. Click the SubAny icon.
3. Pick a mode:
   - **Hover** — hover a word, get a tooltip. Zero commitment.
   - **Click** — click a word, get a translation.
   - **Full-auto** — every cue gets translated to your language below it.
   - **Replace-native** — native cues are swapped for translations.
4. For DOM players, click once on the caption to lock it. For native TextTrack players, the lock happens automatically once you start interacting.

If the dashed border is drawn around the right thing, you're in business.

---

## How it works (short version)

There are two kinds of video players and SubAny treats them very differently. Recognizing which one you're looking at is half the battle.

**DOM players** render captions as HTML elements. The caption is a `<div>` or `<span>` somewhere under the video. You can query it, walk it, measure it. SubAny locks onto the *stable container* that survives cue changes — not the leaf text node, which dies every cue. The dashed border is computed from the *text bounds inside* that container, not the container's own rect, because players love wrapping a small centered caption in a full-width block.

**Native TextTrack players** render captions in the browser's own overlay, outside the page DOM. There is no leaf to find. There is no container to lock. The only source of truth is `video.textTracks` and the active cue. SubAny measures cue text with `CanvasRenderingContext2D.measureText()` and computes word rectangles from those metrics, because no DOM API can tell you where a native cue word is on screen.

> [!NOTE]
> If you see `leaf: undefined` in the console, you're on a native player. That's not an error. It's information.

Full details in `docs/ENGINE.md`.

---

## The case file system

This is the part where i document most of my work and debugging process 

Every bug SubAny has ever had is in `docs/cases/`, numbered, with:

- **Symptom** — what the user saw.
- **Root cause** — what was actually happening.
- **Fix attempts** — *every* major attempt, in order, with a pass/fail marker. The working one is last.
- **Why it looked plausible** — for failed attempts only. The reasoning that made the wrong approach look right at the time.
- **Invariant** — one sentence. A rule that, if kept, would have prevented the bug.
- **Regression test** — how to confirm the fix still works.

Two rules make the system useful:

1. **One case per bug, not per attempt.** If you tried three things and the third worked, that's *one* case file with three attempts. This is not optional. The 017/018 episode in the git history is what happens when you violate it — three case files, one bug, two of them lying about what was actually fixed.

2. **Failed attempts are recorded, not deleted.** A failed attempt with a clear *"why it looked plausible"* is the single most valuable thing a case file contains. It's the only mechanism that stops a future maintainer — or a future AI agent — from re-entering the same diagnostic trap.

Read `docs/cases/README.md` for the full policy, including the "misfiled case" procedure for when a case file turns out to have been a fix attempt in disguise.

---

## Repo layout

```
content/           content script — runs on every page
  detection/         finding the caption (DOM + native TextTrack)
  locking/           install / maintain / release the lock
  tracking/          cue change detection
  translation/       hover, click, full-auto, replace-native
  selection/         click-to-lock interaction
  autodetect/        the full-auto tick
  ui/                renderer + React tree root
  state/             ContentState — the single source of truth
components/        React overlay, tooltip, settings panel
utils/             geometry, text, DOM helpers
docs/
  ENGINE.md          the mental model — read this before touching code
  cases/             every bug we've ever hit
AGENTS.md          hard constraints. Read before writing any code.
```

The layering is enforced by convention, not by tooling. `content/state` is the only thing everyone reads. Everything else is either a producer or a consumer of state. If you find yourself adding a cross-module import that isn't through state, stop and reconsider.

---

## What's in the box

Feature-wise:

- Universal detection. Any DOM player, any native `<track>`.
- Hover translation. One word at a time, no commitment.
- Click translation. Word, phrase, or selection range.
- Full-auto bilingual. Every cue gets a translation below it.
- Replace-native. Swap the native caption for the translation.
- Multiple translation engines with fallback.
- Persistent lock across seeks, ads, player rebuilds.
- Shadow DOM overlay — the page can't style it, and it can't be hidden by page CSS.
- Zero configuration. There is no "select your player from this list of 40" screen. There is no per-site JSON.

The extension is about 4,000 lines of TypeScript, and roughly 30% of that is comments explaining *why* something is the way it is. Read them. They exist because the alternative was losing the reason and reintroducing the bug.

---

## Known limitations

> [!NOTE]
> These are documented limits, not bugs. If you hit one and have a fix, open a case file.

- **Canvas-only captions are not supported.** If the player draws subtitles into a `<canvas>` with no DOM or `TextTrack` representation, SubAny cannot see them. This is not fixable without pixel-level OCR, which is out of scope.
- **Very unusual layouts may confuse the geometric walk.** Captions outside the lower 85% of the video, or captions larger than 30% of video height, are rejected by design. If a real player breaks this, it's a case file waiting to happen.
- **Some players rebuild the caption container on every cue.** The lock survives this via the stored selector and a bounded recovery scan, but the scan is rate-limited to once per 150ms. Very fast players may briefly drop the box between cues.
- **Translation quality depends on the engine.** The extension doesn't do translation. It calls out to services. If the service is down or rate-limits you, that's on the service.

---

## Contributing

Before writing any code:

1. Read `AGENTS.md` — the performance contract. It's short.
2. Read `docs/ENGINE.md` — the mental model. It's a bit longer.
3. Skim `docs/cases/` — the scars. You don't have to read every file. The titles alone will tell you what's been tried.

If you fix a bug that took more than 30 minutes to diagnose, add a case file. If you try something that doesn't work, add it to the existing case file for that bug — don't create a new one. If your fix produces a rule that generalises, add it to the invariants list.

If you're not sure whether something is allowed: ask. A wrong change that ships and gets reverted is worse than a wrong change that never ships.

---

## License

MIT. Do whatever you want with it. Author name links to LinkedIn, not a copyright symbol.