# 023 — Captions inside Shadow DOM and iframes not selected or tracked

**Status:** Fixed
**Severity:** High
**Category:** Detection & Environment
**Platforms:** All (Shadow DOM players, web components, srcdoc/iframe embedded players)
**Discovered:** In `testing/index.html` Test 050 (Caption inside an open shadow root) and Test 051 (Caption inside an iframe via srcdoc), subtitles could not be selected, locked, or tracked.

## Symptom

1. **Test 050 (Shadow DOM):** Clicking or hovering over the caption mounted inside an open shadow root produced no selection box, no lock box, and no tracking. The caption was completely ignored.
2. **Test 051 (Iframe / srcdoc):** The player inside the `srcdoc` iframe had no active extension overlays and could not be selected or tracked.

## Root cause

1. **Video discovery was restricted to light DOM:**
   Across all modules (`MouseEvents`, `SelectionController`, `LockMonitor`, `dom.ts`, `ContentApp`, etc.), video element discovery used `document.querySelectorAll('video')`. By W3C specification, `document.querySelectorAll` does not penetrate `ShadowRoot`s or same-origin `<iframe>`s. When a player was encapsulated in a Shadow DOM or iframe, the video count was 0, causing `canOwnSelectionFrame()` and pointer guard checks to drop all interactions.

2. **Pointer event drop in `MouseEvents.ts` and `SelectionController.ts`:**
   `isPointerInsideVideo(clientX, clientY)` and `isPointerOverAnyVideo(clientX, clientY)` relied on `getAllVideos(document)`. When hovering inside an iframe, cursor coordinates are inside the iframe's coordinate space, but videos were scanned only from the parent document (returning 0 videos). As a result, every `mousemove`, `click`, and `contextmenu` event inside the iframe was aborted immediately.

3. **Event retargeting across Shadow boundary:**
   When mouse events bubble out of an open shadow root, browsers retarget `e.target` to the shadow host element (`<div>`). Handlers reading `e.target` saw the host instead of the caption element. `e.composedPath()[0]` is required to access the true target inside the shadow root.

4. **Hit-testing light-DOM barrier:**
   `document.elementsFromPoint(x, y)` only inspects the light DOM, stopping at the shadow host. It never returned the subtitle leaf inside the shadow root. Penetration via `shadowRoot.elementsFromPoint(x, y)` was missing.

5. **Rejection by `document.documentElement.contains()`:**
   In DOM standards, `document.documentElement.contains(el)` returns `false` for any node hosted inside a `ShadowRoot` (whose root node is a `ShadowRoot`, not `Document`). This caused `LockController.lock()` to instantly return, `ContentRenderer` to drop the lock box, and `LockedAnchor` to mark the element unhealthy.

6. **Chromium MV3 inline `srcdoc` content script injection limitation:**
   In Chromium MV3, inline `iframe.srcdoc` created dynamically via JavaScript does not reliably receive automatic content script injections despite `all_frames: true` or `matchAboutBlank: true`. Furthermore, pointer events occurring inside an iframe are routed to the iframe's `contentWindow` and `contentDocument`, meaning parent frame listeners never receive mouse events inside the iframe.

7. **Isolated World DOM bridge and iframe lifecycle synchronization:**
   The parent extension content script runs in the extension's Isolated World and has direct synchronous access to `iframe.contentDocument` and `iframe.contentWindow`. However, when an iframe is dynamically created, its initial document is `about:blank`. When `iframe.srcdoc = inner` is subsequently assigned, the browser navigates the iframe to a completely new `Document`. If the extension only attempted attaching once on insertion or checked `readyState === 'loading'`, it missed the subsequent `srcdoc` load or attached to the discarded blank document.

## Fix attempts

### Attempt 1: Light-DOM only checks ❌ Failed
- Prior architecture assumed all video players exist in the document tree. Completely broke on custom elements, Shadow DOM players, and `srcdoc` frames.

### Attempt 2: Universal composed discovery & penetration ✅ Worked for Test 050, partial for 051
1. **Manifest configuration:**
   Added `matchAboutBlank: true` to `entrypoints/content.tsx`, allowing Chrome MV3 to inject SubAny's content script into same-origin `srcdoc` and `about:blank` iframes when statically loaded.
2. **Universal, cached video discovery (`getAllVideos()`):**
   Implemented `getAllVideos(targetDoc)` in `utils/dom.ts` with a 400ms TTL cache (invalidated on DOM mutations via `DomObserver`). Scans the specified document, all open shadow roots (discovered opportunistically via `registerComposedShadowRoots` and bounded discovery), and same-origin iframes.
3. **Composed hit-testing (`getComposedElementsFromPoint`):**
   In `utils/dom.ts`, `getSubtitleElementAtPoint` penetrates open shadow roots using `el.shadowRoot.elementsFromPoint(clientX, clientY)`, allowing Path A and Path B to resolve subtitle elements inside shadow trees.
4. **Event retargeting resolution:**
   In `SelectionController.ts` and `InteractiveTranslationController.ts`, resolved targets using `(e.composedPath?.()[0] as HTMLElement | null) ?? (e.target as HTMLElement | null)`.
5. **Replaced `document.documentElement.contains` with `.isConnected`:**
   Native `Node.isConnected` returns `true` for all connected nodes, including those in open/closed Shadow DOMs. Replaced checks across `LockController`, `ContentRenderer`, `SubtitleLock`, `LockedAnchor`, `AutoDetectController`, and `LockMonitor`.
6. **Shadow-aware selector recovery & mutation monitoring:**
   In `LockMonitor.ts`, `tryResolveFromSelector` falls back to querying the `ShadowRoot` of the video/container, and `startLockedMonitor` attaches `MutationObserver` to the `ShadowRoot` when parent chains end at shadow boundaries.

### Attempt 3: Isolated World Same-Origin Child Runner & Scoped Coordinate Architecture ✅ Fully Fixed Test 051
1. **Same-origin child `ContentApp` runner:**
   In `ContentApp.ts`, when a same-origin `iframe` (such as `srcdoc`) is detected, `topApp` spawns a dedicated child `ContentApp(childDoc, childWin, false)`. The child app mounts its own `#subany-extension-root` directly into the iframe's DOM. This gives the iframe native fixed-position overlay coordinates matching `getBoundingClientRect()`, native event capture, and full extension messaging without any cross-frame coordinate transformations.
2. **Persistent iframe lifecycle and navigation binding:**
   In `syncSameOriginIframes()`:
   - Always listens to `iframe.addEventListener('load', ...)` to re-sync whenever `srcdoc` or iframe navigation completes.
   - Listens to `iframe.addEventListener('pointerenter', ...)` to guarantee child app attachment whenever the user hovers over an iframe.
   - In `DomObserver.ts`, added `attributes: true` with `attributeFilter: ['src', 'srcdoc']` so assigning `iframe.srcdoc = inner` immediately triggers iframe synchronization.
   - On every tick and selection start in top frame, `syncSameOriginIframes()` re-verifies that any active iframe has a healthy child app attached to its current document.
3. **Target document awareness across detection and selection:**
   - In `SelectionController.ts`, `isPointerOverAnyVideo` now accepts `targetDoc: Document = document` and uses the target element's `ownerDocument`.
   - In `AutoDetectScorer.ts`, `collectAutoSubtitleCandidates` now accepts `targetDoc: Document = document` and scans the corresponding document.
   - In `AutoDetectController.ts`, passed `this.doc` to both candidate and native text cue collectors.
   - In `SubtitleDetector.ts`, `DomSubtitleDetector.ts`, `NativeSubtitleDetector.ts`, and `SubtitleHitTester.ts`, all entry points now accept and propagate `targetDoc: Document = document`.

### Attempt 4: Top-Level Tooltip Floating Bridge & State-Isolated Tracking RAF ✅ Fully Fixed Test 051 Polish Issues
1. **Top-Level Tooltip Floating Bridge (Fixing Iframe Tooltip Clipping):**
   - **Problem:** Tooltips rendered inside the child iframe's `#subany-extension-root` were physically confined and clipped by the `iframe` bounding box and CSS `overflow`.
   - **Fix:** In `ContentApp.ts`, when `topApp` spawns `childApp`, it provides a tooltip bridge (`onTooltipChange`). In `childApp`, when a word is hovered, its coordinates are translated to top-frame coordinates (`iframeRect.left + x`, `iframeRect.top + y`) and emitted to `topApp`. For cross-origin iframes, `window.parent.postMessage` is used.
   - In `ContentRenderer.ts`, `delegateTooltip: !this.isTopFrame` suppresses `<Tooltip>` rendering inside child iframes, allowing `topApp` to render `<Tooltip>` in the tab's root DOM with full screen freedom, modern drop-shadows, and zero clipping. The word highlight pill `<SubtitleOverlay>` remains inside the iframe directly overlaying the text.
   - In `MouseEvents.ts`, added `mouseleave` listener on `doc` so exiting an iframe or document immediately clears any pending tooltip and highlight.

2. **Per-Instance Runtime State in `LockMonitor.ts` (Fixing Test 051 Tracking Stall):**
   - **Problem:** Module-global variables (`positionRafId`, `lastPositionKey`, `lastNotifiedText`, `lastScanAt`) collided between `topApp` and `childApp` running in the same Isolated World heap. When `childApp` locked and updated storage, `topApp.handleSettingsChanged()` ran `stopLockedMonitor(topState)`, cancelling `childApp`'s RAF loop. Because `topDoc` had 0 videos, `topApp` exited without restarting RAF. Furthermore, `findFirstVideo` and `getVideoForElement` defaulted to `document` (top document), causing `findObservedVideo` inside iframes to return null and fail to attach `MutationObserver`.
   - **Fix:**
     - Moved runtime state to `ContentState` (`lockedPositionRafId`, `lockedPositionKey`, `lockedLastNotifiedText`, `lockedLastScanAt`).
     - In `LockMonitor.ts`, `findFirstVideo(state)` accepts state and resolves `doc = state?.activeContainerEl?.ownerDocument ?? document`, ensuring videos inside iframes are properly found.
     - In `SubtitleLock.ts`, `findCurrentLockedVideo(state)` passes `doc = state.activeContainerEl?.ownerDocument ?? document` to `getAllVideos(doc)`.
     - In `ContentApp.ts`, guarded `startVideoMonitor` and `startLockedMonitor` calls in `handleSettingsChanged()`, `loadSettings()`, and `syncActiveContainer()` with `if (this.canOwnSelectionFrame())`, preventing frames without a video from interfering with active video child monitors.
     - In `LockMonitor.ts`, `startPositionTracking` uses `currentWin = state.activeContainerEl?.ownerDocument?.defaultView || win` and incorporates `textBounds(el)` (`tbKey`) into the position key so cue text changes within centered wrappers trigger immediate RAF re-renders.
