// state/types.ts

export interface LockedSubtitleAnchor {
  centerXRatio: number;
  centerYRatio: number;
  widthRatio: number;
  heightRatio: number;
  absoluteRect: { left: number; top: number; width: number; height: number };
  videoRect: { left: number; top: number; width: number; height: number } | null;
  videoSignature?: string;
  textHint: string;
  updatedAt: number;
}

export interface AutoTrackState {
  key: string;
  video: HTMLVideoElement | null;
  element: HTMLElement | null;
  lastText: string;
  seen: number;
  textChanges: number;
  staticScore: number;
  lastSeenAt: number;
  lastElementAt: number;
}

export type HighlightMode = 'word' | 'phrase' | 'range';

export interface TooltipState {
  x: number;
  y: number;
  originalText: string;
  translatedText: string;
  engineUsed?: string;
  mode: HighlightMode;
}

export interface LockedVideoEventBinding {
  video: HTMLVideoElement;
  event: string;
  handler: EventListener;
}