export type Theme = 'glass' | 'light' | 'stage';
export type PlayMode = 'order' | 'shuffle' | 'repeat';
export interface LyricLine { time: number | null; text: string }
export interface Lyrics { lines: LyricLine[]; synced: boolean }
export interface Track {
  id: string;
  file: File;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork?: Blob;
  lyrics?: string;
  lyricFile?: string;
  favorite: boolean;
  addedAt: number;
  lastPlayed?: number;
}
