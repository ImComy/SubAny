export interface PlatformRule {
  name: string;
  urlMatch: RegExp;
  selectors: string[];
}

export const PLATFORM_RULES: PlatformRule[] = [
  // (your existing rules – unchanged)
  // ... you can keep the generic rules; no need for site‑specific hacks
  // ... but ensure they are broad enough to match common subtitle containers
];

export class SubtitleManager {
  private lockedSelector: string | null = null;
  private onGlowTrigger?: (element: HTMLElement) => void;

  constructor(options?: { onGlowTrigger?: (element: HTMLElement) => void }) {
    this.onGlowTrigger = options?.onGlowTrigger;
  }

  setGlowCallback(callback: (element: HTMLElement) => void) {
    this.onGlowTrigger = callback;
  }

  triggerGlow(element: HTMLElement) {
    if (this.onGlowTrigger) {
      this.onGlowTrigger(element);
    }
  }

  setLockedSelector(selector: string | null) {
    this.lockedSelector = selector;
  }

  getLockedSelector(): string | null {
    return this.lockedSelector;
  }

  /**
   * Resolves the active subtitle container covering single or multi-line cues.
   */
  resolveActiveContainer(autoDetect = true, smartHeuristics = true): HTMLElement | null {
    if (this.lockedSelector) {
      try {
        const el = document.querySelector(this.lockedSelector) as HTMLElement | null;
        if (el && this.isValidSubtitleElement(el)) {
          return el;
        }
      } catch {
        // Invalid selector
      }
    }

    if (autoDetect) {
      const platformEl = this.detectPlatformContainer();
      if (platformEl) return platformEl;
    }

    if (smartHeuristics) {
      const heuristicEl = this.detectSmartHeuristicContainer();
      if (heuristicEl) return heuristicEl;
    }

    return null;
  }

  /**
   * Tries to find the subtitle window/container based on active platform rules
   */
  detectPlatformContainer(): HTMLElement | null {
    const currentUrl = window.location.href;

    for (const rule of PLATFORM_RULES) {
      if (rule.urlMatch.test(currentUrl)) {
        for (const selector of rule.selectors) {
          try {
            const elements = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            for (const el of elements) {
              if (this.isElementVisible(el) && this.isValidSubtitleElement(el)) {
                // If it's a child segment in a window, prefer the parent window to capture multi-lines
                if (el.classList.contains('ytp-caption-segment')) {
                  const win = el.closest('.caption-window') as HTMLElement | null;
                  if (win && this.isValidSubtitleElement(win)) {
                    return win;
                  }
                }
                const optimal = this.findOptimalSubtitleContainer(el);
                return optimal || el;
              }
            }
          } catch {
            // Ignore selector errors
          }
        }
      }
    }
    return null;
  }

  /**
   * Smart geometric heuristic detector for custom video players:
   * Finds the active <video>, searches for text overlays inside the lower 45% of video boundaries.
   */
  detectSmartHeuristicContainer(): HTMLElement | null {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    if (videos.length === 0) return null;

    let bestVideo: HTMLVideoElement | null = videos[0] ?? null;
    let maxScore = -1;

    for (const vid of videos) {
      const rect = vid.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 1000) continue;

      let score = area;
      if (!vid.paused) score += 1000000;
      if (rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight) {
        score += 500000;
      }

      if (score > maxScore) {
        maxScore = score;
        bestVideo = vid;
      }
    }

    if (!bestVideo) return null;

    const videoRect = bestVideo.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) return null;

    // 1. Direct descendant scan within the player parent container
    const playerContainer = bestVideo.parentElement;
    if (playerContainer) {
      const descendants = Array.from(playerContainer.querySelectorAll('*')) as HTMLElement[];
      for (const el of descendants) {
        if (!this.isValidSubtitleElement(el, bestVideo)) continue;
        const r = el.getBoundingClientRect();
        // Check if inside lower 45% of video
        if (r.bottom >= videoRect.top + videoRect.height * 0.55 && r.top <= videoRect.bottom) {
          const text = el.innerText?.trim() ?? '';
          if (text.length >= 2 && /[\p{L}\p{N}]/u.test(text)) {
            const optimal = this.findOptimalSubtitleContainer(el, bestVideo);
            if (optimal && this.isValidSubtitleElement(optimal, bestVideo)) {
              return optimal;
            }
          }
        }
      }
    }

    // 2. Search points within the bottom 30% of the video (subtitles zone)
    const samplePoints = [
      { x: videoRect.left + videoRect.width * 0.5, y: videoRect.top + videoRect.height * 0.85 },
      { x: videoRect.left + videoRect.width * 0.5, y: videoRect.top + videoRect.height * 0.78 },
      { x: videoRect.left + videoRect.width * 0.4, y: videoRect.top + videoRect.height * 0.85 },
      { x: videoRect.left + videoRect.width * 0.6, y: videoRect.top + videoRect.height * 0.85 },
      { x: videoRect.left + videoRect.width * 0.5, y: videoRect.top + videoRect.height * 0.90 },
    ];

    for (const pt of samplePoints) {
      if (pt.x < 0 || pt.y < 0 || pt.x > window.innerWidth || pt.y > window.innerHeight) continue;

      const stack = (document.elementsFromPoint ? document.elementsFromPoint(pt.x, pt.y) : []) as HTMLElement[];
      for (const el of stack) {
        if (!el || !this.isValidSubtitleElement(el, bestVideo)) continue;

        const container = this.findOptimalSubtitleContainer(el, bestVideo);
        if (container && this.isValidSubtitleElement(container, bestVideo)) {
          return container;
        }
      }
    }

    return null;
  }

  /**
   * Validates that an element is a real subtitle element and strictly NOT a video, player wrapper, or control bar.
   */
  isValidSubtitleElement(el: HTMLElement, referenceVideo?: HTMLVideoElement | null): boolean {
    const tag = el.tagName.toLowerCase();
    if (
      tag === 'video' ||
      tag === 'audio' ||
      tag === 'body' ||
      tag === 'html' ||
      tag === 'button' ||
      tag === 'svg' ||
      tag === 'path' ||
      tag === 'input' ||
      tag === 'select'
    ) {
      return false;
    }

    // Subtitle containers NEVER contain the <video> element
    if (el.querySelector('video') !== null) {
      return false;
    }

    // Never accept control bars, buttons, or sliders
    if (el.closest('button, svg, input, [role="slider"], [role="progressbar"], [role="button"]')) {
      return false;
    }

    const id = (el.id || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();

    if (
      cls.includes('controls') ||
      cls.includes('progress') ||
      cls.includes('slider') ||
      cls.includes('volume') ||
      cls.includes('chrome-bottom') ||
      cls.includes('player-controls') ||
      cls.includes('tooltip') ||
      cls.includes('menu') ||
      id.includes('controls') ||
      (id.includes('player') && !id.includes('caption') && !id.includes('subtitle') && !id.includes('timedtext'))
    ) {
      return false;
    }

    const text = el.innerText?.trim() ?? '';
    // If text is empty, it can ONLY be valid if it has explicit subtitle/caption class names
    const isExplicitCaptionClass =
      cls.includes('caption') ||
      cls.includes('subtitle') ||
      cls.includes('timedtext') ||
      cls.includes('cue') ||
      id.includes('caption') ||
      id.includes('subtitle');

    if (!text && !isExplicitCaptionClass) {
      return false;
    }

    // Ignore timecodes like "39:45" or "1:07:17" or pure numbers
    if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(text) || /^\d+(\.\d+)?%?$/.test(text)) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    // Size check: Subtitle element MUST NOT be the entire video or entire player
    if (referenceVideo) {
      const vRect = referenceVideo.getBoundingClientRect();
      if (rect.width >= vRect.width * 0.96 && rect.height >= vRect.height * 0.5) {
        return false;
      }
      if (rect.height > vRect.height * 0.45) {
        return false;
      }
    } else {
      if (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.45) {
        return false;
      }
    }

    return true;
  }

  /**
   * Refines a hit element to the multi-line subtitle container window.
   * 🔥 EARLY STOP: if current element already has a subtitle class, do NOT climb.
   */
  findOptimalSubtitleContainer(leaf: HTMLElement, video?: HTMLVideoElement | null): HTMLElement {
    let current: HTMLElement = leaf;
    const refVideo = video || document.querySelector('video');
    const vRect = refVideo ? refVideo.getBoundingClientRect() : null;

    // ---- EARLY STOP: if current already has a subtitle class, return it ----
    const currentCls = (current.className || '').toString().toLowerCase();
    if (/(cue|subtitle|caption|timedtext|cineby-cue)/i.test(currentCls)) {
      return current;
    }

    // Climb up to find the persistent subtitle window
    while (current.parentElement && current.parentElement !== document.body && current.parentElement !== refVideo) {
      const p = current.parentElement;
      const pCls = String(p.className || '').toLowerCase();
      const pId = String(p.id || '').toLowerCase();
      const pTag = p.tagName.toLowerCase();
      const pRect = p.getBoundingClientRect();

      // NEVER climb into the player root, video wrapper, buttons, or huge containers
      if (
        pTag === 'button' ||
        p.querySelector('video') !== null ||
        pCls.includes('player-controls') ||
        pCls.includes('html5-video') ||
        pCls.includes('video-container') ||
        pCls.includes('controls') ||
        (vRect && (pRect.height >= vRect.height * 0.45 || pRect.width >= vRect.width * 0.96))
      ) {
        break;
      }

      // If parent has explicit subtitle markers, climb up
      if (pCls.includes('caption') || pCls.includes('subtitle') || pCls.includes('timedtext') || pId.includes('caption')) {
        current = p;
        continue;
      }

      // If parent only tightly wraps the same subtitle text and isn't huge, climb up
      const pText = p.innerText?.trim() ?? '';
      const cText = current.innerText?.trim() ?? '';
      if (pText === cText && (!vRect || pRect.height <= vRect.height * 0.35)) {
        current = p;
      } else {
        break;
      }
    }

    return current;
  }

  private isElementVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /**
   * Generates a stable and minimal CSS selector for a given element.
   */
  generateUniqueSelector(element: HTMLElement): string {
    if (element.id && !element.id.match(/^\d/) && !element.id.includes(':')) {
      return `#${this.escapeSelector(element.id)}`;
    }

    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      if (current.id && !current.id.match(/^\d/) && !current.id.includes(':')) {
        path.unshift(`#${this.escapeSelector(current.id)}`);
        break;
      }

      if (current.classList.length > 0) {
        const primaryClass = Array.from(current.classList).find(
          (c) =>
            !c.includes('hover') &&
            !c.includes('active') &&
            !c.includes('selected') &&
            !c.includes('focus') &&
            !c.startsWith('subany-'),
        );
        if (primaryClass) {
          selector += `.${this.escapeSelector(primaryClass)}`;
        }
      }

      const parentEl: HTMLElement | null = current.parentElement;
      if (parentEl) {
        const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === current?.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${idx})`;
        }
      }

      path.unshift(selector);
      current = parentEl;

      if (path.length >= 4) break;
    }

    return path.length > 0 ? path.join(' > ') : 'body';
  }

  private escapeSelector(val: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(val);
    }
    return val.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
}