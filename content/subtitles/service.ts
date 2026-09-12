import { detectSubtitleFormat, parseSubtitleText } from './parse';
import { subtitleProviders } from './providers';
import type { SubtitleDownloadMessage, SubtitleSearchMessage, SubtitleSearchResult, SubtitleTrack } from './types';

export async function searchSubtitles(message: SubtitleSearchMessage, apiKey: string): Promise<SubtitleSearchResult[]> {
  const provider = subtitleProviders[message.request.provider || 'opensubtitles'];
  return provider.search(message.request, { apiKey });
}

export async function downloadSubtitle(message: SubtitleDownloadMessage, apiKey: string): Promise<SubtitleTrack> {
  const provider = subtitleProviders[message.result.provider];
  const downloaded = await provider.download(message.result.fileId, { apiKey });
  const format = detectSubtitleFormat(downloaded.fileName, downloaded.contentType);
  const cues = parseSubtitleText(downloaded.content, format);
  if (cues.length === 0) {
    throw new Error(`Downloaded subtitle file contained no readable cues (${downloaded.fileName}).`);
  }
  return { result: { ...message.result, format }, cues };
}
