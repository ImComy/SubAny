/**
 * content.tsx – Main content script with full debug logging
 * Set DEBUG = true at the top to see detailed logs.
 */

import { createRoot, type Root } from 'react-dom/client';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { Tooltip } from '../components/Tooltip';
import { PinSelector } from '../lib/PinSelector';
import { SubtitleManager } from '../lib/SubtitleManager';
import { TextExtractor, type TextExtractionResult } from '../lib/TextExtractor';
import { TranslationManager } from '../lib/TranslationManager';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../lib/types';
import { VideoController } from '../lib/VideoController';

// -----------------------------------------------------------
// 🔥 DEBUG flag – set to true to see detailed logs
// -----------------------------------------------------------
const DEBUG = true;

// -----------------------------------------------------------
// Utility: Debounce
// -----------------------------------------------------------
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// -----------------------------------------------------------
// Helper: Determine if a string looks like actual subtitle text
// -----------------------------------------------------------
function isSubtitleText(text: string): boolean {
  if (text.length < 2) return false;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return false;
  if (/^\d+(\.\d+)?%?$/.test(text)) return false;
  if (/^(Settings|Quality|Speed|Audio|Subtitles|CC|Off|On|Play|Pause|Mute)$/i.test(text)) return false;
  return /[\p{L}\p{N}]/u.test(text);
}

// -----------------------------------------------------------
// Compute DOM depth
// -----------------------------------------------------------
function getDomDepth(el: Node): number {
  let depth = 0;
  let current = el;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

// -----------------------------------------------------------
// Score a candidate element for being a subtitle container
// -----------------------------------------------------------
interface CandidateScore {
  element: HTMLElement;
  score: number;
  reasons: string[];
}

function hasSubtitleClass(el: HTMLElement): boolean {
  const id = el.id || '';
  const cls = (el.className || '').toString();
  return /(subtitle|sub|captions|cc|cue|translation|track|vtt|timed-text|player-caption)/i.test(id + cls);
}

function scoreSubtitleCandidate(el: HTMLElement): CandidateScore | null {
  const text = el.innerText?.trim() || '';
  if (!text || !isSubtitleText(text)) return null;

  let score = 0;
  const reasons: string[] = [];
  const rect = el.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const isCue = hasSubtitleClass(el);
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize);
  const isCentered = style.textAlign === 'center' || style.textAlign === 'start';
  const isAbsPos = style.position === 'absolute' || style.position === 'fixed';
  const bottom = parseFloat(style.bottom);

  // 1. Location
  const yCenter = rect.top + rect.height / 2;
  const yRatio = yCenter / viewportHeight;
  if (yRatio > 0.4) { score += 20; reasons.push('bottom-half'); }
  else if (yRatio > 0.2) { score += 5; reasons.push('middle'); }
  else { score -= 10; reasons.push('top-half'); }

  // 2. Width
  const widthRatio = rect.width / viewportWidth;
  if (widthRatio > 0.2 && widthRatio < 0.9) {
    score += 15;
    reasons.push('good-width');
  } else if (widthRatio >= 0.9) {
    if (!isCentered || fontSize < 20) {
      score -= 20;
      reasons.push('too-wide');
    } else {
      score += 5;
      reasons.push('wide-but-centred');
    }
  } else {
    if (!isCue) {
      const words = text.split(/\s+/).length;
      if (words > 1) score -= 5;
      reasons.push('too-narrow');
    } else {
      score += 5;
      reasons.push('narrow-cue');
    }
  }

  // 3. Word count
  const words = text.split(/\s+/).length;
  if (words >= 3 && words <= 50) { score += 15; reasons.push('text-density'); }
  else if (words > 50) { score -= 15; reasons.push('too-long'); }
  else { score -= 5; reasons.push('too-short'); }

  // 4. DOM depth
  const depth = getDomDepth(el);
  if (depth > 3 && depth < 20) { score += 10; reasons.push('nested'); }
  else if (depth >= 20) { score -= 5; reasons.push('too-deep'); }

  // 5. CSS hints
  if (isCentered) { score += 12; reasons.push('centered'); }
  if (fontSize > 14) { score += 5; reasons.push('font>14'); }
  if (fontSize >= 24) { score += 15; reasons.push('large-font'); }
  if (style.backgroundColor === 'transparent' || style.background === 'none') score += 5;
  if (isAbsPos) { score += 5; reasons.push('abs-pos'); }
  if (!isNaN(bottom) && bottom >= 0) { score += 5; reasons.push('has-bottom'); }

  // 6. Strong cue class bonus – heavily increased
  if (isCue) {
    score += 80;
    reasons.push('cue-class');
  }

  // 7. Parent with absolute/fixed + bottom
  if (el.parentElement) {
    const parentStyle = getComputedStyle(el.parentElement);
    if (parentStyle.position === 'absolute' || parentStyle.position === 'fixed') {
      const pBottom = parseFloat(parentStyle.bottom);
      if (!isNaN(pBottom) && pBottom >= 0) {
        score += 15;
        reasons.push('parent-abs-bottom');
      }
    }
  }

  // 8. Punctuation and capitalisation
  if (/[.!?…]/.test(text)) { score += 5; reasons.push('punctuation'); }
  if (/^[A-ZÀ-Ö]/.test(text)) { score += 3; reasons.push('capitalized'); }

  // 9. Leaf detection
  const childNodes = Array.from(el.childNodes);
  const hasOnlyTextOrBr = childNodes.every(
    (node) => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR')
  );
  if (hasOnlyTextOrBr) {
    score += 50;
    reasons.push('leaf-like');
  } else if (el.children.length === 0) {
    score += 50;
    reasons.push('leaf-element');
  }

  // 10. Penalty for having multiple element children
  if (el.children.length > 1 && !hasOnlyTextOrBr) {
    score -= 25;
    reasons.push('multiple-children');
  } else if (el.children.length > 0 && !hasOnlyTextOrBr) {
    score -= 15;
    reasons.push('has-children');
  }

  // 11. Penalty for pointer-events: none
  if (style.pointerEvents === 'none') {
    score -= 50;
    reasons.push('pointer-events-none');
  }

  // 12. Penalty for being too large
  if (rect.width > viewportWidth * 0.7) {
    score -= 40;
    reasons.push('too-wide-container');
  }
  if (rect.height > viewportHeight * 0.2) {
    score -= 30;
    reasons.push('too-tall-container');
  }

  // 13. Penalty if element has any child that is also a subtitle candidate
  const hasSubtitleChild = Array.from(el.children).some((child) => {
    const childText = (child as HTMLElement).innerText?.trim() || '';
    return isSubtitleText(childText) && hasSubtitleClass(child as HTMLElement);
  });
  if (hasSubtitleChild) {
    score -= 40;
    reasons.push('has-subtitle-child');
  }

  if (DEBUG) {
    console.log(`[Subany] Score for`, el, ` => ${score} (${reasons.join(', ')})`);
  }

  return { element: el, score, reasons };
}

// -----------------------------------------------------------
// Traverse DOM, Shadow DOM, and iframes
// -----------------------------------------------------------
function getAllElements(root: Node | ShadowRoot): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const el = node as HTMLElement;
        elements.push(el);
        if (el.shadowRoot) {
          elements.push(...getAllElements(el.shadowRoot));
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  while (walker.nextNode()) { }

  if (root === document) {
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          elements.push(...getAllElements(doc));
        }
      } catch (_) { /* cross-origin – skip */ }
    }
  }
  return elements;
}

// -----------------------------------------------------------
// Drill down to the deepest text container (leaf)
// -----------------------------------------------------------
function getDeepestTextContainer(el: HTMLElement): HTMLElement {
  let current = el;
  let depth = 0;
  while (true) {
    const children = current.children;
    if (children.length === 0) break;

    if (children.length === 1) {
      const child = children[0] as HTMLElement;
      if (child.innerText?.trim() === current.innerText?.trim()) {
        if (child.children.length === 0) {
          current = child;
          break;
        }
        current = child;
        depth++;
        continue;
      }
    }
    break;
  }
  if (DEBUG) console.log(`[Subany] getDeepestTextContainer from`, el, `=>`, current);
  return current;
}

// -----------------------------------------------------------
// Find best subtitle container (heuristic fallback)
// -----------------------------------------------------------
// -----------------------------------------------------------
// Treat visually stacked subtitle nodes as ONE subtitle
// -----------------------------------------------------------
//
// A surprisingly common player trick is:
//
//   <div class="subtitle-line">first line</div>
//   <div class="subtitle-line">second line</div>
//
// The two nodes are siblings, but visually they are one cue. Selecting only
// the line under the mouse makes the extension appear to randomly lose half
// of the subtitle. We therefore build a logical subtitle group from nearby
// subtitle-like nodes and return their lowest common ancestor when that
// ancestor contains exactly the grouped text.
//
// This remains DOM-only, so it works for pointer-events:none subtitles too.

function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLowestCommonHTMLElement(elements: HTMLElement[]): HTMLElement | null {
  if (elements.length === 0) return null;
  const first = elements[0]!; // non-null assertion, safe after length check
  if (elements.length === 1) return first;

  const firstAncestors: HTMLElement[] = [];
  let current: HTMLElement | null = first;
  while (current) {
    firstAncestors.push(current);
    current = current.parentElement;
  }

  for (const ancestor of firstAncestors) {
    if (elements.every((el) => ancestor === el || ancestor.contains(el))) {
      return ancestor;
    }
  }

  return null;
}

function isUsableSubtitleLine(el: HTMLElement, videoRect: DOMRect | null): boolean {
  if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;

  const tag = el.tagName.toLowerCase();
  if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) {
    return false;
  }

  if (el.querySelector('video, canvas') !== null) return false;
  if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) return false;
  if (el.closest('.control, .controls, .progress, .volume, .player-controls')) return false;

  const text = normalizeSubtitleText(el.innerText || '');
  if (!text || !isSubtitleText(text)) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  if (videoRect) {
    if (rect.width >= videoRect.width * 0.96) return false;
    if (rect.height >= videoRect.height * 0.25) return false;

    // Subtitle lines should normally be inside the video. A small tolerance
    // handles players that place captions just outside its exact box.
    if (
      rect.right < videoRect.left - 24 ||
      rect.left > videoRect.right + 24 ||
      rect.bottom < videoRect.top - 24 ||
      rect.top > videoRect.bottom + 24
    ) {
      return false;
    }
  }

  return true;
}

function canBelongToSubtitleGroup(
  anchor: HTMLElement,
  candidate: HTMLElement,
  videoRect: DOMRect | null,
): boolean {
  if (candidate === anchor) return false;

  // Ignore formatting wrappers inside the same line. We only want genuinely
  // distinct visual subtitle components (usually siblings or cousins).
  if (anchor.contains(candidate) || candidate.contains(anchor)) return false;
  if (!isUsableSubtitleLine(candidate, videoRect)) return false;

  const a = anchor.getBoundingClientRect();
  const b = candidate.getBoundingClientRect();

  // Compare the visual centres rather than relying on DOM order. This works
  // with flex, transforms, RTL text, and absolutely positioned lines.
  const aCenterY = a.top + a.height / 2;
  const bCenterY = b.top + b.height / 2;
  const verticalGap = Math.max(0, Math.abs(aCenterY - bCenterY) - (a.height + b.height) / 2);

  // Allow roughly one line of separation, with a minimum tolerance for tiny
  // fonts and transformed player overlays.
  const maxVerticalGap = Math.max(18, Math.max(a.height, b.height) * 1.35);
  if (verticalGap > maxVerticalGap) return false;

  const horizontalGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  const maxHorizontalGap = Math.max(80, Math.min(a.width, b.width) * 0.45);
  if (horizontalGap > maxHorizontalGap) return false;

  // They should actually live in approximately the same horizontal caption
  // band. This rejects nearby UI labels sitting beside the subtitle.
  const centreXDistance = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
  const maxCentreXDistance = Math.max(180, Math.max(a.width, b.width) * 0.8);
  if (centreXDistance > maxCentreXDistance) return false;

  const aStyle = getComputedStyle(anchor);
  const bStyle = getComputedStyle(candidate);
  const aFont = parseFloat(aStyle.fontSize);
  const bFont = parseFloat(bStyle.fontSize);

  if (Number.isFinite(aFont) && Number.isFinite(bFont)) {
    const fontRatio = Math.max(aFont, bFont) / Math.max(1, Math.min(aFont, bFont));
    if (fontRatio > 1.7) return false;
  }

  // Matching centred text is a very strong signal for two stacked subtitle
  // lines, but do not require it because many players use left-aligned spans.
  if (aStyle.textAlign === bStyle.textAlign && aStyle.textAlign === 'center') {
    return true;
  }

  // Otherwise require some horizontal overlap. This prevents UI text that is
  // merely above/below the caption from getting grouped with it.
  const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return horizontalOverlap >= Math.min(a.width, b.width) * 0.18;
}

function combineSubtitleLines(anchor: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  if (!isUsableSubtitleLine(anchor, videoRect)) return anchor;

  const allElements = getAllElements(document);
  const related: HTMLElement[] = [anchor];

  // First pass: collect nearby subtitle-like elements. We intentionally do not
  // require matching classes because some players give each line different
  // generated class names.
  for (const candidate of allElements) {
    if (related.length >= 8) break;
    if (canBelongToSubtitleGroup(anchor, candidate, videoRect)) {
      related.push(candidate);
    }
  }

  if (related.length < 2) return anchor;

  // Sort in visual order, not DOM order. This matters for transformed and RTL
  // players and makes the text comparison stable.
  related.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (Math.abs(ar.top - br.top) > 4) return ar.top - br.top;
    return ar.left - br.left;
  });

  // Keep only a tight vertical cluster around the anchor. This is the key
  // safeguard against accidentally grouping a nearby second subtitle cue.
  const anchorRect = anchor.getBoundingClientRect();
  const minTop = Math.min(...related.map((el) => el.getBoundingClientRect().top));
  const maxBottom = Math.max(...related.map((el) => el.getBoundingClientRect().bottom));
  const clusterHeight = maxBottom - minTop;
  const maxClusterHeight = videoRect
    ? Math.max(180, videoRect.height * 0.22)
    : Math.max(180, window.innerHeight * 0.22);

  if (clusterHeight > maxClusterHeight) {
    const nearby = related.filter((el) => {
      const r = el.getBoundingClientRect();
      const centerDistance = Math.abs((r.top + r.height / 2) - (anchorRect.top + anchorRect.height / 2));
      return centerDistance <= Math.max(110, anchorRect.height * 4);
    });
    related.length = 0;
    related.push(...nearby);
  }

  if (related.length < 2) return anchor;

  const group = getLowestCommonHTMLElement(related);
  if (!group || group === anchor) return anchor;

  const expectedText = normalizeSubtitleText(related.map((el) => el.innerText || '').join(' '));
  const actualText = normalizeSubtitleText(group.innerText || '');

  // Critical guard: the common ancestor must contain ONLY the grouped subtitle
  // text. If it also contains controls, usernames, scoreboards, etc., reject it.
  if (!expectedText || actualText !== expectedText) return anchor;
  if (!isSubtitleText(actualText)) return anchor;

  const groupRect = group.getBoundingClientRect();
  if (groupRect.width <= 0 || groupRect.height <= 0) return anchor;
  if (videoRect) {
    if (groupRect.width > videoRect.width * 0.94) return anchor;
    if (groupRect.height > videoRect.height * 0.30) return anchor;
  } else if (groupRect.height > window.innerHeight * 0.30) {
    return anchor;
  }

  if (DEBUG) {
    console.log('[Subany] 🧩 Grouped stacked subtitle lines:', related, '=>', group);
  }

  return group;
}

function findBestSubtitleContainer(): HTMLElement | null {
  const allElements = getAllElements(document);
  let best: CandidateScore | null = null;

  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (el.id === 'subany-extension-root') continue;
    const scored = scoreSubtitleCandidate(el);
    if (scored && (!best || scored.score > best.score)) {
      best = scored;
    }
  }

  if (best && best.score > 5) {
    const deepest = getDeepestTextContainer(best.element);
    const grouped = combineSubtitleLines(deepest, null);
    console.log('[Subany] 🏆 Best container:', grouped, 'score:', best.score, 'reasons:', best.reasons);
    return grouped;
  }

  const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
  if (live && isSubtitleText(live.textContent?.trim() || '')) {
    const liveEl = getDeepestTextContainer(live as HTMLElement);
    return combineSubtitleLines(liveEl, null);
  }
  return null;
}

// -----------------------------------------------------------
// Find genuine subtitle element under a point
// -----------------------------------------------------------

// Same DOM, different hit-testing path.
//
// elementsFromPoint() only returns elements that participate in pointer
// hit-testing. A subtitle can be a perfectly normal DOM element and still
// be omitted because its player sets pointer-events:none. Scan DOM geometry
// as a fallback so the selector can still "see" it.
function findSubtitleByGeometry(clientX: number, clientY: number): HTMLElement | null {
  const allElements = getAllElements(document);
  let best: CandidateScore | null = null;

  for (const el of allElements) {
    if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    // Ignore gigantic page/player containers. We are looking for a text
    // element that actually occupies the cursor's neighborhood.
    if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.65) continue;

    if (!(
      clientX >= rect.left - 12 &&
      clientX <= rect.right + 12 &&
      clientY >= rect.top - 12 &&
      clientY <= rect.bottom + 12
    )) {
      continue;
    }

    const scored = scoreSubtitleCandidate(el);
    if (!scored) continue;

    // A geometry hit gets a bonus because this function is only called after
    // the normal pointer stack failed. This lets pointer-events:none subtitles
    // win without changing the normal candidate ranking.
    scored.score += 35;
    scored.reasons.push('geometry-hit');

    if (!best || scored.score > best.score) {
      best = scored;
    }
  }

  if (best && best.score > 15) {
    const leaf = getDeepestTextContainer(best.element);
    const containingVideo = Array.from(document.querySelectorAll('video')).map((v) => v as HTMLVideoElement).find((v) => {
      const r = v.getBoundingClientRect();
      const er = leaf.getBoundingClientRect();
      return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
    });
    const grouped = combineSubtitleLines(leaf, containingVideo?.getBoundingClientRect() ?? null);
    if (DEBUG) {
      console.log(
        '[Subany] 🧭 Geometry fallback found subtitle:',
        grouped,
        'score:',
        best.score,
        'reasons:',
        best.reasons,
      );
    }
    return grouped;
  }

  return null;
}

function findGenuineSubtitleCandidate(clientX: number, clientY: number): HTMLElement | null {
  if (DEBUG) console.log(`[Subany] 🔍 Looking at point (${clientX}, ${clientY})`);

  const stack = (document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : []) as HTMLElement[];
  if (DEBUG) console.log(`[Subany] elementsFromPoint stack size: ${stack.length}`);

  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  const nearestVideo = videos[0] ?? null;
  const vRect = nearestVideo ? nearestVideo.getBoundingClientRect() : null;

  // Filter out invalid elements:
  const validStack = stack.filter((el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;

    const tag = el.tagName.toLowerCase();
    if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) {
      return false;
    }
    if (el.querySelector('video') !== null) return false;
    if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) return false;
    if (el.closest('.control, .controls, .progress, .volume, .player-controls')) return false;

    const text = el.innerText?.trim() ?? '';
    if (!text || !isSubtitleText(text)) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    if (vRect) {
      if (rect.width >= vRect.width * 0.96 && rect.height >= vRect.height * 0.45) return false;
      if (rect.height > vRect.height * 0.45) return false;
    } else {
      if (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.45) return false;
    }

    return true;
  });

  if (DEBUG) console.log(`[Subany] validStack after filtering:`, validStack.map(el => el.className || el.tagName));

  // IMPORTANT: elementsFromPoint() misses pointer-events:none subtitles.
  // Search the actual DOM rectangles before falling back to video/text-track
  // detection.
  if (validStack.length === 0) {
    const geometryCandidate = findSubtitleByGeometry(clientX, clientY);
    if (geometryCandidate) return geometryCandidate;
    if (nearestVideo && vRect) {
      const inSubtitleZone =
        clientX >= vRect.left &&
        clientX <= vRect.right &&
        clientY >= vRect.top + vRect.height * 0.55 &&
        clientY <= vRect.bottom;
      if (inSubtitleZone && nearestVideo.parentElement) {
        const playerChildren = Array.from(nearestVideo.parentElement.querySelectorAll('*')) as HTMLElement[];
        for (const child of playerChildren) {
          if (['video', 'audio', 'button', 'svg', 'input'].includes(child.tagName.toLowerCase())) continue;
          if (child.querySelector('video') !== null) continue;
          if (child.closest('button, [role="button"], [role="slider"], input')) continue;
          const text = child.innerText?.trim() ?? '';
          if (!text || !isSubtitleText(text)) continue;

          const r = child.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height <= vRect.height * 0.4) {
            if (
              clientX >= r.left - 40 &&
              clientX <= r.right + 40 &&
              clientY >= r.top - 40 &&
              clientY <= r.bottom + 40
            ) {
              const leaf = getDeepestTextContainer(child);
              if (DEBUG) console.log(`[Subany] 🔥 Found nearby subtitle leaf:`, leaf);
              return leaf;
            }
          }
        }
      }
    }
    return null;
  }

  // Score valid candidates
  let best: CandidateScore | null = null;
  for (const el of validStack) {
    const scored = scoreSubtitleCandidate(el);
    if (scored && (!best || scored.score > best.score)) {
      best = scored;
    }
  }

  if (best) {
    const leaf = getDeepestTextContainer(best.element);
    const grouped = combineSubtitleLines(leaf, vRect);
    if (DEBUG) console.log(`[Subany] 🏆 Best candidate:`, grouped, 'score:', best.score, 'reasons:', best.reasons);
    if (DEBUG) console.log(`[Subany]   → Returning logical subtitle group:`, grouped);
    return grouped;
  }

  if (validStack[0]) {
    const leaf = getDeepestTextContainer(validStack[0]);
    if (DEBUG) console.log(`[Subany] ⚠️ No scored candidate, fallback to first valid:`, leaf);
    return leaf;
  }

  return null;
}

function findSubtitleElementUnderPoint(clientX: number, clientY: number): HTMLElement | null {
  return findGenuineSubtitleCandidate(clientX, clientY);
}


// -----------------------------------------------------------
// Native video subtitle fallback
//
// Some players render subtitles outside the DOM entirely:
//   - <canvas>
//   - WebGL/video overlays
//   - the browser's native subtitle renderer
//   - DOM layers with pointer-events:none
//
// In those cases elementsFromPoint() cannot find the visible
// subtitle. When the video exposes native TextTracks, the text
// is still available through the active cue even though there
// is no selectable DOM node.
// -----------------------------------------------------------
interface NativeSubtitleHit {
  text: string;
  rect: DOMRect;
  video: HTMLVideoElement;
}

const preparedNativeTracks = new WeakSet<TextTrack>();

function prepareNativeTextTrack(track: TextTrack): void {
  if (preparedNativeTracks.has(track)) return;
  preparedNativeTracks.add(track);

  // A disabled track often has no populated activeCues. Hidden keeps
  // the track from being rendered by the browser while allowing cue
  // data to become available to the extension.
  try {
    if (track.mode === 'disabled') {
      track.mode = 'hidden';
    }
  } catch (_) {
    // Some players expose read-only or unusual TextTrack objects.
  }
}

function cueToPlainText(cue: TextTrackCue): string {
  const raw =
    typeof (cue as VTTCue).text === 'string'
      ? (cue as VTTCue).text
      : '';

  if (!raw) return '';

  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return (doc.body.textContent || raw)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVideoSubtitleRect(video: HTMLVideoElement, cue: TextTrackCue): DOMRect {
  const videoRect = video.getBoundingClientRect();
  let centerY = videoRect.top + videoRect.height * 0.82;

  const line = Number((cue as VTTCue).line);
  if (Number.isFinite(line)) {
    if ((cue as VTTCue).snapToLines === false) {
      const fraction = Math.max(0, Math.min(100, line)) / 100;
      centerY = videoRect.top + videoRect.height * fraction;
    } else {
      const lineHeight = Math.max(22, videoRect.height * 0.045);
      if (line >= 0) {
        centerY = videoRect.top + Math.min(videoRect.height - lineHeight, line * lineHeight);
      } else {
        centerY = videoRect.bottom + line * lineHeight - lineHeight / 2;
      }
    }
  }

  const cueWidth = Math.min(videoRect.width * 0.86, Math.max(260, videoRect.width * 0.72));
  const cueHeight = Math.min(140, Math.max(44, videoRect.height * 0.16));
  const left = videoRect.left + (videoRect.width - cueWidth) / 2;
  const top = Math.max(
    videoRect.top,
    Math.min(videoRect.bottom - cueHeight, centerY - cueHeight / 2),
  );

  return new DOMRect(left, top, cueWidth, cueHeight);
}

function isPointInRectWithPadding(x: number, y: number, rect: DOMRect, padding = 28): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  );
}

function findNativeSubtitleAtPoint(clientX: number, clientY: number): NativeSubtitleHit | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];

  for (const video of videos) {
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) continue;

    if (
      clientX < videoRect.left ||
      clientX > videoRect.right ||
      clientY < videoRect.top ||
      clientY > videoRect.bottom
    ) {
      continue;
    }

    const cueHits: Array<{ cue: TextTrackCue; text: string; rect: DOMRect; track: TextTrack }> = [];

    for (const track of Array.from(video.textTracks)) {
      const kind = (track.kind || '').toLowerCase();
      if (kind !== 'subtitles' && kind !== 'captions') continue;

      prepareNativeTextTrack(track);
      const cues = track.activeCues;
      if (!cues || cues.length === 0) continue;

      for (const cue of Array.from(cues)) {
        const text = cueToPlainText(cue);
        if (!isSubtitleText(text)) continue;
        cueHits.push({ cue, text, rect: getVideoSubtitleRect(video, cue), track });
      }
    }

    if (cueHits.length === 0) continue;

    const underPoint = cueHits
      .filter((hit) => isPointInRectWithPadding(clientX, clientY, hit.rect, 36))
      .sort((a, b) => {
        const ar = a.rect;
        const br = b.rect;
        const adx = clientX - (ar.left + ar.width / 2);
        const ady = clientY - (ar.top + ar.height / 2);
        const bdx = clientX - (br.left + br.width / 2);
        const bdy = clientY - (br.top + br.height / 2);
        return (adx * adx + ady * ady) - (bdx * bdx + bdy * bdy);
      })[0];

    if (!underPoint) continue;

    // Group only cues from the same track. That avoids accidentally joining
    // two different subtitle languages that happen to be active at once.
    const related = cueHits.filter((hit) => {
      if (hit.track !== underPoint.track) return false;
      if (hit === underPoint) return true;

      const a = underPoint.rect;
      const b = hit.rect;
      const verticalGap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const closeEnough = verticalGap <= Math.max(20, Math.min(a.height, b.height) * 1.5);
      const horizontallyAligned = horizontalOverlap >= Math.min(a.width, b.width) * 0.15;
      return closeEnough && horizontallyAligned;
    });

    if (related.length === 1) {
      return { text: underPoint.text, rect: underPoint.rect, video };
    }

    related.sort((a, b) => a.rect.top - b.rect.top);
    const left = Math.min(...related.map((hit) => hit.rect.left));
    const top = Math.min(...related.map((hit) => hit.rect.top));
    const right = Math.max(...related.map((hit) => hit.rect.right));
    const bottom = Math.max(...related.map((hit) => hit.rect.bottom));

    const text = normalizeSubtitleText(related.map((hit) => hit.text).join(' '));
    const rect = new DOMRect(left, top, right - left, bottom - top);

    if (DEBUG) {
      console.log('[Subany] 🧩 Grouped native subtitle cues:', related.map((hit) => hit.text));
    }

    return { text, rect, video };
  }

  return null;
}

// Last-resort geometric fallback.
//
// This identifies the conventional subtitle band on a video.
// It deliberately does NOT invent text for burned-in/canvas
// subtitles because there is no reliable text source in that case.
// DOM text or native TextTrack data is still required to translate.
function isLikelySubtitleZone(clientX: number, clientY: number): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const xInside = clientX >= rect.left && clientX <= rect.right;
    const yRatio = (clientY - rect.top) / rect.height;

    if (xInside && yRatio >= 0.62 && yRatio <= 0.97) {
      return video;
    }
  }

  return null;
}

// -----------------------------------------------------------
// In-Place DOM text swapper
// -----------------------------------------------------------
class DomTextSwapper {
  private saved = new Map<Text, string>();

  swapText(container: HTMLElement, newText: string) {
    this.restore();
    const textNodes = this.collectTextNodes(container);
    if (textNodes.length === 0) return;
    const parts = this.splitAcrossNodes(textNodes, newText);
    textNodes.forEach((node, i) => {
      this.saved.set(node, node.textContent ?? '');
      node.textContent = parts[i] ?? '';
    });
  }

  restore() {
    this.saved.forEach((original, node) => {
      if (node.parentNode) {
        node.textContent = original;
      }
    });
    this.saved.clear();
  }

  hasSwapped(): boolean {
    return this.saved.size > 0;
  }

  private collectTextNodes(el: HTMLElement): Text[] {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node as Text).textContent?.trim() ?? '';
      if (text.length > 0) nodes.push(node as Text);
    }
    return nodes;
  }

  private splitAcrossNodes(nodes: Text[], translation: string): string[] {
    if (nodes.length === 1) return [translation];
    const originals = nodes.map((n) => n.textContent?.trim() ?? '');
    const totalOrig = originals.reduce((a, b) => a + b.length, 0) || 1;
    const words = translation.split(/\s+/);
    const totalWords = words.length;
    const result: string[] = [];
    let wordIdx = 0;
    for (let i = 0; i < nodes.length; i++) {
      const ratio = (originals[i] ?? '').length / totalOrig;
      const share = i === nodes.length - 1
        ? words.slice(wordIdx).join(' ')
        : words.slice(wordIdx, wordIdx + Math.max(1, Math.round(ratio * totalWords))).join(' ');
      wordIdx += share.split(/\s+/).length;
      result.push(share);
    }
    return result;
  }
}

// -----------------------------------------------------------
// Main content script
// -----------------------------------------------------------
export default defineContentScript({
  matches: ['<all_urls>', 'https://player.videasy.to/*', 'https://player.videasy.net/*'],
  allFrames: true,
  main() {
    console.log('[Subany] Content script loaded in:', window.location.href);

    let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };

    const subtitleManager = new SubtitleManager();
    const translationManager = new TranslationManager();
    const videoController = new VideoController();
    const domSwapper = new DomTextSwapper();

    const hostElement = document.createElement('div');
    hostElement.id = 'subany-extension-root';
    const shadowRoot = hostElement.attachShadow({ mode: 'open' });
    document.body.appendChild(hostElement);
    const reactRoot: Root = createRoot(shadowRoot);

    let activeContainerEl: HTMLElement | null = null;
    let glowTargetEl: HTMLElement | null = null;
    let isSelecting = false;
    let selectionCandidateEl: HTMLElement | null = null;
    let pinSelectorInstance: PinSelector | null = null;

    let hoveredWordRect: DOMRect | null = null;
    let highlightMode: 'word' | 'phrase' | 'range' = 'word';
    let isTranslating = false;

    let rangeAnchorX: number | null = null;
    let rangeAnchorY: number | null = null;

    let tooltipState: {
      x: number;
      y: number;
      originalText: string;
      translatedText: string;
      engineUsed?: string;
      mode: 'word' | 'phrase' | 'range';
    } | null = null;

    let bilingualSubtitleText = '';
    let lastObservedSubtitleText = '';

    const render = () => {
      const isFullAuto = settings.triggerMode === 'full-auto';
      reactRoot.render(
        <>
          <SubtitleOverlay
            glowTarget={settings.enableGlowEffect ? glowTargetEl : null}
            lockedElement={activeContainerEl}
            selectionCandidate={selectionCandidateEl}
            isSelecting={isSelecting}
            hoveredWordRect={hoveredWordRect}
            highlightMode={highlightMode}
            isLoading={isTranslating}
            bilingualText={isFullAuto ? bilingualSubtitleText : undefined}
            targetLang={settings.targetLanguage}
            onUnlock={() => void unlockContainer()}
          />
          {tooltipState && (
            <Tooltip
              x={tooltipState.x}
              y={tooltipState.y}
              originalText={tooltipState.originalText}
              translatedText={tooltipState.translatedText}
              engineUsed={tooltipState.engineUsed}
              mode={tooltipState.mode}
              isLoading={isTranslating}
              targetLang={settings.targetLanguage}
            />
          )}
        </>,
      );
    };

    const triggerGlow = (el: HTMLElement) => {
      if (!settings.enableGlowEffect) return;
      glowTargetEl = el;
      render();
      setTimeout(() => {
        if (glowTargetEl === el) { glowTargetEl = null; render(); }
      }, 1600);
    };

    subtitleManager.setGlowCallback(triggerGlow);

    const loadSettings = async () => {
      try {
        const stored = await browser.storage.local.get('subanySettings');
        if (stored?.subanySettings) {
          settings = { ...DEFAULT_SETTINGS, ...(stored.subanySettings as Partial<ExtensionSettings>) };
          if (settings.lockedSelector) subtitleManager.setLockedSelector(settings.lockedSelector);
        }
      } catch { /* use defaults */ }
      render();
      syncActiveContainer();
    };

    const reattachLockedContainer = (): HTMLElement | null => {
      if (!settings.lockedSelector) {
        const platformEl = subtitleManager.detectPlatformContainer();
        if (platformEl && document.body.contains(platformEl)) {
          const videoForElement = Array.from(document.querySelectorAll('video')).map((v) => v as HTMLVideoElement).find((v) => {
            const r = v.getBoundingClientRect();
            const er = platformEl.getBoundingClientRect();
            return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
          });
          const grouped = combineSubtitleLines(platformEl, videoForElement?.getBoundingClientRect() ?? null);
          if (activeContainerEl !== grouped) {
            activeContainerEl = grouped;
            render();
          }
          return grouped;
        }
        return activeContainerEl;
      }

      try {
        const el = document.querySelector(settings.lockedSelector) as HTMLElement;
        if (el && document.body.contains(el)) {
          const videoForElement = Array.from(document.querySelectorAll('video')).map((v) => v as HTMLVideoElement).find((v) => {
            const r = v.getBoundingClientRect();
            const er = el.getBoundingClientRect();
            return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
          });
          const grouped = combineSubtitleLines(el, videoForElement?.getBoundingClientRect() ?? null);
          if (activeContainerEl !== grouped) {
            activeContainerEl = grouped;
            render();
          }
          return grouped;
        }
      } catch (_) { /* ignore */ }

      const platformEl = subtitleManager.detectPlatformContainer();
      if (platformEl && document.body.contains(platformEl)) {
        const videoForElement = Array.from(document.querySelectorAll('video')).map((v) => v as HTMLVideoElement).find((v) => {
          const r = v.getBoundingClientRect();
          const er = platformEl.getBoundingClientRect();
          return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
        });
        const grouped = combineSubtitleLines(platformEl, videoForElement?.getBoundingClientRect() ?? null);
        if (activeContainerEl !== grouped) {
          activeContainerEl = grouped;
          render();
        }
        return grouped;
      }

      return null;
    };

    const lockContainer = async (element: HTMLElement, isAuto = false) => {
      console.log('[Subany] 🔒 Locking container from element:', element);
      const optimized = subtitleManager.findOptimalSubtitleContainer(element);
      const videoForPoint = Array.from(document.querySelectorAll('video')).map((v) => v as HTMLVideoElement).find((v) => {
        const r = v.getBoundingClientRect();
        const er = element.getBoundingClientRect();
        return er.left <= r.right && er.right >= r.left && er.top <= r.bottom && er.bottom >= r.top;
      });
      const container = combineSubtitleLines(optimized, videoForPoint?.getBoundingClientRect() ?? null);
      console.log('[Subany]   → Optimised/grouped container:', container);
      const selector = subtitleManager.generateUniqueSelector(container);
      activeContainerEl = container;
      settings.lockedSelector = selector;
      subtitleManager.setLockedSelector(selector);
      await browser.storage.local.set({ subanySettings: settings });
      triggerGlow(container);
      setupVideoTimeTracking();
      render();
    };

    const unlockContainer = async () => {
      domSwapper.restore();
      activeContainerEl = null;
      settings.lockedSelector = null;
      subtitleManager.setLockedSelector(null);
      bilingualSubtitleText = '';
      lastObservedSubtitleText = '';
      if (videoTimeUpdateHandler) {
        document.removeEventListener('timeupdate', videoTimeUpdateHandler);
        videoTimeUpdateHandler = null;
      }
      await browser.storage.local.set({ subanySettings: settings });
      render();
    };

    const syncActiveContainer = () => {
      const reattached = reattachLockedContainer();
      if (reattached) {
        if (!glowTargetEl) triggerGlow(reattached);
        return;
      }

      if (settings.lockedSelector) {
        return;
      }

      const platformEl = subtitleManager.detectPlatformContainer();
      if (platformEl) {
        void lockContainer(platformEl, true);
        return;
      }

      const heuristicEl = subtitleManager.detectSmartHeuristicContainer() || findBestSubtitleContainer();
      if (heuristicEl) {
        void lockContainer(heuristicEl, true);
      }
    };

    const handleSubtitleTextChange = async (text: string) => {
      const isReplaceNative = settings.replaceNativeSubtitles || settings.triggerMode === 'replace-native';
      const isFullAuto = settings.triggerMode === 'full-auto' && !isReplaceNative;
      if (!isReplaceNative && !isFullAuto) return;
      if (!text || text === lastObservedSubtitleText) return;
      lastObservedSubtitleText = text;

      const res = await translationManager.translate(
        text,
        settings.targetLanguage,
        settings.sourceLanguage,
        settings.engine,
      );

      if (!res.translation) return;

      if (isReplaceNative && activeContainerEl) {
        domSwapper.swapText(activeContainerEl, res.translation);
      } else if (isFullAuto) {
        bilingualSubtitleText = res.translation;
      }
      render();
    };

    const onDomChange = debounce(() => {
      const reattached = reattachLockedContainer();
      if (reattached) {
        activeContainerEl = reattached;
      } else if (!settings.lockedSelector) {
        const platformEl = subtitleManager.detectPlatformContainer();
        if (platformEl) {
          void lockContainer(platformEl, true);
          return;
        }
      }

      const currentText = activeContainerEl?.innerText?.trim() || '';
      if (!currentText) {
        if (domSwapper.hasSwapped()) domSwapper.restore();
        bilingualSubtitleText = '';
        lastObservedSubtitleText = '';
        render();
        return;
      }

      if (currentText !== lastObservedSubtitleText) {
        void handleSubtitleTextChange(currentText);
      }
    }, 350);

    const subtitleObserver = new MutationObserver(onDomChange);
    subtitleObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    let videoTimeUpdateHandler: ((e: Event) => void) | null = null;

    const setupVideoTimeTracking = () => {
      const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      if (videos.length === 0) return;

      if (videoTimeUpdateHandler) {
        for (const v of videos) {
          v.removeEventListener('timeupdate', videoTimeUpdateHandler);
          v.removeEventListener('seeked', videoTimeUpdateHandler);
          v.removeEventListener('playing', videoTimeUpdateHandler);
          v.removeEventListener('play', videoTimeUpdateHandler);
        }
        videoTimeUpdateHandler = null;
      }

      videoTimeUpdateHandler = () => {
        const reattached = reattachLockedContainer();
        if (!reattached && !settings.lockedSelector) {
          const platformEl = subtitleManager.detectPlatformContainer();
          if (platformEl) {
            void lockContainer(platformEl, true);
            return;
          }
        }

        if (!activeContainerEl) return;

        const currentText = activeContainerEl.innerText?.trim() || '';
        if (!currentText) {
          if (bilingualSubtitleText || domSwapper.hasSwapped()) {
            domSwapper.restore();
            bilingualSubtitleText = '';
            lastObservedSubtitleText = '';
            render();
          }
          return;
        }

        if (currentText !== lastObservedSubtitleText) {
          void handleSubtitleTextChange(currentText);
        }
      };

      for (const v of videos) {
        v.addEventListener('timeupdate', videoTimeUpdateHandler);
        v.addEventListener('seeked', videoTimeUpdateHandler);
        v.addEventListener('playing', videoTimeUpdateHandler);
        v.addEventListener('play', videoTimeUpdateHandler);
      }
    };

    const startSelectionFlow = () => {
      if (settings.selectionMode === 'pin-drag') {
        if (pinSelectorInstance) pinSelectorInstance.stop();
        pinSelectorInstance = new PinSelector({
          onHoverCandidate: (_el, pt) => {
            const hit = getUniversalSubtitleHit(pt.x, pt.y);
            selectionCandidateEl = hit.element;
            virtualSelectionHit = hit.native;
            hoveredWordRect = hit.native?.rect ?? null;
            render();
          },
          onSelect: (el) => {
            selectionCandidateEl = null;
            const chosen = findGenuineSubtitleCandidate(el.getBoundingClientRect().left + 10, el.getBoundingClientRect().top + 10) || el;
            void lockContainer(chosen);
          },
          onCancel: () => { selectionCandidateEl = null; virtualSelectionHit = null; hoveredWordRect = null; render(); },
        });
        pinSelectorInstance.start();
      } else {
        isSelecting = true;
        selectionCandidateEl = null;
        render();
      }
    };

    let virtualSelectionHit: NativeSubtitleHit | null = null;

    const onSelectionMouseMove = (e: MouseEvent) => {
      if (!isSelecting) return;

      const hit = getUniversalSubtitleHit(e.clientX, e.clientY);
      selectionCandidateEl = hit.element;
      virtualSelectionHit = hit.native;

      // A virtual/native subtitle cannot be represented by an HTMLElement,
      // but SubtitleOverlay can still use the native cue's rectangle.
      if (!selectionCandidateEl && virtualSelectionHit) {
        hoveredWordRect = virtualSelectionHit.rect;
      } else if (!selectionCandidateEl) {
        hoveredWordRect = null;
      }

      render();
    };

    const onSelectionClick = (e: MouseEvent) => {
      if (!isSelecting) return;
      e.preventDefault();
      e.stopPropagation();

      const hit = getUniversalSubtitleHit(e.clientX, e.clientY);
      const chosen = hit.element;

      if (chosen && chosen !== document.body && chosen.tagName.toLowerCase() !== 'video') {
        isSelecting = false;
        selectionCandidateEl = null;
        virtualSelectionHit = null;
        hoveredWordRect = null;
        void lockContainer(chosen);
        return;
      }

      // Native TextTrack fallback: there is no DOM container to lock.
      // Keep the virtual cue active for hover/click translation instead.
      if (hit.native) {
        isSelecting = false;
        selectionCandidateEl = null;
        virtualSelectionHit = hit.native;
        hoveredWordRect = hit.native.rect;
        render();
      }
    };

    const onSelectionContextMenu = (e: MouseEvent) => {
      if (!isSelecting && !pinSelectorInstance) return;
      e.preventDefault();
      e.stopPropagation();
      isSelecting = false;
      selectionCandidateEl = null;
      virtualSelectionHit = null;
      hoveredWordRect = null;
      if (pinSelectorInstance) {
        pinSelectorInstance.stop();
        pinSelectorInstance = null;
      }
      render();
    };

    window.addEventListener('mousemove', onSelectionMouseMove, true);
    window.addEventListener('click', onSelectionClick, true);
    window.addEventListener('contextmenu', onSelectionContextMenu, true);
    window.addEventListener('keydown', (e) => {
      if (isSelecting && e.key === 'Escape') {
        isSelecting = false;
        selectionCandidateEl = null;
        virtualSelectionHit = null;
        hoveredWordRect = null;
        if (pinSelectorInstance) {
          pinSelectorInstance.stop();
          pinSelectorInstance = null;
        }
        render();
      }
    }, true);

    let hoverWordTimeout: number | null = null;

    const doTranslate = async (
      extraction: TextExtractionResult,
      clientX: number,
      clientY: number,
    ) => {
      if (!extraction.text) {
        tooltipState = null;
        hoveredWordRect = null;
        isTranslating = false;
        render();
        return;
      }

      hoveredWordRect = extraction.rect;
      highlightMode = extraction.mode;
      isTranslating = true;

      tooltipState = {
        x: clientX,
        y: clientY,
        originalText: extraction.text,
        translatedText: '',
        engineUsed: settings.engine,
        mode: extraction.mode,
      };
      render();

      if (settings.pauseVideoOnHover) videoController.pause();

      const { translation, engineUsed } = await translationManager.translate(
        extraction.text,
        settings.targetLanguage,
        settings.sourceLanguage,
        settings.engine,
      );

      isTranslating = false;

      if (tooltipState && tooltipState.originalText === extraction.text) {
        tooltipState = { ...tooltipState, translatedText: translation, engineUsed };
        render();
      }
    };

    const isOverActiveContainer = (e: MouseEvent): boolean => {
      if (!activeContainerEl) return false;
      if (activeContainerEl.contains(e.target as Node)) return true;

      const rect = activeContainerEl.getBoundingClientRect();
      if (
        e.clientX >= rect.left - 5 &&
        e.clientX <= rect.right + 5 &&
        e.clientY >= rect.top - 5 &&
        e.clientY <= rect.bottom + 5
      ) {
        return true;
      }

      const stack = (document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : []) as HTMLElement[];
      return stack.some((el) => el === activeContainerEl || activeContainerEl!.contains(el));
    };

    const extractAt = (e: MouseEvent): TextExtractionResult => {
      if (e.ctrlKey) {
        return TextExtractor.getFullPhrase(e.clientX, e.clientY, activeContainerEl);
      }
      if (e.shiftKey) {
        if (rangeAnchorX !== null && rangeAnchorY !== null) {
          return TextExtractor.getRangeBetweenPoints(rangeAnchorX, rangeAnchorY, e.clientX, e.clientY);
        }
        rangeAnchorX = e.clientX;
        rangeAnchorY = e.clientY;
        return TextExtractor.getWord(e.clientX, e.clientY, activeContainerEl);
      }
      rangeAnchorX = null;
      rangeAnchorY = null;
      return TextExtractor.getWord(e.clientX, e.clientY, activeContainerEl);
    };


    // Extraction that can work when the visible subtitle has no DOM node.
    // Native TextTrack gives us the full cue text, so we translate the cue
    // rather than trying to manufacture a fake DOM element.
    const extractAtUniversal = (e: MouseEvent): TextExtractionResult => {
      const domExtraction = extractAt(e);
      if (domExtraction.text) return domExtraction;

      const nativeHit = findNativeSubtitleAtPoint(e.clientX, e.clientY);
      if (nativeHit) {
        return {
          text: nativeHit.text,
          rect: nativeHit.rect,
          mode: e.ctrlKey || e.shiftKey ? 'phrase' : 'word',
        };
      }

      return domExtraction;
    };

    const getUniversalSubtitleHit = (clientX: number, clientY: number): {
      element: HTMLElement | null;
      native: NativeSubtitleHit | null;
      video: HTMLVideoElement | null;
    } => {
      const element = findGenuineSubtitleCandidate(clientX, clientY);
      if (element) {
        return { element, native: null, video: null };
      }

      const native = findNativeSubtitleAtPoint(clientX, clientY);
      if (native) {
        return { element: null, native, video: native.video };
      }

      const video = isLikelySubtitleZone(clientX, clientY);
      return { element: null, native: null, video };
    };

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (isSelecting) return;

      const universalHit = getUniversalSubtitleHit(e.clientX, e.clientY);
      const overDomSubtitle = isOverActiveContainer(e);
      const overNativeSubtitle = !!universalHit.native;

      if (overDomSubtitle || overNativeSubtitle) {
        if (overNativeSubtitle && universalHit.native) {
          hoveredWordRect = universalHit.native.rect;
        }

        if (settings.triggerMode === 'hover') {
          if (hoverWordTimeout) window.clearTimeout(hoverWordTimeout);
          hoverWordTimeout = window.setTimeout(() => {
            const extraction = extractAtUniversal(e);
            if (extraction.text) {
              void doTranslate(extraction, e.clientX, e.clientY);
            }
          }, 35);
        }
      } else if (tooltipState || hoveredWordRect) {
        tooltipState = null;
        hoveredWordRect = null;
        isTranslating = false;
        render();
        if (settings.pauseVideoOnHover) videoController.resume(180);
      }
    });

    document.addEventListener('click', (e: MouseEvent) => {
      if (isSelecting) return;

      const universalHit = getUniversalSubtitleHit(e.clientX, e.clientY);
      if (isOverActiveContainer(e) || universalHit.native) {
        if (settings.triggerMode === 'click') {
          const extraction = extractAtUniversal(e);
          if (extraction.text) {
            void doTranslate(extraction, e.clientX, e.clientY);
          }
        }
      }
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!tooltipState || !activeContainerEl) return;
      if (e.key === 'Control') {
        const fresh = TextExtractor.getFullPhrase(tooltipState.x, tooltipState.y);
        if (fresh.text && fresh.text !== tooltipState.originalText) {
          void doTranslate(fresh, tooltipState.x, tooltipState.y);
        }
      }
    });

    browser.storage.onChanged.addListener((changes) => {
      if (changes.subanySettings?.newValue) {
        const oldReplace = settings.replaceNativeSubtitles || settings.triggerMode === 'replace-native';
        settings = { ...DEFAULT_SETTINGS, ...(changes.subanySettings.newValue as Partial<ExtensionSettings>) };
        const newReplace = settings.replaceNativeSubtitles || settings.triggerMode === 'replace-native';
        if (oldReplace && !newReplace) {
          domSwapper.restore();
        }
        if (settings.triggerMode !== 'full-auto') bilingualSubtitleText = '';
        render();
        syncActiveContainer();
      }
    });

    browser.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
      if (message?.type === 'START_SELECTION') { startSelectionFlow(); sendResponse({ success: true }); return true; }
      if (message?.type === 'RESET_SELECTION') { void unlockContainer(); sendResponse({ success: true }); return true; }
      if (message?.type === 'GET_STATUS') {
        sendResponse({ hasLockedContainer: !!activeContainerEl, selector: settings.lockedSelector, settings });
        return true;
      }
      return undefined;
    });

    videoController.hidePlatformOverlays();
    void loadSettings();
  },
});