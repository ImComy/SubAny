# 020 — Multi-span caption selection isolated single word instead of full sentence

**Status:** Fixed
**Severity:** High
**Category:** Detection
**Platforms:** All (players splitting words/tokens into spans, YouTube `ytp-caption-segment`)
**Discovered:** In `testing/index.html` Test 004, the selection hover box highlighted only the first word `<span>My</span>`, and clicking locked only that single word span.

## Symptom

When hovering over or clicking a subtitle whose words or karaoke tokens are wrapped in individual `<span>` elements (e.g. `<span>My</span> <span>wife--</span> <span>same</span> <span>thing.</span>`), the selection box and lock indicator outline only the first word rather than the whole sentence. When the next dialogue cue arrives, the lock remains stuck on the first word token or drops out.

## Root cause

1. `document.elementsFromPoint(x, y)` returns elements in innermost-first order. The hit-tester evaluated `<span>My</span>` first. Because "My" has length >= 2 and valid text, `isPlausibleSubtitleLeaf` returned `true`.
2. `getPreferredSubtitleLeaf` only walked down into single-child nodes and never walked up.
3. `findCaptionElementAtPoint` penalized larger bounding boxes (`score -= area / 2000`), preferring smaller word spans over the enclosing sentence line.
4. Consequently, `state.selectionCandidateEl` was set to the word span `<span>My</span>`. On click, `generateUniqueSelector` generated a positional selector like `span:nth-child(1)`, anchoring to the first child span instead of the sentence container `<span class="caption-text">`.

## Fix attempts (chronological)

### 1. Resolve container inside `handleSelectionClick` only — ❌ Failed

**Hypothesis.** If `resolveStableContainer` walked up from the clicked word span during click, the lock would attach to the line container.

**Change.** Added ancestor checks in `resolveStableContainer`.

**Result.** Click selection locked the line, but during selection mode hover, the candidate preview box still only boxed the first word `<span>My</span>`. Users were confused because the blue preview box did not indicate the full sentence was going to be selected.

**Why it looked plausible.** Fixing click lock resolved persistent tracking, but selection preview uses `state.selectionCandidateEl` which is populated by `getSubtitleElementAtPoint` on `mousemove`.

### 2. Comprehensive multi-pipeline escalation — ✅ Worked

**Hypothesis.** Word-level tokenization in modern players (YouTube, karaoke, multi-span HTML5 players) cannot be solved at a single entry point because selection preview, click locking, candidate scoring, auto-detection, and UI rendering each independently evaluate element candidates. If any pipeline bypasses line resolution or penalizes multi-child containers, the lock or dashed box collapses back down to a single word.

**Full pipeline resolution:**
1. **`utils/dom.ts` — `resolveCaptionLineContainer`:**
   Inline phrasing containers (`display: inline` / `<span>`) are recognized as inherently text-hugging lines and are not discarded by block slack thresholds.
2. **`content/locking/LockMonitor.ts` & `LockController.ts`:**
   `resolveStableContainer` and `findCaptionInVideo` escalate through `resolveCaptionLineContainer(clickedElement, videoRect)` before walking up the tree, anchoring selectors to the line wrapper rather than the `:nth-child(1)` leaf token.
3. **`content/detection/CandidateScorer.ts`:**
   Added `isInlineLine` check: multi-span phrasing containers whose children are all inline phrasing tags (`span`, `b`, `i`, `em`, `strong`, `mark`, etc.) receive the +50 `inline-line-container` score instead of receiving the `-25` multiple-children and `-40` has-subtitle-child penalties.
4. **`content/detection/DomSubtitleDetector.ts`:**
   `findBestSubtitleContainer()` escalates the best match through `resolveCaptionLineContainer(best, vr)` instead of descending to the deepest child leaf via `getDeepestTextContainer`.
5. **`content/autodetect/AutoDetectScorer.ts`:**
   `collectAutoSubtitleCandidates()` normalizes candidates via `resolveCaptionLineContainer(candidate.element, videoRect)` before passing them to grouping.
6. **`content/detection/SubtitleGrouping.ts`:**
   `canBelongToSubtitleGroup()` now recognizes same-line adjacent tokens (`verticalOverlap >= 45%` of height and `horizontalGap <= wordSpacing`), allowing same-line multi-span words to group together with whitespace-tolerant character validation.
7. **`content/ui/ContentRenderer.ts`:**
   `resolveRectTarget()` escalates `activeContainerEl` through `resolveCaptionLineContainer()` before computing glyph or element bounds, guaranteeing the dashed tracking box always encloses the full sentence.

**Result.** In multi-span captions (Test 004, YouTube segment spans, karaoke cues), hovering over any word highlights the full sentence box, clicking locks the sentence container, auto-detection captures the entire line, and cue updates smoothly cover all words.

## Why this is general

Modern video players (YouTube, Netflix, HTML5 custom players) frequently split subtitles into word spans for karaoke styling, timing highlights, or word-level formatting. Subtitle selection must always target the semantic sentence line, not isolated word spans.

## Invariant

Selecting any token or word within a multi-span subtitle line must resolve to the full cohesive line container across all subsystems: manual hover preview, click locking, auto-detection, and renderer bounds calculation.

## Regression test

Open `testing/index.html` Test 004 (`Multi-span caption (words split across spans)`). Enter selection mode and hover over any word in "My wife-- same thing.". The selection box must enclose the entire sentence. Click to lock: the blue dashed box must hug the full sentence and update across cues.
