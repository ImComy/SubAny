# 024 — Very long multi-line captions and SVG text overlays fail selection and locking

**Status:** Fixed  
**Severity:** High  
**Category:** Detection, Selection & Locking  
**Platforms:** All (lectures, transcripts, dialogues, news tickers, SVG caption overlays, D3/SVG players)  
**Discovered:** In `testing/index.html` Test 071 (long wrapped caption with 327 characters across 5-6 lines) and Test 075 (SVG `<text>` element caption overlay), hovering and clicking failed to detect, preview, or lock the subtitles.

## Symptom

1. **Test 071 (Very long text across 5-6 lines):**
   - The caption text contains 327 characters and wraps across 5-6 lines in a 600×338px video container.
   - The total rendered height is ~178px (approx. 53% of video height).
   - Moving the mouse over the text or clicking produced no dashed bounding box, no selection glow, and no lock. The element was completely ignored.

2. **Test 075 (SVG text overlay):**
   - The subtitles are rendered inside `<svg class="svg-caption-overlay"><text class="svg-caption-text">...</text></svg>`.
   - Hovering or clicking over the text never showed the dashed preview box or allowed locking.
   - Long cues (e.g. standard cue #3 with 92 characters, rendered in SVG without wrapping at ~1288px width) failed width bounds against the 800px video container.

## Root cause

1. **Strict 40%–45% height thresholds:**
   - In `LockedAnchor.ts`, `isValidSelectionTarget` and `isHealthyLockedElement` checked:
     ```ts
     if (contentHeight >= videoRect.height * 0.45) return false;
     ```
   - In `SubtitleGrouping.ts` and `LockMonitor.ts`, height was capped at `videoRect.height * 0.40`.
   - On compact or 16:9 players (e.g. 600×338px), 40%–45% is only 135–152px. A 5-6 line wrapped speech or lecture caption easily measures 170–210px in height, causing immediate rejection as an assumed "full player layout container".

2. **400-character caps in text filters:**
   - Text filters in `utils/dom.ts`, `LockMonitor.ts`, and `AutoDetectScorer.ts` enforced `text.length <= 400`.
   - Long captions, multi-sentence dialogues, or transcript-style speech cues exceeding 400 characters were discarded prior to any geometry check.

3. **False wrapper rejection in `isPlausibleSubtitleLeaf`:**
   - `isPlausibleSubtitleLeaf` contained a heuristic:
     ```ts
     if (r.width > videoRect.width * 0.95 && r.height > videoRect.height * 0.15) return false;
     ```
   - A genuine leaf node (such as a single `<span>` or `<p>` with no block child elements) wrapping across multiple lines reaches ~100% width and >15% height, causing it to be misidentified as a background wrapper instead of a text leaf.

4. **DOM hierarchy & `SVGElement` rejection:**
   - `SVGElement` (and `SVGTextElement`) does not inherit from `HTMLElement` (`el instanceof HTMLElement` evaluates to `false`).
   - `svg` was listed in `SKIP_TAGS` in `utils/dom.ts`, `SelectionController.ts`, and `LockMonitor.ts`.
   - In standard SVG, `<text>` does not wrap by default. Long single-line cues render across wide coordinates (e.g. ~1288px width on an 800px player). Checks requiring `r.width <= videoRect.width * 0.96` falsely rejected SVG text as "out-of-bounds player chrome".

## Architectural Universal Resolution

### 1. Universal Height & Block Child Distinction
- Subtitles may legally occupy 4 to 8 lines on mobile screens, narrow players, or transcript views (taking up to 60–75% of player height).
- The universal upper bound for subtitle height across `LockedAnchor.ts`, `SubtitleGrouping.ts`, `LockMonitor.ts`, and `AutoDetectScorer.ts` is now:
  ```ts
  const maxHeight = Math.max(320, videoRect.height * 0.75);
  ```
- To safely distinguish genuine multi-line text leaves from actual player wrapper divs (which also span large heights), we introduced `hasBlockChildren(el)` in `utils/dom.ts`. An element is only treated as a candidate layout wrapper if it contains block-level child elements (`<div>`, `<section>`, etc.). If it only contains text or inline tags (`<span>`, `<b>`, `<tspan>`, etc.), it is accepted as a valid subtitle leaf.

### 2. Expanded Text Length Limit
- Bumped subtitle text length limit from 400 to 1200 characters across `utils/dom.ts`, `LockMonitor.ts`, and `AutoDetectScorer.ts`. This supports extensive transcript passages, dense multi-sentence speech, and fast dialogue.

### 3. Native SVG Caption Support Across the Entire Pipeline
- **Type Guard & Element Hierarchy:** Broadened all subtitle element references, candidate states, hit-testers, and observers from `HTMLElement` to `HTMLElement | SVGElement` across:
  - `utils/dom.ts`
  - `content/state/ContentState.ts`
  - `content/state/types.ts`
  - `content/selection/SelectionController.ts`
  - `content/selection/SubtitleHitTester.ts`
  - `content/locking/LockedAnchor.ts`
  - `content/locking/LockController.ts`
  - `content/locking/LockMonitor.ts`
  - `content/locking/LockRecovery.ts`
  - `content/detection/SubtitleGrouping.ts`
  - `content/detection/DomSubtitleDetector.ts`
  - `content/detection/CandidateScorer.ts`
  - `content/autodetect/AutoDetectScorer.ts`
  - `content/autodetect/AutoRegionKey.ts`
  - `content/autodetect/AutoTrackStore.ts`
  - `content/ui/ContentRenderer.ts`
  - `content/replacement/DomTextSwapper.ts`
  - `components/SubtitleOverlay.tsx`
  - `lib/TextExtractor.ts`
- **Selective SVG Walking:** Removed `svg` from unconditional `SKIP_TAGS`. `<svg>` containers are walked when they contain `<text>` nodes, and individual `<text>` nodes are treated directly as atomic subtitle leaves.
- **SVG Geometry & Glyph Bounds:**
  - `measureGlyphBounds(el)` detects `el instanceof SVGElement` and uses native SVG `(el as SVGGraphicsElement).getBBox()` to obtain exact glyph dimensions.
  - Allowed horizontal width for SVG text elements up to `Math.max(videoRect.width * 2.2, 2000)` to accommodate non-wrapping SVG text without triggering player-chrome rejections.
