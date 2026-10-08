import { getLowestCommonHTMLElement, measureGlyphBounds } from '../../utils/dom';
import { normalizeSubtitleText, isSubtitleText } from '../../utils/text';
import { isPlayerControlRegion } from './CandidateScorer';

export function isUsableSubtitleLine(el: HTMLElement, videoRect: DOMRect | null): boolean {
  if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;

  const rawText = normalizeSubtitleText(el.textContent || '');
  if (!rawText || !isSubtitleText(rawText)) return false;
  if (isPlayerControlRegion(el)) return false;

  const tag = el.tagName.toLowerCase();
  if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) return false;

  if (el.querySelector('video, canvas') !== null) return false;
  if (el.closest('button, [role="button"], [role="slider"], [role="progressbar"], input')) return false;
  if (el.closest('.control, .controls, .progress, .volume, .player-controls')) return false;

  const text = normalizeSubtitleText(el.textContent || '');
  if (!text || !isSubtitleText(text)) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  if (videoRect) {
    const tb = measureGlyphBounds(el);
    const contentWidth = tb ? tb.width : rect.width;
    const contentHeight = tb ? tb.height : rect.height;
    if (contentWidth >= videoRect.width * 0.96) return false;
    if (contentHeight >= videoRect.height * 0.40) return false;
    if (
      rect.right < videoRect.left - 24 ||
      rect.left > videoRect.right + 24 ||
      rect.bottom < videoRect.top - 24 ||
      rect.top > videoRect.bottom + 24
    ) return false;
  }

  return true;
}

export function canBelongToSubtitleGroup(
  anchor: HTMLElement,
  candidate: HTMLElement,
  videoRect: DOMRect | null,
): boolean {
  if (candidate === anchor) return false;
  if (anchor.contains(candidate) || candidate.contains(anchor)) return false;
  if (!isUsableSubtitleLine(candidate, videoRect)) return false;

  const a = anchor.getBoundingClientRect();
  const b = candidate.getBoundingClientRect();

  // Vertical relationship: must be close enough to be adjacent or stacked lines
  const aCenterY = a.top + a.height / 2;
  const bCenterY = b.top + b.height / 2;
  const verticalGap = Math.max(0, Math.abs(aCenterY - bCenterY) - (a.height + b.height) / 2);
  const maxVerticalGap = Math.max(28, Math.max(a.height, b.height) * 1.8);
  if (verticalGap > maxVerticalGap) return false;

  const aStyle = getComputedStyle(anchor);
  const bStyle = getComputedStyle(candidate);
  const aFont = parseFloat(aStyle.fontSize);
  const bFont = parseFloat(bStyle.fontSize);

  // In bilingual/dual subtitles, secondary/phonetic text is often 40-70% size of primary text
  if (Number.isFinite(aFont) && Number.isFinite(bFont)) {
    const fontRatio = Math.max(aFont, bFont) / Math.max(1, Math.min(aFont, bFont));
    if (fontRatio > 2.8) return false;
  }

  // 1. Same-line adjacent tokens (e.g. multi-span words / segments)
  const verticalOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const minHeight = Math.min(a.height, b.height);
  if (minHeight > 0 && verticalOverlap >= minHeight * 0.45) {
    const horizontalGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    return horizontalGap <= Math.max(50, (aFont || 16) * 2.5);
  }

  // 2. Direct siblings in the same parent wrapper (e.g. karaoke lines, dual subtitle rows)
  if (anchor.parentElement && anchor.parentElement === candidate.parentElement) {
    return true;
  }

  // 3. Centered multi-line captions
  if (aStyle.textAlign === bStyle.textAlign && aStyle.textAlign === 'center') return true;

  // 4. Stacked lines with horizontal overlap or compatible horizontal placement
  const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  if (horizontalOverlap >= Math.min(a.width, b.width) * 0.15) return true;

  // 5. Stacked lines with shared alignment or close centers (e.g. left/start aligned dialogues)
  const centreXDistance = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2);
  const maxCentreXDistance = videoRect
    ? Math.max(200, videoRect.width * 0.5)
    : Math.max(200, window.innerWidth * 0.5);
  return centreXDistance <= maxCentreXDistance;
}

/**
 * Check if an element is already a cohesive multi-line container with multiple
 * subtitle line children (e.g. .karaoke-wrapper, .dual-wrapper).
 */
export function isMultiLineSubtitleContainer(el: HTMLElement, videoRect: DOMRect | null): boolean {
  if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;
  if (el.children.length < 2) return false;
  if (el.querySelector('video, canvas, button, input, select, textarea') !== null) return false;
  if (isPlayerControlRegion(el, videoRect)) return false;

  const validChildCount = Array.from(el.children).filter((child) => {
    const c = child as HTMLElement;
    const text = normalizeSubtitleText(c.textContent || '');
    return text.length > 0 && isSubtitleText(text) && !isPlayerControlRegion(c, videoRect);
  }).length;

  if (validChildCount < 2) return false;

  const tb = measureGlyphBounds(el);
  const contentWidth = tb ? tb.width : el.getBoundingClientRect().width;
  const contentHeight = tb ? tb.height : el.getBoundingClientRect().height;

  if (videoRect) {
    if (contentWidth > videoRect.width * 0.95) return false;
    if (contentHeight > videoRect.height * 0.40) return false;
  }

  return true;
}

export function combineSubtitleLines(anchor: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  if (!anchor) return anchor;

  // If anchor is already the multi-line container enclosing multiple lines, keep it
  if (isMultiLineSubtitleContainer(anchor, videoRect)) {
    return anchor;
  }

  if (!isUsableSubtitleLine(anchor, videoRect)) return anchor;

  // If anchor's immediate parent is a multi-line container enclosing anchor and its siblings,
  // promote to that container directly
  const doc = anchor.ownerDocument || document;
  const parent = anchor.parentElement;
  if (parent && parent !== doc.body && parent !== doc.documentElement) {
    if (isMultiLineSubtitleContainer(parent, videoRect)) {
      return parent;
    }
  }

  const candidatePool: HTMLElement[] = [];
  if (parent && parent !== doc.body && parent !== doc.documentElement) {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i] as HTMLElement;
      if (child !== anchor) candidatePool.push(child);
    }
    const grandParent = parent.parentElement;
    if (grandParent && grandParent !== doc.body && grandParent !== doc.documentElement) {
      for (let i = 0; i < grandParent.children.length; i++) {
        const sibling = grandParent.children[i] as HTMLElement;
        if (sibling !== parent) {
          candidatePool.push(sibling);
          for (let j = 0; j < sibling.children.length; j++) {
            candidatePool.push(sibling.children[j] as HTMLElement);
          }
        }
      }
    }
  }

  const related: HTMLElement[] = [anchor];

  // Transitive cluster grouping: a candidate belongs if it can group with ANY accepted member
  let addedNew = true;
  while (addedNew && related.length < 8) {
    addedNew = false;
    for (let i = candidatePool.length - 1; i >= 0; i--) {
      const candidate = candidatePool[i];
      if (!candidate) continue;
      const canGroup = related.some((member) => canBelongToSubtitleGroup(member, candidate, videoRect));
      if (canGroup) {
        related.push(candidate);
        candidatePool.splice(i, 1);
        addedNew = true;
        if (related.length >= 8) break;
      }
    }
  }

  if (related.length < 2) return anchor;

  related.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (Math.abs(ar.top - br.top) > 4) return ar.top - br.top;
    return ar.left - br.left;
  });

  const anchorRect = anchor.getBoundingClientRect();
  const minTop = Math.min(...related.map((el) => el.getBoundingClientRect().top));
  const maxBottom = Math.max(...related.map((el) => el.getBoundingClientRect().bottom));
  const clusterHeight = maxBottom - minTop;
  const maxClusterHeight = videoRect
    ? Math.max(180, videoRect.height * 0.35)
    : Math.max(180, window.innerHeight * 0.35);

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

  const expectedText = normalizeSubtitleText(related.map((el) => el.textContent || '').join(' '));
  const actualText = normalizeSubtitleText(group.textContent || '');

  const expectedChars = expectedText.replace(/\s+/g, '');
  const actualChars = actualText.replace(/\s+/g, '');
  if (!expectedChars || actualChars !== expectedChars) return anchor;
  if (!isSubtitleText(actualText)) return anchor;

  const groupRect = group.getBoundingClientRect();
  if (groupRect.width <= 0 || groupRect.height <= 0) return anchor;
  const tb = measureGlyphBounds(group);
  const textWidth = tb ? tb.width : groupRect.width;
  const textHeight = tb ? tb.height : groupRect.height;
  if (videoRect) {
    if (textWidth > videoRect.width * 0.95) return anchor;
    if (textHeight > videoRect.height * 0.40) return anchor;
  } else if (textHeight > window.innerHeight * 0.40) {
    return anchor;
  }
  return group;
}