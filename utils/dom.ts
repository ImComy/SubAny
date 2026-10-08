import { isSubtitleText, normalizeSubtitleText } from './text';

export function getDomDepth(el: Node): number {
  let depth = 0;
  let current = el;
  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

export function getLowestCommonHTMLElement(elements: HTMLElement[]): HTMLElement | null {
  if (elements.length === 0) return null;
  const first = elements[0]!;
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

// Traverse DOM, Shadow DOM, and same-origin iframes.
// NOTE: Only use outside hot paths. Never call this in a tick, timer,
// or pointer handler on a large page.
export function getAllElements(root: Node | ShadowRoot): HTMLElement[] {
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
        if (doc) elements.push(...getAllElements(doc));
      } catch (_) { /* cross-origin – skip */ }
    }
  }
  return elements;
}

export function getDeepestTextContainer(el: HTMLElement): HTMLElement {
  let current = el;
  while (true) {
    const children = current.children;
    if (children.length === 0) break;

    if (children.length === 1) {
      const child = children[0] as HTMLElement;
      if (child.textContent?.trim() === current.textContent?.trim()) {
        if (child.children.length === 0) {
          current = child;
          break;
        }
        current = child;
        continue;
      }
    }
    break;
  }
  return current;
}

/**
 * Prefer the smallest descendant that still contains the same subtitle text.
 *
 * This matters on players that wrap a short, moving caption in a structural
 * container (for example, a span/bloc wrapper around the actual text node). The
 * wrapper is a stable anchor for cue tracking, but the visual selection box must
 * follow the text-bearing leaf instead of the entire wrapper.
 */
export function getPreferredSubtitleLeaf(el: HTMLElement): HTMLElement {
  let current: HTMLElement = el;

  while (current.children.length === 1) {
    const child = current.children[0] as HTMLElement;
    const currentText = (current.textContent ?? '').replace(/\s+/g, ' ').trim();
    const childText = (child.textContent ?? '').replace(/\s+/g, ' ').trim();

    if (!currentText || !childText || currentText !== childText) break;

    const parentRect = current.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) break;
    if (childRect.width <= 0 || childRect.height <= 0) break;
    if (childRect.width > parentRect.width || childRect.height > parentRect.height) break;

    current = child;
  }

  return current;
}

export function getVideoContainingElement(element: HTMLElement): HTMLVideoElement | null {
  const er = element.getBoundingClientRect();
  let best: HTMLVideoElement | null = null;
  let bestOverlap = 0;
  for (const video of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
    const vr = video.getBoundingClientRect();
    if (vr.width <= 0 || vr.height <= 0) continue;
    const overlapWidth = Math.max(0, Math.min(er.right, vr.right) - Math.max(er.left, vr.left));
    const overlapHeight = Math.max(0, Math.min(er.bottom, vr.bottom) - Math.max(er.top, vr.top));
    const overlap = overlapWidth * overlapHeight;
    const elementArea = Math.max(1, er.width * er.height);
    const normalized = overlap / elementArea;
    if (normalized > bestOverlap) {
      bestOverlap = normalized;
      best = video;
    }
  }
  return bestOverlap >= 0.20 ? best : null;
}

export function getVideoForElement(element: HTMLElement): HTMLVideoElement | null {
  const er = element.getBoundingClientRect();
  if (er.width <= 0 || er.height <= 0) return null;

  let best: HTMLVideoElement | null = null;
  let bestOverlap = 0;
  for (const video of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
    const vr = video.getBoundingClientRect();
    if (vr.width <= 0 || vr.height <= 0) continue;
    const overlapWidth = Math.max(0, Math.min(er.right, vr.right) - Math.max(er.left, vr.left));
    const overlapHeight = Math.max(0, Math.min(er.bottom, vr.bottom) - Math.max(er.top, vr.top));
    const overlap = overlapWidth * overlapHeight;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = video;
    }
  }
  return best;
}

export function getVideoSignature(video: HTMLVideoElement | null): string {
  if (!video) return '';
  const source = video.currentSrc || video.src || video.querySelector('source')?.getAttribute('src') || '';
  const rect = video.getBoundingClientRect();
  const ratio = rect.width > 0 && rect.height > 0 ? Math.round((rect.width / rect.height) * 1000) : 0;
  return `${source}|${ratio}`;
}

export function isPointInRectWithPadding(x: number, y: number, rect: DOMRect, padding = 28): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  );
}

export function getVideoSubtitleRect(video: HTMLVideoElement, cue: TextTrackCue): DOMRect {
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

export function generateUniqueSelector(element: HTMLElement): string {
  const escape = (value: string): string => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  const attribute = ['data-testid', 'data-test', 'aria-label'].find((name) => element.hasAttribute(name));
  if (attribute) {
    return `${element.tagName.toLowerCase()}[${attribute}="${escape(element.getAttribute(attribute) ?? '')}"]`;
  }

  // IDs with digits are usually counters (caption-window-1, ytp-123) that
  // change on player rebuild. Never use them.
  if (element.id && !/\d/.test(element.id) && !element.id.includes(':')) {
    return `#${escape(element.id)}`;
  }

  const directSubtitleClasses = Array.from(element.classList).filter((name) =>
    /(caption|subtitle|cue|timedtext)/i.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
  );
  if (directSubtitleClasses.length > 0) {
    const classOnly = '.' + directSubtitleClasses.map(escape).join('.');
    try {
      if (document.querySelectorAll(classOnly).length === 1) return classOnly;
    } catch (_) { }
    const tagAndClass = element.tagName.toLowerCase() + classOnly;
    try {
      if (document.querySelectorAll(tagAndClass).length === 1) return tagAndClass;
    } catch (_) { }
  }

  const path: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    const subtitleClass = Array.from(current.classList).find((name) =>
      /(caption|subtitles?|cue|timedtext|lyrics|karaoke|dual)/i.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
    );
    const primaryClass = subtitleClass || Array.from(current.classList).find((name) =>
      !/^(hover|active|selected|focus)$/.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
    );
    if (primaryClass) selector += `.${escape(primaryClass)}`;

    const parent: HTMLElement | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child: Element) => child.tagName === current!.tagName);
      if (siblings.length > 1 && !subtitleClass) {
        selector += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
      }
    }
    path.unshift(selector);
    current = parent;
    if (path.length >= 4) break;
  }
  return path.length > 0 ? path.join(' > ') : 'body';
}

// ---------------------------------------------------------------------------
// Subtitle point resolution
// ---------------------------------------------------------------------------

/**
 * Tags that can never be a subtitle text leaf. Skipped before any geometry
 * read to avoid wasting work and to prevent player chrome from ever matching.
 */
const SKIP_TAGS = new Set([
  'video', 'audio', 'canvas', 'svg', 'path',
  'button', 'input', 'select', 'textarea',
  'script', 'style', 'noscript', 'link', 'meta', 'head',
  'iframe', 'object', 'embed', 'img', 'picture', 'source', 'track',
  'br', 'hr', 'wbr',
]);

function isExtensionElement(el: HTMLElement): boolean {
  return el.id === 'subany-extension-root' || !!el.id?.startsWith('subany-');
}

function isInteractiveControl(el: HTMLElement): boolean {
  if (el.matches('button, [role="button"], [role="slider"], [role="progressbar"], input')) return true;
  if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) return true;
  return false;
}

/**
 * Returns the effective acceptance region of a video, expanding its bounding
 * rect to encompass its immediate player shell (e.g. letterboxing borders,
 * controls margin) with forgiving padding.
 */
export function getSubtitleAcceptanceRegion(video: HTMLVideoElement): DOMRect {
  const vr = video.getBoundingClientRect();
  if (vr.width <= 0 || vr.height <= 0) return vr;

  const shell = video.parentElement?.parentElement ?? video.parentElement;
  if (shell && shell !== document.body && shell !== document.documentElement) {
    const sr = shell.getBoundingClientRect();
    if (
      sr.width > 0 &&
      sr.height > 0 &&
      sr.width <= window.innerWidth * 1.05 &&
      sr.height <= window.innerHeight * 1.05
    ) {
      const left = Math.min(vr.left, sr.left);
      const right = Math.max(vr.right, sr.right);
      const top = Math.min(vr.top, sr.top);
      const bottom = Math.max(vr.bottom, sr.bottom);
      if (
        right - left <= Math.max(vr.width * 1.5, vr.width + 120) &&
        bottom - top <= Math.max(vr.height * 1.5, vr.height + 140)
      ) {
        return new DOMRect(left - 24, top - 24, (right - left) + 48, (bottom - top) + 48);
      }
    }
  }

  return new DOMRect(vr.left - 24, vr.top - 24, vr.width + 48, vr.height + 48);
}

/**
 * Shadow-DOM aware node containment check.
 */
export function composedContains(root: Node, child: Node | null): boolean {
  let curr: Node | null = child;
  while (curr) {
    if (curr === root) return true;
    if (curr instanceof ShadowRoot) {
      curr = curr.host;
    } else {
      curr = curr.parentNode;
    }
  }
  return false;
}

/**
 * Locate the video element associated with a click point.
 *
 * Preferred path: walk up from `clickTarget` looking for a `<video>` (either
 * the target itself or a descendant). This works when the user's click has
 * already been captured by the player's own listeners.
 *
 * Fallback: hit-test the video list by acceptance region.
 */
export function findVideoAtPoint(
  clientX: number,
  clientY: number,
  clickTarget?: HTMLElement | null,
): HTMLVideoElement | null {
  if (clickTarget) {
    let cur: HTMLElement | null = clickTarget;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.tagName.toLowerCase() === 'video') {
        return cur as HTMLVideoElement;
      }
      const v = cur.querySelector('video');
      if (v) return v as HTMLVideoElement;
      cur = cur.parentElement;
    }
  }

  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  return (
    videos.find((v) => {
      const region = getSubtitleAcceptanceRegion(v);
      return (
        region.width > 0 &&
        region.height > 0 &&
        clientX >= region.left &&
        clientX <= region.right &&
        clientY >= region.top &&
        clientY <= region.bottom
      );
    }) ?? null
  );
}

/**
 * The single validation predicate that every candidate must pass, regardless
 * of which resolution path found it.
 *
 * Both the `elementsFromPoint` hit-stack and the geometric walk apply this
 * exact rule set, so the two paths cannot disagree about what counts as a
 * subtitle.
 *
 * Rules:
 *   - Never our own UI.
 *   - Never a blacklisted tag (video, script, controls, etc.).
 *   - Never an interactive control or a descendant of one.
 *   - Must have non-zero size.
 *   - Must not be a player wrapper.
 *   - Must carry plausible subtitle text by length and character set.
 */
export function isPlausibleSubtitleLeaf(
  el: HTMLElement,
  videoRect: DOMRect | null,
  options?: { allowTop?: boolean },
): boolean {
  if (isExtensionElement(el)) return false;

  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return false;

  if (isInteractiveControl(el)) return false;

  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;

  if (videoRect && videoRect.width > 0 && videoRect.height > 0) {
    // Reject full-width player wrappers. An element wider than 95% of the video AND
    // taller than 15% of it is container chrome, not a caption.
    if (r.width > videoRect.width * 0.95 && r.height > videoRect.height * 0.15) {
      return false;
    }

    // Only gate top chrome when allowTop is explicitly false (e.g. unassisted auto-detect).
    // On click/hover paths, allowTop defaults to true so captions anywhere on the video
    // (including Japanese anime, dialogue above graphics, top-third text) are recognized.
    if (options?.allowTop === false) {
      const centerY = r.top + r.height / 2;
      if (centerY < videoRect.top + videoRect.height * 0.15) return false;
    }
  }

  const text = (el.textContent ?? '').trim();
  if (text.length < 2 || text.length > 400) return false;
  if (!isSubtitleText(text)) return false;

  return true;
}

/**
 * Measures the on-screen glyph bounds of all non-UI text nodes inside root.
 */
export function measureGlyphBounds(root: Element): DOMRect | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ?? '';
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isInteractiveControl(parent)) return NodeFilter.FILTER_REJECT;
      if (isExtensionElement(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  let found = false;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width <= 0 && r.height <= 0) continue;
      if (r.left < minL) minL = r.left;
      if (r.top < minT) minT = r.top;
      if (r.right > maxR) maxR = r.right;
      if (r.bottom > maxB) maxB = r.bottom;
      found = true;
    }
  }

  if (!found) return null;
  return new DOMRect(minL, minT, maxR - minL, maxB - minT);
}

const MAX_WRAPPER_SLACK_PX = 40;

/**
 * Walk up from an inner word span or formatting leaf to the enclosing caption
 * line / sentence container if the parent groups multiple inline tokens into
 * a single cohesive subtitle line (e.g. Test 4, YouTube caption segments).
 */
export function resolveCaptionLineContainer(
  el: HTMLElement,
  videoRect?: DOMRect | null,
): HTMLElement {
  let current: HTMLElement = el;

  for (let i = 0; i < 4; i++) {
    const parent = current.parentElement;
    if (!parent) break;
    if (parent === document.body || parent === document.documentElement) break;
    if (parent.tagName.toLowerCase() === 'video') break;
    if (isExtensionElement(parent)) break;
    if (isInteractiveControl(parent)) break;
    if (parent.classList.contains('html5-video-player') || parent.classList.contains('video-stream')) break;

    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) break;

    if (videoRect) {
      if (parentRect.width > videoRect.width * 0.98) break;
      if (parentRect.width > videoRect.width * 0.90 && parentRect.height > videoRect.height * 0.15) break;
    }

    const parentText = normalizeSubtitleText(parent.textContent ?? '');
    if (parentText.length > 400 || !isSubtitleText(parentText)) {
      break;
    }

    const isInline =
      parent.tagName.toLowerCase() === 'span' ||
      (typeof window !== 'undefined' &&
        window.getComputedStyle(parent).display.includes('inline'));

    const isExplicitLine =
      /(caption-text|captions-text|caption-line|cue-line|cue-container|ytp-caption-segment)/i.test(
        typeof parent.className === 'string' ? parent.className : '',
      );

    const hasSiblingTokens = parent.childNodes.length > 1;

    if (isInline || isExplicitLine || hasSiblingTokens) {
      const tb = measureGlyphBounds(parent);
      // Only non-inline block/flex wrappers can stretch across the screen (e.g. 800px full-width bar).
      // If a non-inline parent stretches far wider than its text glyphs, it is layout chrome, not the caption line.
      if (!isInline && tb && parentRect.width - tb.width > MAX_WRAPPER_SLACK_PX) {
        break;
      }
      current = parent;
    } else {
      break;
    }
  }

  return current;
}

/**
 * Find the subtitle element under a point, universally.
 *
 * Two paths, one validation predicate:
 *
 *   1. Hit-stack (`elementsFromPoint`). Fast, and the only path that works
 *      when captions have `pointer-events` enabled. Skipped automatically
 *      when captions use `pointer-events: none` — the hit stack then only
 *      returns the video and its wrappers, all of which fail validation.
 *
 *   2. Geometric walk. Required for `pointer-events: none` captions
 *      (YouTube, Videasy, most modern players). Scoped to the video's
 *      grandparent so it reaches sibling caption layers, pruned by
 *      containment so it only descends into subtrees that contain the
 *      click, and bounded by MAX_VISITS so it can never explode on a
 *      pathological page.
 *
 * The scope is the grandparent because captions are almost always a
 * sibling of the video wrapper, not a descendant of it:
 *
 *     player-container              ← scope (grandparent)
 *     ├── video-wrapper
 *     │   └── <video>               ← video.parentElement
 *     └── caption-layer             ← sibling of video wrapper
 *         └── caption               ← what we want
 *
 * No class-name matching is required. No full-document scan.
 */
export function getSubtitleElementAtPoint(
  clientX: number,
  clientY: number,
  clickTarget?: HTMLElement | null,
): HTMLElement | null {
  const video = findVideoAtPoint(clientX, clientY, clickTarget);
  if (!video) return null;

  const vr = video.getBoundingClientRect();
  if (vr.width <= 0 || vr.height <= 0) return null;

  // ---- Path A: hit-stack fast path ----
  const stack = (document.elementsFromPoint
    ? document.elementsFromPoint(clientX, clientY)
    : []) as HTMLElement[];

  for (const el of stack) {
    if (!isPlausibleSubtitleLeaf(el, vr)) continue;
    const leaf = getPreferredSubtitleLeaf(el);
    return resolveCaptionLineContainer(leaf, vr);
  }

  // ---- Path B: geometric walk ----
  const scope = video.parentElement?.parentElement ?? video.parentElement;
  if (!scope) return null;

  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  const walkStack: HTMLElement[] = [scope];
  let visited = 0;
  const MAX_VISITS = 800;

  while (walkStack.length > 0 && visited < MAX_VISITS) {
    const el = walkStack.pop()!;
    visited++;

    if (isExtensionElement(el)) continue;

    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;

    // Prune: subtrees not containing the click are irrelevant.
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
      continue;
    }

    // Push children in reverse so earlier siblings (typically the video
    // wrapper and the caption layer) are popped before later chrome.
    for (let i = el.children.length - 1; i >= 0; i--) {
      walkStack.push(el.children[i] as HTMLElement);
    }

    if (!isPlausibleSubtitleLeaf(el, vr)) continue;

    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }

  if (best) {
    const leaf = getPreferredSubtitleLeaf(best);
    return resolveCaptionLineContainer(leaf, vr);
  }
  return null;
}

export function resolvePlayerContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    if (current.querySelector('video')) return current;
    current = current.parentElement;
  }
  return null;
}