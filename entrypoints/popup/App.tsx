import { useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SUPPORTED_LANGUAGES,
  type ExtensionSettings,
  type TranslationEngine,
  type TriggerMode,
} from '../../lib/types';
import type { SubtitleSearchResult } from '../../content/subtitles';
import './style.css';

/**
 * Send a message to every frame in a tab, not just the top frame.
 *
 * Required for sites where the <video> lives in a cross-origin iframe
 * (e.g. videasy.to): `chrome.tabs.sendMessage(tabId, msg)` without a
 * `frameId` targets only frame 0, so the iframe's content script never
 * receives the message.
 *
 * Tries `chrome.webNavigation.getAllFrames` first (needs the `webNavigation`
 * permission). If that's unavailable, falls back to sending to frameId 0
 * through 15 and ignoring the misses — cheap and permission-free.
 */
async function sendToAllFrames(tabId: number, message: { type: string }): Promise<void> {
  try {
    const wnav = (browser as unknown as { webNavigation?: { getAllFrames?: (q: { tabId: number }) => Promise<Array<{ frameId: number }>> } }).webNavigation;
    if (wnav?.getAllFrames) {
      const frames = await wnav.getAllFrames({ tabId });
      if (Array.isArray(frames) && frames.length > 0) {
        await Promise.all(
          frames.map((f) =>
            browser.tabs.sendMessage(tabId, message, { frameId: f.frameId }).catch(() => {}),
          ),
        );
        return;
      }
    }
  } catch {
    // webNavigation not granted or API error — fall through to range send.
  }

  const sends: Promise<unknown>[] = [];
  for (let frameId = 0; frameId < 16; frameId++) {
    sends.push(browser.tabs.sendMessage(tabId, message, { frameId }).catch(() => {}));
  }
  await Promise.all(sends);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'translate' | 'subtitles' | 'settings'>('translate');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tabContainerStatus, setTabContainerStatus] = useState<{
    hasLockedContainer: boolean;
    selector?: string | null;
  }>({ hasLockedContainer: false });
  const [isSelecting, setIsSelecting] = useState(false);
  const [subtitleQuery, setSubtitleQuery] = useState('');
  const [subtitleResults, setSubtitleResults] = useState<SubtitleSearchResult[]>([]);
  const [subtitleBusy, setSubtitleBusy] = useState(false);

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
        // Status can come from any frame — try top first, then broadcast.
        let res: { hasLockedContainer?: boolean; selector?: string | null } | undefined;
        try {
          res = (await browser.tabs.sendMessage(tab.id, { type: 'GET_STATUS' })) as typeof res;
        } catch {
          // Top frame didn't answer — try all frames and take the first reply.
          const framesRes = await Promise.all(
            Array.from({ length: 16 }, (_, frameId) =>
              browser.tabs
                .sendMessage(tab.id!, { type: 'GET_STATUS' }, { frameId })
                .catch(() => undefined),
            ),
          );
          res = framesRes.find((r) => r && typeof r === 'object') as typeof res;
        }
        if (res) {
          setTabContainerStatus({
            hasLockedContainer: !!res.hasLockedContainer,
            selector: res.selector ?? null,
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
    setStatusMessage('Selection mode activated! Click a subtitle in the video.');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');

      // Primary path: explicit per-frame message. Required for cross-origin
      // iframe players (videasy.to, embedded players, etc.).
      await sendToAllFrames(tab.id, { type: 'START_SELECTION' });

      // Redundant broadcast via storage. Some frames may not be reachable
      // through tabs.sendMessage if their listener is added after our send.
      await browser.storage.local.set({
        subanyAction: { type: 'START_SELECTION', t: Date.now() },
      });

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
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await sendToAllFrames(tab.id, { type: 'RESET_SELECTION' });
      }
      await browser.storage.local.set({
        subanyAction: { type: 'RESET_SELECTION', t: Date.now() },
      });
      await updateSetting('lockedSelector', null);
      setTabContainerStatus({ hasLockedContainer: false, selector: null });
      setStatusMessage('Subtitle container unlocked.');
    } catch {
      setStatusMessage('Unlocked locally.');
    }
  };

  const searchSubtitles = async () => {
    if (!subtitleQuery.trim()) return;
    setSubtitleBusy(true);
    setStatusMessage(null);
    try {
      const response = await browser.runtime.sendMessage({
        action: 'subtitle-search',
        request: { query: subtitleQuery.trim(), language: settings.sourceLanguage === 'auto' ? 'en' : settings.sourceLanguage, provider: settings.subtitleProvider },
      }) as { ok: boolean; result?: SubtitleSearchResult[]; error?: string };
      if (!response.ok) throw new Error(response.error || 'Subtitle search failed.');
      setSubtitleResults(response.result || []);
      setStatusMessage(`${response.result?.length || 0} subtitle tracks found.`);
    } catch (error: any) {
      setStatusMessage(error?.message || 'Subtitle search failed.');
    } finally {
      setSubtitleBusy(false);
    }
  };

  const applySubtitle = async (result: SubtitleSearchResult) => {
    setSubtitleBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ action: 'subtitle-download', result }) as { ok: boolean; result?: unknown; error?: string };
      if (!response.ok || !response.result) throw new Error(response.error || 'Subtitle download failed.');
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active video tab found.');
      await browser.storage.local.set({
        subanySubtitleTrack: { track: response.result, t: Date.now() },
      });
      setStatusMessage('Subtitle track applied to the active video.');
    } catch (error: any) {
      setStatusMessage(error?.message || 'Could not apply subtitle track.');
    } finally {
      setSubtitleBusy(false);
    }
  };

  return (
    <div className="w-[360px] min-h-[470px] bg-slate-950 text-slate-100 font-sans p-5 select-none antialiased flex flex-col justify-between">
      {/* Top Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.svg"
              alt="SubAny"
              className="w-8 h-8 object-contain drop-shadow-[0_2px_8px_rgba(63,120,247,0.35)]"
            />
            <div>
              <h1 className="text-base font-bold bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent leading-tight">
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
              onClick={() => setActiveTab('subtitles')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'subtitles'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Subtitles
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

        {activeTab === 'subtitles' && (
          <div className="mt-4 space-y-3 text-xs">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Subtitle provider</label>
              <select
                value={settings.subtitleProvider}
                onChange={(e) => updateSetting('subtitleProvider', e.target.value as ExtensionSettings['subtitleProvider'])}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100"
              >
                <option value="opensubtitles">OpenSubtitles</option>
                <option value="subdl">SubDL</option>
              </select>
            </div>
            <input
              type="password"
              value={settings.subtitleApiKey}
              onChange={(e) => updateSetting('subtitleApiKey', e.target.value)}
              placeholder="Provider API key"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <div className="flex gap-2">
              <input
                value={subtitleQuery}
                onChange={(e) => setSubtitleQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void searchSubtitles(); }}
                placeholder="Movie or series title"
                className="min-w-0 flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              <button type="button" onClick={() => void searchSubtitles()} disabled={subtitleBusy} className="px-3 rounded-xl bg-cyan-600 text-white font-semibold disabled:opacity-50">
                Search
              </button>
            </div>
            <div className="space-y-1.5 max-h-[170px] overflow-y-auto">
              {subtitleResults.map((result) => (
                <button key={`${result.provider}-${result.id}`} type="button" onClick={() => void applySubtitle(result)} disabled={subtitleBusy} className="w-full text-left p-2 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-cyan-500/60 disabled:opacity-50">
                  <div className="font-semibold text-slate-200 truncate">{result.title}</div>
                  <div className="text-[10px] text-slate-400">{result.language} · {result.format.toUpperCase()} · {result.provider}</div>
                </button>
              ))}
            </div>
            <label className="block p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <div className="flex justify-between font-semibold text-slate-200">
                <span>Timing adjustment</span>
                <span className="text-cyan-300">{settings.subtitleDelayMs > 0 ? `+${settings.subtitleDelayMs}` : settings.subtitleDelayMs} ms</span>
              </div>
              <input type="range" min="-5000" max="5000" step="100" value={settings.subtitleDelayMs} onChange={(e) => updateSetting('subtitleDelayMs', Number(e.target.value))} className="w-full accent-cyan-500 mt-2" />
              <div className="flex justify-between text-[10px] text-slate-500"><span>Earlier</span><span>Later</span></div>
            </label>
            <label className="flex items-center justify-between p-2 rounded-xl bg-cyan-950/20 border border-cyan-900/40">
              <span className="font-semibold text-cyan-200">Show downloaded subtitles</span>
              <input type="checkbox" checked={settings.subtitleEnabled} onChange={(e) => updateSetting('subtitleEnabled', e.target.checked)} className="w-4 h-4 accent-cyan-500" />
            </label>
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