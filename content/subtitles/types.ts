export type SubtitleProviderId = 'opensubtitles' | 'subdl';

export interface SubtitleSearchRequest {
  query: string;
  year?: string;
  language?: string;
  provider?: SubtitleProviderId;
}

export interface SubtitleSearchResult {
  id: string;
  provider: SubtitleProviderId;
  fileId: string;
  title: string;
  language: string;
  format: 'srt' | 'vtt' | 'unknown';
  hearingImpaired: boolean;
  downloadAvailable: boolean;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleTrack {
  result: SubtitleSearchResult;
  cues: SubtitleCue[];
}

export interface SubtitleSettings {
  subtitleProvider: SubtitleProviderId;
  subtitleApiKey: string;
  subtitleDelayMs: number;
  subtitleEnabled: boolean;
}

export interface SubtitleSearchMessage {
  action: 'subtitle-search';
  request: SubtitleSearchRequest;
}

export interface SubtitleDownloadMessage {
  action: 'subtitle-download';
  result: SubtitleSearchResult;
}
