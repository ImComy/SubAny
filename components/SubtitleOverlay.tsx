import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { measureGlyphBounds } from '../utils/dom';

export interface SubtitleOverlayProps {
  glowTarget: HTMLElement | SVGElement | null;
  lockedElement: HTMLElement | SVGElement | null;
  lockedRect?: DOMRect | null;
  selectionCandidate: HTMLElement | SVGElement | null;
  isSelecting: boolean;
  nativeSelectionRect?: DOMRect | null;
  hoveredWordRect?: DOMRect | null;
  /** Determines highlight pill color + shape */
  highlightMode?: 'word' | 'phrase' | 'range';
  isLoading?: boolean;
  bilingualText?: string;
  targetLang?: string;
  externalSubtitleText?: string;
  externalSubtitleVideo?: HTMLVideoElement | null;
  subtitleDelayMs?: number;
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
  lockedRect,
  selectionCandidate,
  isSelecting,
  nativeSelectionRect,
  hoveredWordRect,
  highlightMode,
  isLoading = false,
  bilingualText,
  targetLang,
  externalSubtitleText,
  externalSubtitleVideo,
  onUnlock,
}: SubtitleOverlayProps) {
  const glowRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef<HTMLDivElement>(null);
  const bilingualRef = useRef<HTMLDivElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const externalRef = useRef<HTMLDivElement>(null);
  const [isGlowActive, setIsGlowActive] = useState(false);

  // Resolve mode for pill color
  const mode: 'word' | 'phrase' | 'range' = highlightMode ?? 'word';
  const colorBase = MODE_COLORS[mode] ?? MODE_COLORS.word;

  // Position overlays from the current DOM rects; do not loop every frame.
  // The overlay should only move when the target or lock state changes,
  // not continuously while the page is animating.
  useLayoutEffect(() => {
    const targets = [
      [glowTarget, glowRef.current, 6],
      [lockedElement && bilingualText ? lockedElement : null, bilingualRef.current, 0],
      [selectionCandidate && isSelecting ? selectionCandidate : null, candidateRef.current, 0],
    ] as const;

    for (const [target, overlay, padding] of targets) {
      if (!overlay) continue;
      if (!target) {
        overlay.style.display = 'none';
        continue;
      }

      const glyphBounds = target === selectionCandidate ? measureGlyphBounds(target) : null;
      const rect = glyphBounds ?? target.getBoundingClientRect();
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

    if (lockedRef.current) {
      if (!lockedRect) {
        lockedRef.current.style.display = 'none';
      } else {
        lockedRef.current.style.display = 'block';
        lockedRef.current.style.left = `${lockedRect.left - 4}px`;
        lockedRef.current.style.top = `${lockedRect.top - 4}px`;
        lockedRef.current.style.width = `${lockedRect.width + 8}px`;
        lockedRef.current.style.height = `${lockedRect.height + 8}px`;
      }
    }
  }, [glowTarget, lockedElement, lockedRect, selectionCandidate, isSelecting, bilingualText, isGlowActive]);

  useLayoutEffect(() => {
    if (!externalSubtitleVideo || !externalSubtitleText || !externalRef.current) return;

    const rect = externalSubtitleVideo.getBoundingClientRect();
    const overlay = externalRef.current;
    if (overlay) {
      overlay.style.left = `${rect.left + rect.width * 0.08}px`;
      overlay.style.top = `${rect.top + rect.height * 0.78}px`;
      overlay.style.width = `${rect.width * 0.84}px`;
    }
  }, [externalSubtitleVideo, externalSubtitleText]);

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

      {nativeSelectionRect && !isSelecting && !lockedElement && (
        <div
          style={{
            position: 'fixed',
            left: `${nativeSelectionRect.left - 4}px`,
            top: `${nativeSelectionRect.top - 4}px`,
            width: `${nativeSelectionRect.width + 8}px`,
            height: `${nativeSelectionRect.height + 8}px`,
            borderRadius: '8px',
            border: '1.5px dashed rgba(56, 189, 248, 0.7)',
            boxShadow: '0 0 12px rgba(56, 189, 248, 0.18)',
            pointerEvents: 'none',
            zIndex: 2147483620,
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
            transition: 'opacity 0.15s ease',
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

      {externalSubtitleText && externalSubtitleVideo && (
        <div
          ref={externalRef}
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            position: 'fixed', left: '0', top: '0', width: '0',
            padding: '5px 14px', borderRadius: '7px',
            background: 'rgba(15, 23, 42, 0.86)',
            color: '#f8fafc', fontSize: 'clamp(14px, 2.1vw, 28px)',
            fontWeight: 700, lineHeight: 1.3, textAlign: 'center',
            textShadow: '0 2px 3px rgba(0,0,0,0.95)',
            boxSizing: 'border-box', zIndex: 2147483626,
            pointerEvents: 'none', userSelect: 'none',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {externalSubtitleText}
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
