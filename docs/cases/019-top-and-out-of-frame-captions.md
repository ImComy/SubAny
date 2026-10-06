# 019 — Top-of-screen and out-of-frame captions rejected by bottom-band gates

**Status:** Fixed
**Severity:** High
**Category:** Detection
**Platforms:** All (anime, top dialogue, letterboxed players)
**Discovered:** Captions at top of video (e.g. Test 047, Test 112, anime dialogue, title-card captions) were completely ignored and impossible to select or auto-detect.

## Symptom

When a video displayed subtitles in the top third of the frame, above character heads, or slightly outside the `<video>` element box inside the player letterbox area, SubAny did not highlight them in selection mode, did not auto-detect them, and rejected them on manual click.

## Root cause

Seven separate hardcoded gates assumed subtitles only exist in the bottom half of the video:
1. `isPlausibleSubtitleLeaf` enforced `centerY < videoRect.top + videoRect.height * 0.15` floor.
2. `isInSubtitleBand` in `SubtitleHitTester.ts` rejected pointer clicks when `clientY < videoRect.top + videoRect.height * 0.55`.
3. `isPointerNearSubtitleBand` in `InteractiveTranslationController.ts` used a 55% bottom threshold.
4. `isPointerInsideVideo` in `MouseEvents.ts` strictly tested `<video>` bounding box, dropping clicks in letterboxed player areas.
5. `AutoDetectScorer.ts` required `yRatio >= 0.35`.
6. `isHealthyLockedElement` in `LockedAnchor.ts` rejected locked elements with `yRatio < 0.55`.
7. `NativeSubtitleDetector.ts` restricted `isLikelySubtitleZone` to 62%–97%.

## Fix attempts (chronological)

### 1. Remove individual bottom-half ratio checks ad-hoc — ❌ Failed

**Hypothesis.** Relaxing `yRatio < 0.55` in hit-tester would fix top captions.

**Change.** Changed 0.55 to 0.10 in `SubtitleHitTester.ts`.

**Result.** Click selection worked sometimes, but lock maintenance and auto-detect still immediately discarded the locked container because `LockedAnchor.ts` and `AutoDetectScorer.ts` had their own 0.55 / 0.35 floor gates.

**Why it looked plausible.** The symptom was first seen in hit-testing, but multiple independent modules each had hardcoded assumptions about bottom-only captions.

### 2. Unified `getSubtitleAcceptanceRegion(video)` and top-band scoring — ✅ Worked

**Hypothesis.** Subtitles can legitimately appear anywhere in the player shell (top for anime/translations, bottom for standard dialogue, letterbox bars for wide aspect ratios). A single acceptance region should define validity across all modules.

**Change.**
1. Created `getSubtitleAcceptanceRegion(video)` in `utils/dom.ts` that computes bounding bounds spanning the video and player shell with forgiving margins.
2. Updated `SubtitleHitTester`, `InteractiveTranslationController`, `NativeSubtitleDetector`, and `SelectionController` to test against this acceptance region.
3. Updated `isPlausibleSubtitleLeaf` to accept top captions by default (`allowTop: true`).
4. Updated `AutoDetectScorer` to score top-band (0.04–0.28) captions alongside bottom-band (0.60–0.95).
5. Removed `yRatio < 0.55` gate from `isHealthyLockedElement`.

**Result.** Captions at the top, bottom, and in player letterbox margins are recognized, selectable, and trackable.

## Why this is general

Captions in non-English media (e.g. Japanese anime, multi-speaker films, documentaries) routinely place text at the top of the video to avoid obscuring on-screen graphics or lower thirds.

## Invariant

Never reject a plausible caption element based solely on vertical position within the player.

## Regression test

Open `testing/index.html` Test 047 (Caption anchored at top of video) and Test 112 (Top-of-frame caption with bottom chrome). SubAny must highlight the top caption in selection mode and lock it on click.
