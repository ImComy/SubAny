// detection/SubtitleGrouping.ts

import { getAllElements } from '../../utils/dom';
import { getLowestCommonHTMLElement } from '../../utils/dom';
import { normalizeSubtitleText, isSubtitleText } from '../../utils/text';
import { isPlayerControlRegion } from './CandidateScorer';

export function isUsableSubtitleLine(el: HTMLElement, videoRect: DOMRect | null): boolean {
  if (!el || el.id === 'subany-extension-root' || el.id?.startsWith('subany-')) return false;

  const rawText = normalizeSubtitleText(el.innerText || el.textContent || '');
  if (!rawText || !isSubtitleText(rawText)) return false;
  if (isPlayerControlRegion(el)) return false;

  const tag = el.tagName.toLowerCase();
  if (['video', 'audio', 'canvas', 'svg', 'path', 'button', 'input', 'select', 'textarea'].includes(tag)) return false;

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

  const aCenterY = a.top + a.height / 2;
  const bCenterY = b.top + b.height / 2;
  const verticalGap = Math.max(0, Math.abs(aCenterY - bCenterY) - (a.height + b.height) / 2);
  const maxVerticalGap = Math.max(18, Math.max(a.height, b.height) * 1.35);
  if (verticalGap > maxVerticalGap) return false;

  const horizontalGap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  const maxHorizontalGap = Math.max(80, Math.min(a.width, b.width) * 0.45);
  if (horizontalGap > maxHorizontalGap) return false;

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

  if (aStyle.textAlign === bStyle.textAlign && aStyle.textAlign === 'center') return true;

  const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return horizontalOverlap >= Math.min(a.width, b.width) * 0.18;
}

export function combineSubtitleLines(anchor: HTMLElement, videoRect: DOMRect | null): HTMLElement {
  if (!isUsableSubtitleLine(anchor, videoRect)) return anchor;

  const allElements = getAllElements(document);
  const related: HTMLElement[] = [anchor];

  for (const candidate of allElements) {
    if (related.length >= 8) break;
    if (canBelongToSubtitleGroup(anchor, candidate, videoRect)) related.push(candidate);
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
  return group;
}