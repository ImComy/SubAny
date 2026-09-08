import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type TranslateRequestMessage,
  type TranslateResponseMessage,
  type TranslationEngine,
} from '../lib/types';

// In-memory cache for ultra-fast repetitive hover lookups
const memoryCache = new Map<string, string>();

async function getStoredSettings(): Promise<ExtensionSettings> {
  try {
    const raw = await browser.storage.local.get('subanySettings');
    return { ...DEFAULT_SETTINGS, ...((raw?.subanySettings as Partial<ExtensionSettings>) || {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function translateGoogleGTX(text: string, target: string, source: string = 'auto'): Promise<string> {
  const sl = source === 'auto' ? 'auto' : source;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: '*/*',
    },
  });

  if (!res.ok) {
    throw new Error(`Google GTX HTTP ${res.status}`);
  }

  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const fullTranslation = data[0]
      .map((item: any) => (Array.isArray(item) && typeof item[0] === 'string' ? item[0] : ''))
      .join('');
    if (fullTranslation.trim()) return fullTranslation.trim();
  }

  throw new Error('Invalid Google GTX response format');
}

async function translateLibre(text: string, target: string, source: string = 'auto'): Promise<string> {
  const mirrors = [
    'https://libretranslate.com/translate',
    'https://translate.terraprint.co/translate',
    'https://translate.argosopentech.com/translate',
  ];

  let lastError: Error | null = null;
  const src = source === 'auto' ? 'auto' : source;

  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: src,
          target,
          format: 'text',
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json?.translatedText) {
          return json.translatedText.trim();
        }
      }
    } catch (e: any) {
      lastError = e;
    }
  }

  throw lastError || new Error('LibreTranslate mirrors failed');
}

async function translateMyMemory(text: string, target: string, source: string = 'auto'): Promise<string> {
  const src = source === 'auto' ? 'en' : source;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(target)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MyMemory HTTP ${res.status}`);
  }

  const json = await res.json();
  const candidate = json?.responseData?.translatedText || json?.matches?.[0]?.translation;
  if (candidate && !candidate.startsWith('MYMEMORY WARNING')) {
    return candidate.trim();
  }

  throw new Error('MyMemory invalid or rate-limited response');
}

async function translateLingva(text: string, target: string, source: string = 'auto'): Promise<string> {
  const src = source === 'auto' ? 'auto' : source;
  const url = `https://lingva.ml/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(target)}/${encodeURIComponent(text)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Lingva HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json?.translation) {
    return json.translation.trim();
  }

  throw new Error('Lingva response missing translation');
}

async function executeTranslation(
  text: string,
  target: string,
  source: string,
  preferredEngine: TranslationEngine,
): Promise<{ translation: string; engineUsed: string }> {
  const clean = text.trim();
  if (!clean) return { translation: '', engineUsed: 'empty' };

  const cacheKey = `${preferredEngine}:${source}->${target}:${clean.toLowerCase()}`;
  if (memoryCache.has(cacheKey)) {
    return { translation: memoryCache.get(cacheKey)!, engineUsed: 'cache' };
  }

  // Ordered fallback engines
  const allEngines: TranslationEngine[] = ['google-gtx', 'libretranslate', 'mymemory', 'lingva'];
  const engineOrder: TranslationEngine[] = [
    preferredEngine,
    ...allEngines.filter((e) => e !== preferredEngine),
  ];

  let lastErrorMsg = '';

  for (const engine of engineOrder) {
    try {
      let result = '';
      if (engine === 'google-gtx') {
        result = await translateGoogleGTX(clean, target, source);
      } else if (engine === 'libretranslate') {
        result = await translateLibre(clean, target, source);
      } else if (engine === 'mymemory') {
        result = await translateMyMemory(clean, target, source);
      } else if (engine === 'lingva') {
        result = await translateLingva(clean, target, source);
      }

      if (result) {
        memoryCache.set(cacheKey, result);
        return { translation: result, engineUsed: engine };
      }
    } catch (err: any) {
      lastErrorMsg = err?.message || String(err);
    }
  }

  return { translation: clean, engineUsed: `failed: ${lastErrorMsg}` };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (rawMessage: any, _sender, sendResponse) => {
      if (rawMessage && typeof rawMessage === 'object' && rawMessage.action === 'translate') {
        const message = rawMessage as TranslateRequestMessage;
        const text = String(message.text ?? '').trim();
        if (!text) {
          sendResponse({ text: '', translation: '', source: '', engineUsed: 'empty' });
          return true;
        }

        void (async () => {
          const settings = await getStoredSettings();
          const target = message.target || settings.targetLanguage || 'ar';
          const source = message.source || settings.sourceLanguage || 'auto';
          const engine = message.engine || settings.engine || 'google-gtx';

          const { translation, engineUsed } = await executeTranslation(text, target, source, engine);
          const response: TranslateResponseMessage = {
            text,
            translation,
            source,
            engineUsed,
          };
          sendResponse(response);
        })();

        return true; // Keep message channel open for async response
      }

      return undefined;
    },
  );
});
