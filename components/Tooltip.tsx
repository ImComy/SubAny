import { useState } from 'react';

export interface TooltipProps {
  x: number;
  y: number;
  originalText: string;
  translatedText: string;
  engineUsed?: string;
  mode?: 'word' | 'phrase' | 'range';
  isLoading?: boolean;
  targetLang?: string;
  // legacy compat
  isPhrase?: boolean;
}

const MODE_LABELS = {
  word:   { label: 'Word',   color: '#a78bfa' },
  phrase: { label: 'Phrase', color: '#38bdf8' },
  range:  { label: 'Range',  color: '#34d399' },
} as const;

const DEFAULT_MODE_INFO = MODE_LABELS.word;

export function Tooltip({
  x,
  y,
  originalText,
  translatedText,
  engineUsed,
  mode = 'word',
  isLoading = false,
  targetLang,
  isPhrase,
}: TooltipProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Legacy compat
  const resolvedMode: 'word' | 'phrase' | 'range' = isPhrase ? 'phrase' : (mode ?? 'word');
  const modeInfo = MODE_LABELS[resolvedMode] ?? DEFAULT_MODE_INFO;

  const tooltipWidth = resolvedMode === 'word' ? 310 : 370;
  const tooltipHeight = resolvedMode === 'word' ? 110 : 135;

  const left = Math.min(Math.max(12, x + 14), window.innerWidth - tooltipWidth - 16);
  const top =
    y + tooltipHeight + 24 > window.innerHeight
      ? Math.max(12, y - tooltipHeight - 16)
      : y + 20;

  const speakText = (text: string, lang?: string) => {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang && lang !== 'auto') utterance.lang = lang;
      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsPlayingAudio(false);
    }
  };

  const isRtl = ['ar', 'fa', 'he', 'ur'].includes(targetLang ?? '');

  return (
    <div
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 2147483647,
        pointerEvents: 'auto',
        maxWidth: `${tooltipWidth}px`,
        minWidth: '220px',
        padding: '12px 15px',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.92) 100%)',
        border: `1px solid ${modeInfo.color}55`,
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        boxShadow: `0 20px 40px -10px rgba(0,0,0,0.6), 0 0 25px ${modeInfo.color}33`,
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        animation: 'subany-tooltip-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
      role="tooltip"
    >
      <style>{`
        @keyframes subany-tooltip-in {
          from { opacity: 0; transform: translateY(6px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes subany-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }}>
          {/* Mode badge */}
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: modeInfo.color,
              background: `${modeInfo.color}22`,
              border: `1px solid ${modeInfo.color}55`,
              borderRadius: '4px',
              padding: '1px 5px',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {modeInfo.label}
          </span>

          {/* Original text */}
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#94a3b8',
              letterSpacing: '0.02em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {originalText}
          </span>
        </div>

        {/* Audio button */}
        <button
          type="button"
          onClick={() => speakText(originalText)}
          title="Pronounce original"
          style={{
            background: isPlayingAudio ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '9999px',
            color: '#38bdf8',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '12px',
            flexShrink: 0,
            transition: 'all 0.15s ease',
          }}
        >
          🔊
        </button>
      </div>

      {/* Translation result OR loading spinner */}
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          fontSize: resolvedMode === 'word' ? '17px' : '15px',
          fontWeight: 700,
          lineHeight: '1.4',
          color: modeInfo.color,
          textShadow: `0 0 12px ${modeInfo.color}44`,
          marginBottom: '8px',
          minHeight: '26px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {isLoading ? (
          <>
            <span
              style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                border: `2px solid ${modeInfo.color}44`,
                borderTopColor: modeInfo.color,
                borderRadius: '50%',
                animation: 'subany-spin 0.7s linear infinite',
                flexShrink: 0,
              }}
            />
            <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>Translating…</span>
          </>
        ) : (
          translatedText || '—'
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          paddingTop: '6px',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        {/* Hotkey hints */}
        <span style={{ fontSize: '10px', color: '#475569', display: 'flex', gap: '8px' }}>
          <span>
            <strong style={{ color: '#64748b' }}>Ctrl</strong>: phrase
          </span>
          <span>
            <strong style={{ color: '#64748b' }}>Shift</strong>: range
          </span>
        </span>

        {/* Engine badge */}
        {engineUsed && (
          <span
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#64748b',
              background: 'rgba(15, 23, 42, 0.6)',
              padding: '1px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(148,163,184,0.15)',
            }}
          >
            {engineUsed}
          </span>
        )}
      </div>
    </div>
  );
}
