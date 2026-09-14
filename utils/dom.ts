// utils/dom.ts

import { isSubtitleText } from './text';

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
      // Use textContent, never innerText, to avoid forced layout.
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
      /(caption|subtitle|cue|timedtext)/i.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
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

/**
 * Find the subtitle element under a point, universally.
 *
 * Two paths:
 *   1. `elementsFromPoint` — fast path. Works on every site whose captions
 *      have pointer-events enabled (most sites).
 *   2. Geometric walk — fallback. Required when captions have
 *      `pointer-events: none` (YouTube). No class names. Pruned by
 *      containment: only descends into subtrees that contain the click.
 */
export function getSubtitleElementAtPoint(
  clientX: number,
  clientY: number,
  clickTarget?: HTMLElement | null,
): HTMLElement | null {
  // ---- 1. Hit-stack fast path ----
  const stack = (document.elementsFromPoint
    ? document.elementsFromPoint(clientX, clientY)
    : []) as HTMLElement[];

  for (const el of stack) {
    if (!el || el === document.body || el === document.documentElement) continue;
    if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;
    const tag = el.tagName.toLowerCase();
    if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) continue;
    if (el.matches('button, [role="button"], [role="slider"], [role="progressbar"], input')) continue;
    if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) continue;

    const text = (el.textContent ?? '').trim();
    if (text.length >= 1 && text.length <= 400 && isSubtitleText(text)) {
      return getDeepestTextContainer(el);
    }
  }

  // ---- 2. Geometric fallback (no class names) ----

  // Find the video under the click, either via the click target's ancestry
  // or by rect hit-testing.
  let video: HTMLVideoElement | null = null;

  if (clickTarget) {
    let cur: HTMLElement | null = clickTarget;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.tagName.toLowerCase() === 'video') {
        video = cur as HTMLVideoElement;
        break;
      }
      const v = cur.querySelector('video');
      if (v) { video = v as HTMLVideoElement; break; }
      cur = cur.parentElement;
    }
  }

  if (!video) {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    video =
      videos.find((v) => {
        const r = v.getBoundingClientRect();
        return (
          clientX >= r.left && clientX <= r.right &&
          clientY >= r.top && clientY <= r.bottom
        );
      }) ?? null;
  }

  if (!video) return null;

  const vr = video.getBoundingClientRect();
  if (vr.width <= 0 || vr.height <= 0) return null;

  // Scope: two levels up from the video. On YouTube this lands on
  // `.html5-video-player`, which holds the caption layer.
  const scope = video.parentElement?.parentElement ?? video.parentElement;
  if (!scope) return null;

  // Bounded pruned walk. Only descends into subtrees that contain the click.
  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  const walkStack: HTMLElement[] = [scope];
  let visited = 0;
  const MAX_VISITS = 500;

  while (walkStack.length > 0 && visited < MAX_VISITS) {
    const el = walkStack.pop()!;
    visited++;

    if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;

    // Containment: if the click is not inside this element, skip its subtree
    // entirely. This is the pruning that keeps the walk cheap.
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
      continue;
    }

    // Descend into children for a smaller match.
    for (let i = 0; i < el.children.length; i++) {
      walkStack.push(el.children[i] as HTMLElement);
    }

    // Must be in the lower portion of the video (subtitles band). Allow
    // anything below the midpoint — top-anchored captions are rare, and
    // the click will confirm correctness anyway.
    if (r.top < vr.top + vr.height * 0.35) continue;

    // Size cap: a subtitle leaf cannot be nearly the whole video.
    if (r.width > vr.width * 0.90 && r.height > vr.height * 0.15) continue;

    const text = (el.textContent ?? '').trim();
    if (text.length < 2 || text.length > 400) continue;
    if (!isSubtitleText(text)) continue;

    const area = r.width * r.height;
    if (area < bestArea) {
      bestArea = area;
      best = el;
    }
  }

  return best ? getDeepestTextContainer(best) : null;
}

export function resolvePlayerContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    if (current.querySelector('video')) return current;
    current = current.parentElement;
  }
  return null;
}