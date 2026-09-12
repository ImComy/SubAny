import type {
  TranslateRequestMessage,
  TranslateResponseMessage,
  TranslationEngine,
} from './types';

export class TranslationManager {
  private static readonly MAX_CACHE_ENTRIES = 256;
  private readonly memoryCache = new Map<string, string>();
  private readonly pending = new Map<string, Promise<{ translation: string; engineUsed: string }>>();

  async translate(
    text: string,
    target: string,
    source = 'auto',
    engine?: TranslationEngine,
  ): Promise<{ translation: string; engineUsed: string }> {
    const clean = text.trim();
    if (!clean) return { translation: '', engineUsed: 'empty' };

    const cacheKey = `${engine || 'default'}:${source}->${target}:${clean}`;
    const cached = this.memoryCache.get(cacheKey);
    if (cached !== undefined) {
      this.memoryCache.delete(cacheKey);
      this.memoryCache.set(cacheKey, cached);
      return { translation: cached, engineUsed: 'cache' };
    }

    const pending = this.pending.get(cacheKey);
    if (pending) return pending;

    const request = this.requestTranslation(clean, target, source, engine, cacheKey);
    this.pending.set(cacheKey, request);
    return request.finally(() => this.pending.delete(cacheKey));
  }

  private async requestTranslation(
    clean: string,
    target: string,
    source: string,
    engine: TranslationEngine | undefined,
    cacheKey: string,
  ): Promise<{ translation: string; engineUsed: string }> {
    try {
      const response = (await browser.runtime.sendMessage({ action: 'translate', text: clean, target, source, engine } as TranslateRequestMessage)) as TranslateResponseMessage;

      if (response && response.translation) {
        this.memoryCache.set(cacheKey, response.translation);
        while (this.memoryCache.size > TranslationManager.MAX_CACHE_ENTRIES) {
          this.memoryCache.delete(this.memoryCache.keys().next().value!);
        }
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
    this.pending.clear();
  }
}
