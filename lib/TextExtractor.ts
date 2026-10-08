// -----------------------------------------------------------------------
// TextExtractor — clean API surface used by content.tsx
// -----------------------------------------------------------------------

export interface TextExtractionResult {
  text: string;
  rect: DOMRect | null;
  /** Determines which highlight style SubtitleOverlay uses */
  mode: 'word' | 'phrase' | 'range';
}

const EMPTY: TextExtractionResult = { text: '', rect: null, mode: 'word' };

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function isTextCaret(caret: CaretPosition | Range | null): boolean {
  if (!caret) return false;
  if ('offsetNode' in caret) {
    return (caret as CaretPosition).offsetNode?.nodeType === Node.TEXT_NODE;
  }
  const r = caret as Range;
  return r.startContainer?.nodeType === Node.TEXT_NODE;
}

function extractTextCaret(caret: CaretPosition | Range): { node: Text; offset: number } {
  if ('offsetNode' in caret) {
    const { offsetNode, offset } = caret as CaretPosition;
    return { node: offsetNode as Text, offset };
  }
  const r = caret as Range;
  return { node: r.startContainer as Text, offset: r.startOffset };
}

function getCaretInfo(x: number, y: number): { node: Text; offset: number } | null {
  let caret =
    document.caretPositionFromPoint?.(x, y) ??
    document.caretRangeFromPoint?.(x, y);
  if (isTextCaret(caret)) {
    return extractTextCaret(caret!);
  }

  // Pierce transparent overlays if top element is an empty overlay / video player click-catcher
  const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []) as HTMLElement[];
  const disabledList: Array<{ el: HTMLElement; prev: string }> = [];

  for (const el of stack) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'video' || tag === 'body' || tag === 'html') break;
    const text = (el.textContent ?? '').trim();
    // If element has no text, or is a root extension overlay, or is a wrapper div with pointer-events
    if (!text || el.id === 'subany-extension-root' || el.id === 'subany-pin-overlay') {
      disabledList.push({ el, prev: el.style.pointerEvents });
      el.style.pointerEvents = 'none';
    }
  }

  if (disabledList.length > 0) {
    try {
      caret =
        document.caretPositionFromPoint?.(x, y) ??
        document.caretRangeFromPoint?.(x, y);
    } finally {
      for (const item of disabledList) {
        item.el.style.pointerEvents = item.prev;
      }
    }
  }

  if (isTextCaret(caret)) {
    return extractTextCaret(caret!);
  }

  return null;
}

function wordBounds(text: string, offset: number): { start: number; end: number; word: string } | null {
  const regex = /[\p{L}\p{N}\p{M}\u200C\u200D'-]+/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      const word = match[0].replace(/^['-]+|['-]+$/g, '').trim();
      if (!word) continue;
      return { start, end, word };
    }
  }
  return null;
}

function makeRangeRect(node: Node, start: number, end: number): DOMRect | null {
  try {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r.getBoundingClientRect();
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export class TextExtractor {
  /**
   * Direct word extraction from active container's text nodes.
   * Completely immune to transparent click catchers, video wrappers, or overlay stacking.
   */
  static getWordFromContainer(container: HTMLElement, x: number, y: number): TextExtractionResult {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let closestMatch: { word: string; rect: DOMRect; dist: number } | null = null;

    const padX = 8;
    const padY = 6;

    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      if (!text.trim()) continue;

      const regex = /[\p{L}\p{N}\p{M}\u200C\u200D'-]+/gu;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const rect = makeRangeRect(node, start, end);
        if (rect && rect.width > 0 && rect.height > 0) {
          if (
            x >= rect.left - padX &&
            x <= rect.right + padX &&
            y >= rect.top - padY &&
            y <= rect.bottom + padY
          ) {
            const word = match[0].replace(/^['-]+|['-]+$/g, '').trim();
            if (word) {
              const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
              const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
              const dist = Math.hypot(dx, dy);
              if (!closestMatch || dist < closestMatch.dist) {
                closestMatch = { word, rect, dist };
              }
            }
          }
        }
      }
    }

    if (closestMatch) {
      return {
        text: closestMatch.word,
        rect: closestMatch.rect,
        mode: 'word',
      };
    }

    return EMPTY;
  }

  /**
   * Direct phrase extraction from active container.
   */
  static getFullPhraseFromContainer(container: HTMLElement, x: number, y: number): TextExtractionResult {
    const wordRes = this.getWordFromContainer(container, x, y);
    const DELIMITERS = /[.!?;,\u2014:\u2026]+/g;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;

    while ((node = walker.nextNode())) {
      const fullText = node.textContent ?? '';
      if (wordRes.text && fullText.includes(wordRes.text)) {
        const clauses: Array<{ start: number; end: number }> = [];
        let prev = 0;
        let m: RegExpExecArray | null;
        while ((m = DELIMITERS.exec(fullText)) !== null) {
          const delimEnd = m.index + m[0].length;
          if (delimEnd > prev) clauses.push({ start: prev, end: delimEnd });
          prev = delimEnd;
        }
        if (prev < fullText.length) clauses.push({ start: prev, end: fullText.length });

        const wordIdx = fullText.indexOf(wordRes.text);
        const clause =
          clauses.find((c) => wordIdx >= c.start && wordIdx <= c.end) ??
          { start: 0, end: fullText.length };

        const phraseText = fullText.slice(clause.start, clause.end).trim();
        if (phraseText) {
          return {
            text: phraseText,
            rect: makeRangeRect(node, clause.start, clause.end) || container.getBoundingClientRect(),
            mode: 'phrase',
          };
        }
      }
    }

    const fullContainerText = (container.textContent ?? '').trim();
    if (fullContainerText) {
      return {
        text: fullContainerText,
        rect: container.getBoundingClientRect(),
        mode: 'phrase',
      };
    }

    return wordRes.text ? wordRes : EMPTY;
  }

  /** Single word under the pointer */
  static getWord(x: number, y: number, container?: HTMLElement | null): TextExtractionResult {
    if (container) {
      const direct = this.getWordFromContainer(container, x, y);
      if (direct.text) return direct;
    }

    const info = getCaretInfo(x, y);
    if (!info) return EMPTY;
    const text = info.node.textContent ?? '';
    const bounds = wordBounds(text, info.offset);
    if (!bounds) return EMPTY;
    return {
      text: bounds.word,
      rect: makeRangeRect(info.node, bounds.start, bounds.end),
      mode: 'word',
    };
  }

  /**
   * Full phrase — text of the nearest sentence/clause delimited by
   * punctuation (. ! ? ; , — : …) inside the subtitle node.
   * Falls back to the full text-node content if no sentence boundary is found.
   */
  static getFullPhrase(x: number, y: number, container?: HTMLElement | null): TextExtractionResult {
    if (container) {
      const direct = this.getFullPhraseFromContainer(container, x, y);
      if (direct.text) return direct;
    }

    const info = getCaretInfo(x, y);
    if (!info) return EMPTY;

    const fullText = info.node.textContent ?? '';
    if (!fullText.trim()) return EMPTY;

    // Sentence-boundary delimiters (include the delimiter itself in the preceding clause)
    const DELIMITERS = /[.!?;,\u2014:\u2026]+/g;

    // Collect clause ranges [start, end) in fullText
    const clauses: Array<{ start: number; end: number }> = [];
    let prev = 0;
    let m: RegExpExecArray | null;
    while ((m = DELIMITERS.exec(fullText)) !== null) {
      const delimEnd = m.index + m[0].length;
      if (delimEnd > prev) clauses.push({ start: prev, end: delimEnd });
      prev = delimEnd;
    }
    // Trailing clause after last delimiter
    if (prev < fullText.length) clauses.push({ start: prev, end: fullText.length });

    // Which clause contains the caret offset?
    const clause =
      clauses.find((c) => info.offset >= c.start && info.offset <= c.end) ??
      { start: 0, end: fullText.length };

    const phraseText = fullText.slice(clause.start, clause.end).trim();
    if (!phraseText) return EMPTY;

    return {
      text: phraseText,
      rect: makeRangeRect(info.node, clause.start, clause.end),
      mode: 'phrase',
    };
  }

  /**
 * Shift-range: from anchor word to current word, snapping both ends
 * to whole-word boundaries (not raw caret offsets).
 */
  static getRangeBetweenPoints(
    anchorX: number,
    anchorY: number,
    currentX: number,
    currentY: number,
  ): TextExtractionResult {
    const start = getCaretInfo(anchorX, anchorY);
    const end = getCaretInfo(currentX, currentY);
    if (!start || !end) return EMPTY;

    // Snap both ends to word boundaries within their respective text nodes
    const snapWordStart = (text: string, offset: number): number => {
      let i = offset;
      while (i > 0 && /[\p{L}\p{N}\p{M}'\-]/u.test(text[i - 1]!)) i--;
      return i;
    };
    const snapWordEnd = (text: string, offset: number): number => {
      let i = offset;
      while (i < text.length && /[\p{L}\p{N}\p{M}'\-]/u.test(text[i]!)) i++;
      return i;
    };

    const startText = start.node.textContent ?? '';
    const endText = end.node.textContent ?? '';
    const startOffset = snapWordStart(startText, start.offset);
    const endOffset = snapWordEnd(endText, end.offset);

    try {
      const range = document.createRange();

      // Determine document order
      const cmp = start.node.compareDocumentPosition(end.node);
      const isSameNode = cmp === 0;
      const startIsFirst =
        isSameNode
          ? startOffset <= endOffset
          : !!(cmp & Node.DOCUMENT_POSITION_FOLLOWING);

      if (startIsFirst) {
        range.setStart(start.node, startOffset);
        range.setEnd(end.node, isSameNode ? endOffset : snapWordEnd(endText, end.offset));
      } else {
        range.setStart(end.node, snapWordStart(endText, end.offset));
        range.setEnd(start.node, snapWordEnd(startText, start.offset));
      }

      const text = range.toString().trim();
      if (!text) return EMPTY;
      return { text, rect: range.getBoundingClientRect(), mode: 'range' };
    } catch {
      return EMPTY;
    }
  }

}
