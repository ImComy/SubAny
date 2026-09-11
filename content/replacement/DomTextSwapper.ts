// replacement/DomTextSwapper.ts

/**
 * In-place DOM text swapper.
 *
 * Replaces the visible text of a subtitle container with a translation and
 * can restore the original text. Uses a Map<Text, string> so restore is exact
 * even when the player mutates/rebuilds surrounding nodes.
 */
export class DomTextSwapper {
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
      if (node.parentNode) node.textContent = original;
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