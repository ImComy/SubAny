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
  if (element.id && !/^\d/.test(element.id) && !element.id.includes(':')) return `#${escape(element.id)}`;

  const path: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    const primaryClass = Array.from(current.classList).find((name) =>
      !/^(hover|active|selected|focus)$/.test(name) && !name.startsWith('subany-'),
    );
    if (primaryClass) selector += `.${escape(primaryClass)}`;

    const parent: HTMLElement | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child: Element) => child.tagName === current!.tagName);
      if (siblings.length > 1) selector += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
    }
    path.unshift(selector);
    current = parent;
    if (path.length >= 4) break;
  }
  return path.length > 0 ? path.join(' > ') : 'body';
}