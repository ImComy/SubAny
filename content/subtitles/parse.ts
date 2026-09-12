import type { SubtitleCue } from './types';

function toSeconds(value: string): number {
  const normalized = value.replace(',', '.').trim();
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return Number(normalized);
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\\{[^}]+\\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/\r/g, '')
    .trim();
}

export function parseSubtitleText(input: string, format: 'srt' | 'vtt' | 'unknown' = 'unknown'): SubtitleCue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex]?.split('-->') || [];
    const start = toSeconds(timing[0] || '');
    const end = toSeconds(timing[1]?.split(/[ \t]/)[0] || '');
    const cueText = cleanText(lines.slice(timingIndex + 1).join('\n'));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
      cues.push({ start, end, text: cueText });
    }
  }

  // Some providers flatten SRT blocks or use unusual spacing. Recover cues
  // from timing lines even when blank-line block splitting was not usable.
  if (cues.length === 0) {
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const timing = lines[index]?.match(/^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
      if (!timing) continue;
      const textLines: string[] = [];
      for (let textIndex = index + 1; textIndex < lines.length; textIndex += 1) {
        const line = lines[textIndex]?.trim() || '';
        if (!line) break;
        if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(line)) break;
        if (!/^\d+$/.test(line)) textLines.push(line);
      }
      const start = toSeconds(timing[1] || '');
      const end = toSeconds(timing[2] || '');
      const cueText = cleanText(textLines.join('\n'));
      if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
        cues.push({ start, end, text: cueText });
      }
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function detectSubtitleFormat(fileName: string, contentType = ''): 'srt' | 'vtt' | 'unknown' {
  if (/\.vtt($|\?)/i.test(fileName) || contentType.includes('vtt')) return 'vtt';
  if (/\.srt($|\?)/i.test(fileName) || contentType.includes('subrip')) return 'srt';
  return 'unknown';
}
