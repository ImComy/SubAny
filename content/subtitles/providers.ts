import type { SubtitleSearchRequest, SubtitleSearchResult, SubtitleProviderId } from './types';
import { gunzipSync, strFromU8, unzipSync } from 'fflate';

type ProviderConfig = { apiKey?: string };

export interface SubtitleProvider {
  readonly id: SubtitleProviderId;
  search(request: SubtitleSearchRequest, config: ProviderConfig): Promise<SubtitleSearchResult[]>;
  download(fileId: string, config: ProviderConfig): Promise<{ content: string; fileName: string; contentType: string }>;
}

function formatFromName(name: string): 'srt' | 'vtt' | 'unknown' {
  if (/\.vtt(?:$|\?)/i.test(name)) return 'vtt';
  if (/\.srt(?:$|\?)/i.test(name)) return 'srt';
  return 'unknown';
}

function decodeSubtitleBytes(bytes: Uint8Array, fallbackName: string): { content: string; fileName: string } {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const entry = Object.entries(files).find(([name]) => /\.(srt|vtt)$/i.test(name));
    if (!entry) throw new Error('Subtitle archive contained no SRT or WebVTT file.');
    return { content: decodeText(entry[1]), fileName: entry[0] };
  }

  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return { content: decodeText(gunzipSync(bytes)), fileName: fallbackName.replace(/\.gz$/i, '') };
  }

  return { content: decodeText(bytes), fileName: fallbackName };
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  const utf8 = strFromU8(bytes);
  if (utf8.includes('\u0000')) {
    const littleEndian = bytes[1] === 0x00;
    const encoding = littleEndian ? 'utf-16le' : 'utf-16be';
    return new TextDecoder(encoding).decode(bytes);
  }
  return utf8;
}

export const openSubtitlesProvider: SubtitleProvider = {
  id: 'opensubtitles',
  async search(request, config) {
    if (!config.apiKey) throw new Error('OpenSubtitles requires an API key in Settings.');
    const params = new URLSearchParams({ query: request.query, languages: request.language || 'en' });
    if (request.year) params.set('year', request.year);
    const response = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params}`, {
      headers: { 'Api-Key': config.apiKey, Accept: 'application/json', 'User-Agent': 'SubAny v1.0' },
    });
    if (!response.ok) throw new Error(`OpenSubtitles HTTP ${response.status}`);
    const json = await response.json();
    return (json.data || []).slice(0, 20).map((item: any) => {
      const attrs = item.attributes || {};
      const file = attrs.files?.[0] || {};
      const fileName = String(file.file_name || 'subtitle.srt');
      return {
        id: String(item.id), fileId: String(file.file_id || ''), provider: 'opensubtitles',
        title: String(attrs.release || attrs.feature_details?.movie_name || 'OpenSubtitles result'),
        language: String(attrs.language || request.language || 'en'), format: formatFromName(fileName),
        hearingImpaired: Boolean(attrs.hearing_impaired), downloadAvailable: Boolean(file.file_id),
      };
    }).filter((item: SubtitleSearchResult) => item.downloadAvailable);
  },
  async download(fileId, config) {
    if (!config.apiKey) throw new Error('OpenSubtitles requires an API key in Settings.');
    const response = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST', headers: { 'Api-Key': config.apiKey, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'SubAny v1.0' },
      body: JSON.stringify({ file_id: Number(fileId) }),
    });
    if (!response.ok) throw new Error(`OpenSubtitles download HTTP ${response.status}`);
    const json = await response.json();
    const link = json?.link;
    if (!link) throw new Error('OpenSubtitles did not return a download link.');
    const fileResponse = await fetch(link);
    if (!fileResponse.ok) throw new Error(`Subtitle file HTTP ${fileResponse.status}`);
    const fileName = String(json.file_name || 'subtitle.srt');
    const decoded = decodeSubtitleBytes(new Uint8Array(await fileResponse.arrayBuffer()), fileName);
    return { content: decoded.content, fileName: decoded.fileName, contentType: fileResponse.headers.get('content-type') || '' };
  },
};

export const subdlProvider: SubtitleProvider = {
  id: 'subdl',
  async search(request, config) {
    if (!config.apiKey) throw new Error('SubDL requires an API key in Settings.');
    const params = new URLSearchParams({ api_key: config.apiKey, film_name: request.query, languages: request.language || 'english' });
    const response = await fetch(`https://api.subdl.com/api/v1/subtitles?${params}`);
    if (!response.ok) throw new Error(`SubDL HTTP ${response.status}`);
    const json = await response.json();
    return (json.subtitles || []).slice(0, 20).map((item: any, index: number) => ({
      id: `${item.movie_name || request.query}-${index}`, fileId: String(item.url || ''), provider: 'subdl',
      title: String(item.release_name || item.movie_name || 'SubDL result'), language: String(item.language || request.language || 'en'),
      format: formatFromName(String(item.url || '')), hearingImpaired: Boolean(item.hi), downloadAvailable: Boolean(item.url),
    }));
  },
  async download(fileId) {
    const response = await fetch(fileId);
    if (!response.ok) throw new Error(`SubDL download HTTP ${response.status}`);
    return { content: await response.text(), fileName: fileId, contentType: response.headers.get('content-type') || '' };
  },
};

export const subtitleProviders: Record<SubtitleProviderId, SubtitleProvider> = {
  opensubtitles: openSubtitlesProvider,
  subdl: subdlProvider,
};
