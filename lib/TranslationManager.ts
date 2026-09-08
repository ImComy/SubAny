import type {
  TranslateRequestMessage,
  TranslateResponseMessage,
  TranslationEngine,
} from './types';

export class TranslationManager {
  private readonly memoryCache = new Map<string, string>();

  async translate(
    text: string,
    target: string,
    source = 'auto',
    engine?: TranslationEngine,
  ): Promise<{ translation: string; engineUsed: string }> {
    const clean = text.trim();
    if (!clean) return { translation: '', engineUsed: 'empty' };

    const cacheKey = `${engine || 'default'}:${source}->${target}:${clean.toLowerCase()}`;
    if (this.memoryCache.has(cacheKey)) {
      return { translation: this.memoryCache.get(cacheKey)!, engineUsed: 'cache' };
    }

    try {
      const response = (await browser.runtime.sendMessage({
        action: 'translate',
        text: clean,
        target,
        source,
        engine,
      } as TranslateRequestMessage)) as TranslateResponseMessage;

      if (response && response.translation) {
        this.memoryCache.set(cacheKey, response.translation);
        return {
          translation: response.translation,
          engineUsed: response.engineUsed || 'unknown',
        };
      }
      return { translation: clean, engineUsed: 'none' };
    } catch {
      return { translation: clean, engineUsed: 'error' };
    }
  }

  clearCache() {
    this.memoryCache.clear();
  }
}
