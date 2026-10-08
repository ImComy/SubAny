// detection/CandidateScorer.ts

import { normalizeSubtitleText, isSubtitleText, isPlaybackTimeText } from '../../utils/text';
import { getDomDepth, measureGlyphBounds } from '../../utils/dom';

export interface CandidateScore {
  element: HTMLElement;
  score: number;
  reasons: string[];
}

export function hasSubtitleClass(el: HTMLElement): boolean {
  const id = el.id || '';
  const cls = (el.className || '').toString();
  return /(subtitle|sub|captions|cc|cue|translation|track|vtt|timed-text|player-caption)/i.test(id + cls);
}

export function getInteractiveControlCount(el: HTMLElement): number {
  return el.querySelectorAll(
    'button, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]'
  ).length;
}

export function isDirectInteractiveElement(el: HTMLElement): boolean {
  return el.matches(
    'button, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]'
  );
}

export function isPlayerControlRegion(el: HTMLElement, videoRect: DOMRect | null = null): boolean {
  if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return true;

  if (isDirectInteractiveElement(el) || el.closest(
    'button, input, select, textarea, [role="button"], [role="slider"], [role="progressbar"], [contenteditable="true"]'
  )) {
    return true;
  }

  const ownText = normalizeSubtitleText(el.textContent ?? '');
  if (isPlaybackTimeText(ownText)) return true;

  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const rect = current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const controls = getInteractiveControlCount(current);
      if (controls >= 2) {
        const style = getComputedStyle(current);
        const pointerEvents = style.pointerEvents;
        const positioned = style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky';
        const bottomReference = videoRect && videoRect.height > 0 ? videoRect.bottom : window.innerHeight;
        const topReference = videoRect?.top ?? 0;
        const heightReference = videoRect?.height ?? window.innerHeight;
        const compact = rect.height <= Math.max(180, heightReference * 0.40);
        const touchesBottom = rect.bottom >= bottomReference - Math.max(12, heightReference * 0.05);
        const insideVerticalBand = rect.bottom >= topReference + heightReference * 0.55;
        const candidateRect = el.getBoundingClientRect();
        const candidateInside =
          candidateRect.left >= rect.left - 8 &&
          candidateRect.right <= rect.right + 8 &&
          candidateRect.top >= rect.top - 8 &&
          candidateRect.bottom <= rect.bottom + 8;

        if (pointerEvents !== 'none' && positioned && compact && touchesBottom && insideVerticalBand && candidateInside) {
          return true;
        }
      }
    }
    current = current.parentElement;
  }

  return false;
}

export function getSubtitlePresentationAncestor(el: HTMLElement, videoRect: DOMRect | null): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = getComputedStyle(current);
    if (style.pointerEvents === 'none' && (style.position === 'absolute' || style.position === 'fixed')) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (!videoRect || (
          rect.right >= videoRect.left &&
          rect.left <= videoRect.right &&
          rect.bottom >= videoRect.top &&
          rect.top <= videoRect.bottom
        )) {
          const controls = getInteractiveControlCount(current);
          if (controls === 0) return current;
        }
      }
    }
    current = current.parentElement;
  }
  return null;
}

export function scoreSubtitleCandidate(el: HTMLElement): CandidateScore | null {
  const text = normalizeSubtitleText(el.textContent ?? '');
  if (!text || !isSubtitleText(text)) return null;
  if (isPlayerControlRegion(el)) return null;

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
    score += 15; reasons.push('good-width');
  } else if (widthRatio >= 0.9) {
    if (!isCentered || fontSize < 20) { score -= 20; reasons.push('too-wide'); }
    else { score += 5; reasons.push('wide-but-centred'); }
  } else {
    if (!isCue) {
      const words = text.split(/\s+/).length;
      if (words > 1) score -= 5;
      reasons.push('too-narrow');
    } else { score += 5; reasons.push('narrow-cue'); }
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

  // 6. Strong cue class bonus
  if (isCue) { score += 80; reasons.push('cue-class'); }

  // 7. Parent with absolute/fixed + bottom
  if (el.parentElement) {
    const parentStyle = getComputedStyle(el.parentElement);
    if (parentStyle.position === 'absolute' || parentStyle.position === 'fixed') {
      const pBottom = parseFloat(parentStyle.bottom);
      if (!isNaN(pBottom) && pBottom >= 0) { score += 15; reasons.push('parent-abs-bottom'); }
    }
  }

  // 8. Punctuation and capitalisation
  if (/[.!?…]/.test(text)) { score += 5; reasons.push('punctuation'); }
  if (/^[A-ZÀ-Ö]/.test(text)) { score += 3; reasons.push('capitalized'); }

  // 9. Leaf / line detection
  const childNodes = Array.from(el.childNodes);
  const hasOnlyTextOrBr = childNodes.every(
    (node) => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR')
  );
  const isInlineLine = el.children.length > 0 && Array.from(el.children).every((child) => {
    const cTag = child.tagName.toLowerCase();
    return ['span', 'b', 'i', 'em', 'strong', 'mark', 'font', 'ruby', 'rt', 'a', 'br'].includes(cTag);
  });
  const hasMultipleSubtitleChildren =
    el.children.length > 1 &&
    Array.from(el.children).some((child) => isSubtitleText((child.textContent ?? '').trim())) &&
    Array.from(el.children).every((child) => {
      const c = child as HTMLElement;
      const cText = (c.textContent ?? '').trim();
      return (!cText || isSubtitleText(cText)) && c.querySelectorAll('button, input, select, video, audio, canvas').length === 0;
    });
  const isMultiLineBlock = isInlineLine || hasMultipleSubtitleChildren;

  if (hasOnlyTextOrBr) { score += 50; reasons.push('leaf-like'); }
  else if (el.children.length === 0) { score += 50; reasons.push('leaf-element'); }
  else if (isMultiLineBlock) { score += 50; reasons.push('subtitle-block-container'); }

  // 10. Penalty for multiple element children
  if (!isMultiLineBlock) {
    if (el.children.length > 1 && !hasOnlyTextOrBr) { score -= 25; reasons.push('multiple-children'); }
    else if (el.children.length > 0 && !hasOnlyTextOrBr) { score -= 15; reasons.push('has-children'); }
  }

  // 11. Penalty for pointer-events: none
  if (style.pointerEvents === 'none') { score -= 50; reasons.push('pointer-events-none'); }

  // 12. Penalty for being too large
  const tb = measureGlyphBounds(el);
  const contentWidth = tb ? tb.width : rect.width;
  const contentHeight = tb ? tb.height : rect.height;
  if (contentWidth > viewportWidth * 0.7) { score -= 40; reasons.push('too-wide-container'); }
  if (contentHeight > viewportHeight * 0.2) { score -= 30; reasons.push('too-tall-container'); }

  // 13. Penalty if element has any child that is also a subtitle candidate
  const hasSubtitleChild = Array.from(el.children).some((child) => {
    const childText = (child as HTMLElement).textContent?.trim() || '';
    return isSubtitleText(childText) && hasSubtitleClass(child as HTMLElement);
  });
  if (hasSubtitleChild && !isMultiLineBlock) { score -= 40; reasons.push('has-subtitle-child'); }

  return { element: el, score, reasons };
}