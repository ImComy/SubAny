# 021 — Transform motion tracking stopped after empty cue gap until hover

**Status:** Fixed
**Severity:** High
**Category:** Lifecycle / UI
**Platforms:** All (animated/sliding caption wrappers, vidfast.vc, YouTube)
**Discovered:** In `testing/index.html` Test 015, when the caption wrapper moved via `transform: translateY(40px)`, the locked dashed box remained stationary until the user moved the mouse over the text.

## Symptom

When a locked subtitle's wrapper transformed its position (e.g. control bar hiding causing captions to slide down by 40px), the blue dashed box did not follow the subtitle in real time. It remained at the old coordinates until the user moved the mouse cursor over the player or caption area.

## Root cause

Two compounding lifecycle bugs killed position tracking:
1. In `LockMonitor.ts`, `isPlausibleCaptionContainer` checked `if (rect.width <= 0 || rect.height <= 0) return false;` *before* checking `if (text.length === 0) return true; // between cues`. When a dialogue cue ended, an inline span collapsed to 0×0. `isPlausibleCaptionContainer` returned `false`, and `MutationObserver` set `state.activeContainerEl = null`.
2. Inside `startPositionTracking(state)`, `tick()` had an early exit `if (!el) { positionRafId = 0; return; }`. As soon as `activeContainerEl` became `null` during the gap between cues, `positionRafId` was set to 0 and the RAF loop terminated permanently.
3. Subsequent cues or transform style changes never restarted `startPositionTracking`.
4. Only hovering triggered `handleInteractiveMouseMove` in `InteractiveTranslationController.ts`, calling `state.notify()` which finally caused React to re-measure and redraw the box at the new position.

## Fix attempts (chronological)

### 1. Invert empty text check order in `isPlausibleCaptionContainer` — ⚠️ Partial

**Hypothesis.** Preventing `activeContainerEl` from being discarded during the empty cue window would keep the container valid.

**Change.** Moved `if (text.length === 0) return true;` before the 0×0 rect check.

**Result.** `activeContainerEl` was preserved when the DOM node was reused, but if a player rebuilt the DOM node or detached it momentarily, `tick()` still permanently stopped when seeing `!el`.

**Why it looked plausible.** Fixing the empty cue check handled the in-place text clearing, but the RAF loop lacked self-healing across DOM node detachment.

### 2. Self-healing rAF loop and cue restart in `LockMonitor.ts` — ✅ Worked

**Hypothesis.** The position tracking loop should remain alive as long as a lock is active, re-resolving the selector if the element is momentarily disconnected, and checking for moves without forcing re-renders when stationary.

**Change.**
1. In `LockMonitor.ts`, updated `startPositionTracking` so `tick()` does not terminate when `el` is temporarily missing; instead it attempts cheap selector re-resolution and only stops when `stopLockedMonitor` is explicitly called.
2. Ensured `startPositionTracking(state)` is started if not already running whenever a real cue is received in `MutationObserver`.
3. Kept the coarse key check (`${r.left.toFixed(1)}:${r.top.toFixed(1)}...`) so `state.notify()` is only invoked when position actually changes, avoiding continuous re-renders when stationary.

**Result.** The locked dashed box tracks transform position changes in real time (within 1 frame) without requiring mouse hover or user interaction, and consumes zero CPU when stationary.

## Why this is general

Control bars sliding in and out on streaming players (YouTube, vidfast, JWPlayer, custom players) routinely shift caption positions using CSS transforms (`translateY`) or top/bottom offsets.

## Invariant

Locked position tracking must survive empty cue windows and follow CSS transforms in real time without requiring pointer events.

## Regression test

Open `testing/index.html` Test 015 (`Caption moves via transform (idle toggle)`). Lock the caption. Without moving the mouse or hovering, verify the dashed box follows the caption down and back up in real time on every transform toggle.
