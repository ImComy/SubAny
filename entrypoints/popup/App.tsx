import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SUPPORTED_LANGUAGES,
  type ExtensionSettings,
  type TranslationEngine,
  type TriggerMode,
} from '../../lib/types';
import './style.css';

export default function App() {
  const [activeTab, setActiveTab] = useState<'translate' | 'settings'>('translate');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tabContainerStatus, setTabContainerStatus] = useState<{
    hasLockedContainer: boolean;
    selector?: string | null;
  }>({ hasLockedContainer: false });
  const [isSelecting, setIsSelecting] = useState(false);

  // Load settings on startup
  useEffect(() => {
    const init = async () => {
      try {
        const stored = await browser.storage.local.get('subanySettings');
        if (stored?.subanySettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...((stored.subanySettings as Partial<ExtensionSettings>) || {}) });
        }
      } catch (err) {
        console.error(err);
      }
      void queryActiveTabStatus();
    };
    void init();
  }, []);

  const queryActiveTabStatus = async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const res = (await browser.tabs.sendMessage(tab.id, { type: 'GET_STATUS' })) as any;
        if (res) {
          setTabContainerStatus({
            hasLockedContainer: res.hasLockedContainer,
            selector: res.selector,
          });
        }
      }
    } catch {
      // Content script may not be injected yet on non-web pages
    }
  };

  const updateSetting = async <K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K],
  ) => {
    await updateSettingsBatch({ [key]: value });
  };

  const updateSettingsBatch = async (partial: Partial<ExtensionSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    try {
      await browser.storage.local.set({ subanySettings: updated });
    } catch (err) {
      console.error('Error saving setting:', err);
    }
  };

  const handleStartSelection = async () => {
    setIsSelecting(true);
    setStatusMessage('Selection mode activated! Click your video tab.');
    try {
      // Broadcast to all frames (including cross-origin video iframes) via storage
      await browser.storage.local.set({ subanyAction: { type: 'START_SELECTION', t: Date.now() } });

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await browser.tabs.sendMessage(tab.id, { type: 'START_SELECTION' });
        } catch (_) { /* may already be handled via storage */ }
      }

      setTimeout(() => {
        window.close();
      }, 500);
    } catch (err) {
      setStatusMessage('Could not start selection on this tab. Refresh page & try again.');
      setIsSelecting(false);
    }
  };

  const handleResetContainer = async () => {
    try {
      await browser.storage.local.set({ subanyAction: { type: 'RESET_SELECTION', t: Date.now() } });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await browser.tabs.sendMessage(tab.id, { type: 'RESET_SELECTION' });
        } catch (_) { /* ignore */ }
      }
      await updateSetting('lockedSelector', null);
      setTabContainerStatus({ hasLockedContainer: false, selector: null });
      setStatusMessage('Subtitle container unlocked.');
    } catch {
      setStatusMessage('Unlocked locally.');
    }
  };

  return (
    <div className="w-[360px] min-h-[470px] bg-slate-950 text-slate-100 font-sans p-5 select-none antialiased flex flex-col justify-between">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <span className="text-lg font-black text-white leading-none">S</span>
            </div>
            <div>
              <h1 className="text-base font-bold bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent leading-tight">
                SubAny
              </h1>
              <p className="text-[10px] text-cyan-400 font-semibold tracking-wider uppercase">
                Universal Video Subtitles
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('translate')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'translate'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Translate
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Settings
            </button>
          </div>
        </div>

        {/* Tab 1: Translate */}
        {activeTab === 'translate' && (
          <div className="mt-4 space-y-3">
            {/* Target Language Dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Target Language</span>
                <span className="text-[10px] text-cyan-400 font-normal">
                  {SUPPORTED_LANGUAGES.find((l) => l.code === settings.targetLanguage)?.nativeName}
                </span>
              </label>
              <div className="relative">
                <select
                  value={settings.targetLanguage}
                  onChange={(e) => updateSetting('targetLanguage', e.target.value)}
                  className="w-full appearance-none bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 font-medium focus:outline-none focus:border-cyan-500 transition-all cursor-pointer shadow-inner"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                      {lang.name} ({lang.nativeName})
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Subtitle Translation Mode */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Translation Mode
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'hover', label: 'Hover Word', icon: '👆', desc: 'Hover & lookup pill' },
                  { id: 'click', label: 'Click Word', icon: '🖱️', desc: 'Click to translate' },
                  { id: 'full-auto', label: 'Bilingual Line', icon: '⚡', desc: 'Live dual subtitles' },
                  { id: 'replace-native', label: 'In-Place Swap', icon: '✨', desc: 'Replaces original' },
                ].map((mode) => {
                  const isSelected =
                    (mode.id === 'replace-native' && (settings.triggerMode === 'replace-native' || settings.replaceNativeSubtitles)) ||
                    (mode.id !== 'replace-native' && settings.triggerMode === mode.id && !settings.replaceNativeSubtitles);

                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        if (mode.id === 'replace-native') {
                          void updateSettingsBatch({
                            triggerMode: 'replace-native',
                            replaceNativeSubtitles: true,
                          });
                        } else {
                          void updateSettingsBatch({
                            triggerMode: mode.id as TriggerMode,
                            replaceNativeSubtitles: false,
                          });
                        }
                      }}
                      className={`p-2 rounded-xl border text-left font-semibold transition ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/20'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span>{mode.icon}</span>
                        <span>{mode.label}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{mode.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Translation Engine Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Free Translation API</span>
                <span className="text-[10px] text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded-full">
                  No Key Needed
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'google-gtx', name: 'Google (GTX)', desc: 'Fast & Reliable' },
                  { id: 'libretranslate', name: 'LibreTranslate', desc: 'Open-Source' },
                  { id: 'mymemory', name: 'MyMemory', desc: 'Multi-Language' },
                  { id: 'lingva', name: 'Lingva', desc: 'Fast Mirror' },
                ].map((engine) => (
                  <button
                    key={engine.id}
                    type="button"
                    onClick={() => updateSetting('engine', engine.id as TranslationEngine)}
                    className={`p-2 rounded-xl text-left border transition-all ${
                      settings.engine === engine.id
                        ? 'bg-cyan-950/40 border-cyan-500/70 text-cyan-300 shadow-sm shadow-cyan-500/20'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold leading-tight">{engine.name}</div>
                    <div className="text-[10px] text-slate-400">{engine.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pro Tip: Shift Multi-word selection */}
            <div className="bg-cyan-950/30 border border-cyan-500/25 rounded-xl px-3 py-2 flex items-center gap-2">
              <span className="text-sm">💡</span>
              <p className="text-[11px] text-cyan-300 leading-tight">
                <strong className="text-white font-semibold">Pro Tip:</strong> Hold{' '}
                <kbd className="px-1 py-0.5 bg-slate-800 border border-cyan-500/40 rounded text-[10px] font-mono text-cyan-200">
                  Shift
                </kbd>{' '}
                while hovering or clicking to translate whole phrases & sentences!
              </p>
            </div>

            {/* Action Card: Select Subtitles */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={handleStartSelection}
                disabled={isSelecting}
                className="w-full relative group overflow-hidden rounded-xl p-[1px] font-semibold text-sm transition-all transform active:scale-[0.98] shadow-lg shadow-cyan-500/20 cursor-pointer"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-xl" />
                <div className="relative px-4 py-2.5 bg-slate-950 rounded-[11px] flex items-center justify-center gap-2 group-hover:bg-opacity-80 transition">
                  <span className="text-base">🎯</span>
                  <span className="text-white font-bold tracking-wide">
                    Select Subtitles on Page
                  </span>
                </div>
              </button>
            </div>

            {/* Live Container Status Badge */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <div
                  className={`w-2 h-2 rounded-full ${
                    tabContainerStatus.hasLockedContainer || settings.lockedSelector
                      ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                      : 'bg-amber-400'
                  }`}
                />
                <div className="truncate">
                  <p className="font-semibold text-slate-200">
                    {tabContainerStatus.hasLockedContainer || settings.lockedSelector
                      ? 'Subtitles Tracked'
                      : 'Auto-Detection Active'}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {settings.lockedSelector ? settings.lockedSelector : 'Ready for any video player'}
                  </p>
                </div>
              </div>

              {(tabContainerStatus.hasLockedContainer || settings.lockedSelector) && (
                <button
                  type="button"
                  onClick={handleResetContainer}
                  className="px-2 py-1 text-[11px] font-semibold text-rose-400 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 rounded-lg transition"
                >
                  Unlock
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Settings */}
        {activeTab === 'settings' && (
          <div className="mt-4 space-y-3 text-xs max-h-[350px] overflow-y-auto pr-1">
            {/* Toggles */}
            <div className="space-y-2 pt-1 border-t border-slate-800/80">
              {/* Replace Original Subtitles (In-Place) */}
              <label className="flex items-center justify-between p-2 rounded-xl bg-cyan-950/20 border border-cyan-900/40 cursor-pointer hover:bg-cyan-950/30 transition">
                <div>
                  <div className="font-semibold text-cyan-200">Replace Original Subtitles</div>
                  <div className="text-[10px] text-slate-400">
                    Seamlessly replaces original text matching exact styles
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.replaceNativeSubtitles || settings.triggerMode === 'replace-native'}
                  onChange={(e) => {
                    if (e.target.checked) {
                      void updateSettingsBatch({
                        replaceNativeSubtitles: true,
                        triggerMode: 'replace-native',
                      });
                    } else {
                      void updateSettingsBatch({
                        replaceNativeSubtitles: false,
                        triggerMode: 'hover',
                      });
                    }
                  }}
                  className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                />
              </label>

              {/* Pause Video on Hover */}
              <label className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 cursor-pointer hover:bg-slate-900 transition">
                <div>
                  <div className="font-semibold text-slate-200">Pause Video on Hover</div>
                  <div className="text-[10px] text-slate-400">
                    Auto-pause video while reading translation
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.pauseVideoOnHover}
                  onChange={(e) => updateSetting('pauseVideoOnHover', e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                />
              </label>

              {/* Glow Visual Feedback */}
              <label className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/80 cursor-pointer hover:bg-slate-900 transition">
                <div>
                  <div className="font-semibold text-slate-200">Glowing Detection Effect</div>
                  <div className="text-[10px] text-slate-400">
                    Radiant pulse animation when subtitle is locked
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.enableGlowEffect}
                  onChange={(e) => updateSetting('enableGlowEffect', e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Footer Status Message */}
      {statusMessage && (
        <div className="mt-2 p-2 bg-slate-900/90 border border-cyan-500/30 rounded-xl text-[11px] text-cyan-300 text-center animate-fade-in">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
