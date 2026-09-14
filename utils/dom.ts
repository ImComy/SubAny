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
      if (child.innerText?.trim() === current.innerText?.trim()) {
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
  if (attribute) return `${element.tagName.toLowerCase()}[${attribute}="${escape(element.getAttribute(attribute) ?? '')}"]`;

  // Do not use IDs containing numbers or counters (e.g. caption-window-1, ytp-123)
  if (element.id && !/\d/.test(element.id) && !element.id.includes(':')) {
    return `#${escape(element.id)}`;
  }

  // Check if element has stable semantic subtitle classes that form a unique selector
  const directSubtitleClasses = Array.from(element.classList).filter((name) =>
    /(caption|subtitle|cue|timedtext)/i.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
  );
  if (directSubtitleClasses.length > 0) {
    const classOnly = '.' + directSubtitleClasses.map(escape).join('.');
    try {
      if (document.querySelectorAll(classOnly).length === 1) {
        return classOnly;
      }
    } catch (_) {}
    const tagAndClass = element.tagName.toLowerCase() + classOnly;
    try {
      if (document.querySelectorAll(tagAndClass).length === 1) {
        return tagAndClass;
      }
    } catch (_) {}
  }

  const path: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    // Prefer stable subtitle-related classes
    const subtitleClass = Array.from(current.classList).find((name) =>
      /(caption|subtitle|cue|timedtext)/i.test(name) && !name.startsWith('subany-') && !/\d/.test(name)
    );
    const primaryClass = subtitleClass || Array.from(current.classList).find((name) =>
      !/^(hover|active|selected|focus)$/.test(name) && !name.startsWith('subany-') && !/\d/.test(name),
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
 * Accurately finds the subtitle element at client coordinates (clientX, clientY).
 *
 * First checks document.elementsFromPoint. If pointer-events: none prevented captions
 * from appearing in the hit stack (common on YouTube), falls back to walking up from
 * the click to the video's parent, querySelectorAll('[class*="caption" i],[class*="cue" i],[class*="timedtext" i]')
 * scoped to that parent, and returning the candidate whose bounding rect contains the click point.
 */
export function getSubtitleElementAtPoint(
  clientX: number,
  clientY: number,
  clickTarget?: HTMLElement | null
): HTMLElement | null {
  const stack = (document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : []) as HTMLElement[];

  // 1. Check if elementsFromPoint hit a valid subtitle element
  for (const el of stack) {
    if (!el || el === document.body || el === document.documentElement) continue;
    if (el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) continue;
    const tag = el.tagName.toLowerCase();
    if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) continue;
    if (el.matches('button, [role="button"], [role="slider"], [role="progressbar"], input')) continue;
    if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) continue;

    const text = el.textContent?.trim() || '';
    if (text.length >= 1 && text.length <= 400 && isSubtitleText(text)) {
      return getDeepestTextContainer(el);
    }
  }

  // 2. Fallback: Captions often have pointer-events: none (e.g. YouTube), so elementsFromPoint misses them.
  // Walk up from the click to the video's parent element.
  let videoParent: HTMLElement | null = null;
  if (clickTarget) {
    let cur: HTMLElement | null = clickTarget;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.tagName.toLowerCase() === 'video') {
        videoParent = cur.parentElement;
        break;
      }
      const v = cur.querySelector('video');
      if (v) {
        videoParent = v.parentElement ?? cur;
        break;
      }
      cur = cur.parentElement;
    }
  }

  if (!videoParent) {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    const nearestVideo = videos.find((v) => {
      const r = v.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }) ?? videos[0] ?? null;
    if (nearestVideo) {
      videoParent = nearestVideo.parentElement;
    }
  }

  if (videoParent) {
    const rawCandidates = Array.from(videoParent.querySelectorAll(
      '[class*="caption" i], [class*="cue" i], [class*="timedtext" i]'
    )) as HTMLElement[];
    const leaves = rawCandidates.filter((c) => !rawCandidates.some((o) => o !== c && c.contains(o)));

    for (const candidate of leaves) {
      if (candidate.matches('button, [role="button"], [role="slider"], input')) continue;
      const text = candidate.textContent?.trim() || '';
      if (!text || !isSubtitleText(text)) continue;

      const rect = candidate.getBoundingClientRect();
      if (
        clientX >= rect.left - 4 &&
        clientX <= rect.right + 4 &&
        clientY >= rect.top - 4 &&
        clientY <= rect.bottom + 4
      ) {
        return getDeepestTextContainer(candidate);
      }
    }
    // Small tolerance if click landed slightly on padding
    for (const candidate of leaves) {
      if (candidate.matches('button, [role="button"], [role="slider"], input')) continue;
      const text = candidate.textContent?.trim() || '';
      if (!text || !isSubtitleText(text)) continue;

      const rect = candidate.getBoundingClientRect();
      if (
        clientX >= rect.left - 14 &&
        clientX <= rect.right + 14 &&
        clientY >= rect.top - 14 &&
        clientY <= rect.bottom + 14
      ) {
        return getDeepestTextContainer(candidate);
      }
    }
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
