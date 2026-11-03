import type { PlayMode, Track } from '../types';
export function fileStem(name: string): string {return name.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').trim().toLocaleLowerCase();}
export function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2,'0')}`;
}
export function nextTrackId(ids: string[], current: string | null, mode: PlayMode, automatic: boolean): string | null {
  if (!ids.length) return null;
  const i = ids.indexOf(current || '');
  if (automatic && mode === 'repeat' && i >= 0) return current;
  if (mode === 'shuffle') {const pool = ids.filter(id => id !== current); return pool.length ? pool[Math.floor(Math.random() * pool.length)] : ids[0];}
  if (automatic && i === ids.length - 1) return null;
  return ids[(i + 1) % ids.length];
}
export async function readLyricFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {return new TextDecoder('utf-8', {fatal:true}).decode(bytes);}
  catch {return new TextDecoder('gb18030').decode(bytes);}
}
export async function readTrack(file: File): Promise<Track> {
  if (!file.size) throw new Error('空音频文件');
  const title = file.name.replace(/\.(mp3|flac|m4a|ogg|wav)$/i, '');
  const parts = title.split(' - ');
  const track: Track = {id:`${file.name}:${file.size}:${file.lastModified}`, file, title: parts.length > 1 ? parts.slice(1).join(' - ') : title, artist: parts.length > 1 ? parts[0] : '未知歌手', album:'', duration:0, favorite:false, addedAt:Date.now()};
  try {
    const { parseBlob } = await import('music-metadata');
    const metadata = await parseBlob(file, {duration:true});
    track.title = metadata.common.title || track.title;
    track.artist = metadata.common.artist || track.artist;
    track.album = metadata.common.album || '';
    track.tags = metadata.common.genre?.filter(Boolean).slice(0,12);
    track.duration = metadata.format.duration || 0;
    const cover = metadata.common.picture?.find(picture=>/front/i.test(picture.type||'')) || metadata.common.picture?.[0];
    if (cover) {track.artwork = new Blob([new Uint8Array(cover.data)], {type:cover.format});track.artworkSource='embedded';}
    const lyrics = metadata.common.lyrics?.[0];
    if (lyrics?.text) track.lyrics = lyrics.text;
  } catch { /* Audio without readable tags still gets a filename fallback. */ }
  return track;
}
