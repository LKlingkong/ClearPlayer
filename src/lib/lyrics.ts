import type { Lyrics, LyricLine } from '../types';
export function parseLyrics(source: string): Lyrics {
  const rows = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines: LyricLine[] = [];
  const plain: LyricLine[] = [];
  for (const row of rows) {
    const tags = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length) {
      const text = row.replace(/\[[^\]]*\]/g, '').trim();
      for (const tag of tags) {
        if (Number(tag[2]) >= 60) continue;
        const time = Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] || '0'}`) - offset;
        lines.push({time: Math.max(0, Math.round(time * 1000) / 1000), text});
      }
    } else if (row.trim() && !/^\s*\[[^\]]*\]/.test(row)) plain.push({time: null, text: row.trim()});
  }
  if (lines.length) return {lines: lines.sort((a,b) => a.time! - b.time!), synced: true};
  return {lines: plain, synced: false};
}
export function lyricIndex(lines: LyricLine[], time: number): number {
  let low = 0, high = lines.length - 1, result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time !== null && lines[mid].time! <= time) {result = mid; low = mid + 1;}
    else high = mid - 1;
  }
  return result;
}
