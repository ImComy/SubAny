import { useEffect, useRef, useState } from 'react';

export interface SubtitleOverlayProps {
  glowTarget: HTMLElement | null;
  lockedElement: HTMLElement | null;
  selectionCandidate: HTMLElement | null;
  isSelecting: boolean;
  hoveredWordRect?: DOMRect | null;
  /** Determines highlight pill color + shape */
  highlightMode?: 'word' | 'phrase' | 'range';
  isLoading?: boolean;
  bilingualText?: string;
  targetLang?: string;
  onUnlock?: () => void;
}

const MODE_COLORS: Record<string, string> = {
  word: 'rgba(56, 189, 248,',   // sky
  phrase: 'rgba(167, 139, 250,', // violet
  range: 'rgba(52, 211, 153,',  // emerald
};

export function SubtitleOverlay({
  glowTarget,
  lockedElement,
  selectionCandidate,
  isSelecting,
  hoveredWordRect,
  highlightMode,
  isLoading = false,
  bilingualText,
  targetLang,
  onUnlock,
}: SubtitleOverlayProps) {
  const glowRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef<HTMLDivElement>(null);
  const bilingualRef = useRef<HTMLDivElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const [isGlowActive, setIsGlowActive] = useState(false);

  // Resolve mode for pill color
  const mode: 'word' | 'phrase' | 'range' = highlightMode ?? 'word';
  const colorBase = MODE_COLORS[mode] ?? MODE_COLORS.word;

  // Position overlays imperatively. Geometry is transient DOM state, not UI state.
  useEffect(() => {
    const targets = [
      [glowTarget, glowRef.current, 6],
      [lockedElement, lockedRef.current, 4],
      [lockedElement && bilingualText ? lockedElement : null, bilingualRef.current, 0],
      [selectionCandidate && isSelecting ? selectionCandidate : null, candidateRef.current, 0],
    ] as const;
    if (!targets.some(([target, overlay]) => target && overlay)) return;

    let animId: number;
    const update = () => {
      for (const [target, overlay, padding] of targets) {
        if (!overlay) continue;
        if (!target) {
          overlay.style.display = 'none';
          continue;
        }
        const rect = target.getBoundingClientRect();
        overlay.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
        if (overlay === bilingualRef.current) {
          overlay.style.left = `${rect.left}px`;
          overlay.style.top = `${rect.bottom + 8}px`;
          overlay.style.width = `${rect.width}px`;
        } else {
          overlay.style.left = `${rect.left - padding}px`;
          overlay.style.top = `${rect.top - padding}px`;
          overlay.style.width = `${rect.width + padding * 2}px`;
          overlay.style.height = `${rect.height + padding * 2}px`;
        }
      }
      animId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animId);
  }, [glowTarget, lockedElement, selectionCandidate, isSelecting, bilingualText, isGlowActive]);

  // Glow trigger
  useEffect(() => {
    if (!glowTarget) return;
    setIsGlowActive(true);
    const t = setTimeout(() => setIsGlowActive(false), 1600);
    return () => clearTimeout(t);
  }, [glowTarget]);

  const isRtl = ['ar', 'fa', 'he', 'ur'].includes(targetLang ?? '');

  return (
    <>
      <style>{`
        @keyframes subany-glow-pulse {
          0%   { box-shadow: 0 0 0 0 ${colorBase}0.9), 0 0 30px 10px rgba(59,130,246,0.8); border-color: ${colorBase}1); opacity:1; transform:scale(0.995); }
          50%  { box-shadow: 0 0 30px 8px ${colorBase}0.7), 0 0 50px 20px rgba(147,51,234,0.5); border-color: rgba(168,85,247,1); opacity:0.9; transform:scale(1.008); }
          100% { box-shadow: 0 0 0 0 transparent; border-color:transparent; opacity:0; transform:scale(1); }
        }
        @keyframes subany-loading-pulse {
          0%,100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
      `}</style>

      {/* 1. Glow ring on auto-detect */}
      {isGlowActive && glowTarget && (
        <div
          ref={glowRef}
          style={{
            position: 'fixed',
            left: '0',
            top: '0',
            width: '0',
            height: '0',
            borderRadius: '12px',
            border: '2px solid rgba(56, 189, 248, 0.9)',
            pointerEvents: 'none',
            zIndex: 2147483630,
            animation: 'subany-glow-pulse 1.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        />
      )}

      {/* 2. Word / Phrase / Range highlight pill */}
      {hoveredWordRect && !isSelecting && (
        <div
          style={{
            position: 'fixed',
            left: `${hoveredWordRect.left - (mode === 'word' ? 3 : 5)}px`,
            top: `${hoveredWordRect.top - 2}px`,
            width: `${hoveredWordRect.width + (mode === 'word' ? 6 : 10)}px`,
            height: `${hoveredWordRect.height + 4}px`,
            borderRadius: mode === 'word' ? '4px' : '7px',
            background: `${colorBase}${isLoading ? '0.2' : '0.3'})`,
            border: `${mode === 'word' ? '1px' : '1.5px'} solid ${colorBase}${isLoading ? '0.5' : '0.8'})`,
            boxShadow: isLoading
              ? `0 0 8px ${colorBase}0.3), 0 0 0 2px ${colorBase}0.1)`
              : `0 0 14px ${colorBase}0.55)`,
            pointerEvents: 'none',
            zIndex: 2147483635,
            transition: 'all 0.06s ease-out',
            animation: isLoading ? 'subany-loading-pulse 1s ease-in-out infinite' : undefined,
          }}
        />
      )}

      {/* 4. Locked subtitle border indicator */}
      {lockedElement && !isSelecting && (
        <div
          ref={lockedRef}
          style={{
            position: 'fixed',
            left: '0',
            top: '0',
            width: '0',
            height: '0',
            borderRadius: '8px',
            border: '1.5px dashed rgba(56, 189, 248, 0.5)',
            boxShadow: '0 0 12px rgba(56, 189, 248, 0.12)',
            pointerEvents: 'none',
            zIndex: 2147483620,
            transition: 'all 0.15s ease',
          }}
        >
          {/* Tracked badge */}
          <div
            style={{
              position: 'absolute',
              right: '0',
              top: '-24px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(15, 23, 42, 0.88)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              backdropFilter: 'blur(8px)',
              padding: '2px 8px',
              borderRadius: '9999px',
              color: '#38bdf8',
              fontSize: '11px',
              fontWeight: 600,
              pointerEvents: 'auto',
              userSelect: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <span>Subtitles Tracked</span>
            {onUnlock && (
              <button
                type="button"
                onClick={onUnlock}
                title="Unlock / Reset"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '12px',
                  lineHeight: '1',
                  padding: '0 2px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* 5. Bilingual translation banner (full-auto mode) */}
      {bilingualText && lockedElement && (
        <div
          ref={bilingualRef}
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            position: 'fixed',
            left: '0',
            top: '0',
            width: '0',
            minHeight: '24px',
            padding: '6px 14px',
            borderRadius: '8px',
            background: 'rgba(15, 23, 42, 0.88)',
            border: '1px solid rgba(56, 189, 248, 0.28)',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            color: '#38bdf8',
            fontSize: '18px',
            fontWeight: 700,
            textAlign: 'center',
            zIndex: 2147483625,
            pointerEvents: 'none',
            userSelect: 'none',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {bilingualText}
        </div>
      )}

      {isSelecting && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            top: '18px',
            transform: 'translateX(-50%)',
            padding: '8px 14px',
            borderRadius: '8px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            color: '#bae6fd',
            fontSize: '13px',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 2147483646,
          }}
        >
          Click a subtitle to lock it. Press Escape to cancel.
        </div>
      )}

      {/* 6. Selection mode candidate highlight */}
      {isSelecting && selectionCandidate && (
        <div
          ref={candidateRef}
          style={{
            position: 'fixed',
            left: '0',
            top: '0',
            width: '0',
            height: '0',
            borderRadius: '6px',
            border: '2px solid #38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            boxShadow: '0 0 20px rgba(56, 189, 248, 0.5)',
            pointerEvents: 'none',
            zIndex: 2147483646,
            transition: 'all 0.08s ease-out',
          }}
        />
      )}
    </>
  );
}
