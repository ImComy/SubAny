export type TranslationEngine = 'google-gtx' | 'libretranslate' | 'mymemory' | 'lingva';

export type TriggerMode = 'hover' | 'click' | 'full-auto' | 'replace-native';
export type SubtitleProviderId = 'opensubtitles' | 'subdl';

export interface ExtensionSettings {
  settingsSchemaVersion: number;
  targetLanguage: string;
  sourceLanguage: string;
  engine: TranslationEngine;
  triggerMode: TriggerMode;
  pauseVideoOnHover: boolean;
  enableGlowEffect: boolean;
  replaceNativeSubtitles: boolean;
  lockedSelector: string | null;
  subtitleProvider: SubtitleProviderId;
  subtitleApiKey: string;
  subtitleDelayMs: number;
  subtitleEnabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  settingsSchemaVersion: 1,
  targetLanguage: 'ar',
  sourceLanguage: 'auto',
  engine: 'google-gtx',
  triggerMode: 'hover',
  pauseVideoOnHover: true,
  enableGlowEffect: true,
  replaceNativeSubtitles: false,
  lockedSelector: null,
  subtitleProvider: 'opensubtitles',
  subtitleApiKey: '',
  subtitleDelayMs: 0,
  subtitleEnabled: true,
};

export interface TranslateRequestMessage {
  action: 'translate';
  text: string;
  target?: string;
  source?: string;
  engine?: TranslationEngine;
}

export interface TranslateResponseMessage {
  text: string;
  translation: string;
  source: string;
  engineUsed: string;
  error?: string;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
];
