# 022 — Multi-line and dual-subtitle block containers isolated to single line

**Status:** Fixed
**Severity:** High
**Category:** Grouping & Locking
**Platforms:** All (karaoke lyrics, bilingual/dual subtitles, stacked dialogue lines)
**Discovered:** In `testing/index.html` Test 060 (Karaoke captions with simultaneous lines) and Test 061 (Dual subtitles with two stacked languages), selection and locking isolated only one line instead of enclosing the entire multi-line subtitle block.

## Symptom

1. **Test 060 (Karaoke captions):** Two lines are visible simultaneously (`.kline`). Every 3 seconds `data-active` toggles between them. The dashed selection/lock box covered only the first line (`Line one — current lyric`), failing to cover the whole visible caption block (both lines). When `data-active` moved to line two, the lock box stayed stuck on line one.
2. **Test 061 (Dual subtitles):** Two language lines (`.dual-en` and `.dual-target`) are stacked vertically in a shared wrapper. The dashed box enclosed only one line rather than unioning both stacked captions.

## Root cause

1. **Full-width block wrapper rejection in `resolveStableContainer` and `combineSubtitleLines`:**
   Centered caption wrappers (e.g. `.karaoke-wrapper`, `.dual-wrapper`) are styled as full-width blocks (`left: 0; right: 0; width: 100%; text-align: center;`). While their rendered text glyph width is compact (~250px), their layout box width equals the video width (800px).
   - In `LockMonitor.ts`, `resolveStableContainer` unconditionally broke on `parentRect.width - tb.width > MAX_WRAPPER_SLACK_PX` (slack ~550px > 40px) and `parentRect.width > videoRect.width * 0.98`, rejecting the container in favor of the single clicked line.
   - In `SubtitleGrouping.ts`, `combineSubtitleLines` evaluated raw `groupRect.width > videoRect.width * 0.94`, discarding the multi-line group and falling back to the anchor line.
2. **Single-line `:nth-child` selector generation in `generateUniqueSelector`:**
   When `resolveStableContainer` collapsed back down to an individual line (e.g. `<div class="kline">`), `generateUniqueSelector` saw multiple sibling `<div>` lines without a hardcoded subtitle class and appended `:nth-child(1)`. When the active karaoke line toggled from line one to line two, the selector remained anchored to `:nth-child(1)`, stranding the dashed box on line one.
3. **Pairwise-only candidate grouping in `canBelongToSubtitleGroup`:**
   `canBelongToSubtitleGroup` only compared candidates directly against the anchor element. In 3+ line captions or staggered dialogue, line three failed vertical distance to line one, resulting in `actualChars !== expectedChars` which caused `combineSubtitleLines` to reject the entire group. It also rejected dual subtitles where font ratios exceeded 1.7 or alignment was not centered.
4. **Hot path re-resolution in `ContentRenderer.ts`:**
   `resolveRectTarget()` ran `resolveCaptionLineContainer(container)` on the already-resolved container on every render, which broke on multi-line blocks and attempted redundant grouping.

## Fix attempts (chronological)

### 1. Line grouping in Selection/Lock entry points with `isPlausibleCaptionContainer` relaxation — ❌ Failed

**Hypothesis.** Calling `combineSubtitleLines` inside `SelectionController.ts` and relaxing `isPlausibleCaptionContainer` with `hasTighterTextChild` would allow multi-line wrappers to be selected and tracked.

**Change.** Funneled candidate elements through `combineSubtitleLines` during mousemove and click, and added `hasTighterTextChild` to `isPlausibleCaptionContainer`.

**Result.** Failed. The dashed box still isolated only the first line. `resolveStableContainer` was never updated and still broke on `MAX_WRAPPER_SLACK_PX` and `width * 0.98`. `generateUniqueSelector` still generated `:nth-child(1)`. `combineSubtitleLines` still failed when `anchor` was already the container or when lines had non-center alignment.

**Why it looked plausible.** Unit tests that only checked `combineSubtitleLines` on pre-selected elements appeared to succeed, but the full pipeline from click to `resolveStableContainer`, selector generation, and `ContentRenderer` rendering still reverted to single-line leaves.

### 2. Universal multi-line block container recognition and transitive cluster grouping — ✅ Worked

**Hypothesis.** Multi-line and dual-subtitle blocks must be treated as first-class caption containers across the entire pipeline: discovery, grouping, container resolution, selector generation, and visual bounds rendering.

**Full pipeline resolution:**
1. **`content/detection/SubtitleGrouping.ts`:**
   - Introduced `isMultiLineSubtitleContainer`: an element with $\ge 2$ subtitle children whose glyph bounds fit within the video ($\le 95\%$ width, $\le 40\%$ height) is recognized as a legitimate multi-line container.
   - Updated `combineSubtitleLines`: if `anchor` or its immediate parent is already a multi-line container, return it directly.
   - Upgraded grouping to transitive clustering: candidates join the group if they can group with *any* existing cluster member, seamlessly supporting 2, 3, or more stacked lines.
   - In `canBelongToSubtitleGroup`: allowed direct parent siblings to group naturally, expanded font ratio tolerance to 2.8 (supporting dual subtitles with smaller secondary/phonetic text), and accepted stacked lines with horizontal overlap or shared alignment.
2. **`content/locking/LockMonitor.ts`:**
   - In `resolveStableContainer`: updated the wrapper slack check with `hasTighterTextChild`. An element with slack is only rejected if a single child already contains *all* of its text. If it contains multiple sibling lines, it is preserved as the multi-line container.
   - Updated width/height checks to evaluate rendered text glyphs (`tb.width <= videoRect.width * 0.95` and `tb.height <= videoRect.height * 0.40`), rejecting true full-frame player chrome while accepting full-width centered caption blocks.
   - In `isLiveCaptionCandidate`: evaluated glyph bounds so full-width centered multi-line containers are not rejected by raw layout box dimensions.
3. **`content/locking/LockController.ts`:**
   - In `lock()`: preserved already-resolved multi-line containers without deconstructing them via `resolveCaptionLineContainer`.
4. **`content/ui/ContentRenderer.ts`:**
   - In `resolveRectTarget()`: returns `container` directly when `isMultiLineSubtitleContainer` is true, avoiding redundant line deconstruction on the render hot path. `measureCaptionBounds(container)` unions all text nodes across all lines into one tight bounding box.
5. **`utils/dom.ts`:**
   - In `generateUniqueSelector()`: expanded preferred subtitle class regex to recognize `lyrics`, `karaoke`, and `dual`, preventing fragile `:nth-child` indexing on multi-line containers.
6. **`content/detection/CandidateScorer.ts`:**
   - Updated `isMultiLineBlock` to accept blocks with transitioning or empty-cue secondary lines without imposing `multiple-children` or `has-subtitle-child` penalties.

## Why this is general

Captions across the web routinely consist of multiple simultaneous lines: karaoke lyrics, stacked dialogue lines, and bilingual/dual subtitles (original + translation). Treating multi-line block containers geometrically—by evaluating rendered text glyphs rather than layout box width—ensures the extension functions universally on any player structure without site-specific rules.

## Invariant

When multiple sibling subtitle lines are visible simultaneously (karaoke lyrics, dual-language subtitles, multi-line dialogue), selection preview, click locking, and visual tracking must union all sibling lines into the unified multi-line caption block rather than isolating a single line.

## Regression test

1. Open `testing/index.html` Test 060 (`Karaoke captions`). Enter selection mode or hover over either line: the dashed preview box must enclose both lines. Click to lock: the blue dashed box must enclose both lines. As active highlighting toggles between lines every 3 seconds, the dashed box must remain stable across both lines.
2. Open `testing/index.html` Test 061 (`Dual subtitles`). Hover over or click either line: the dashed box must enclose both the original language and translation lines as one unified block.
