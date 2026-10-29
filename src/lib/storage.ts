import type { Track } from '../types';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('clear-music-library', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('tracks')) request.result.createObjectStore('tracks', {keyPath:'id'});
      if (!request.result.objectStoreNames.contains('downloadImports')) request.result.createObjectStore('downloadImports');
    };
    request.onsuccess = () => {request.result.onversionchange = () => {request.result.close(); database = undefined;}; resolve(request.result);};
    request.onerror = () => {database = undefined; reject(request.error);};
    request.onblocked = () => {database = undefined; reject(new Error('本地曲库被其他页面占用'));};
  });
  return database;
}
export async function loadTracks(): Promise<Track[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readonly');
    const request = transaction.objectStore('tracks').getAll();
    request.onsuccess = () => resolve((request.result as Track[]).sort((a,b) => a.addedAt - b.addedAt));
    request.onerror = () => reject(request.error);
  });
}
async function mutate(action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction('tracks','readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    action(transaction.objectStore('tracks'));
  });
}
export function saveTrack(track: Track): Promise<void> {return mutate(store => store.put(track));}
export function deleteTrack(id: string): Promise<void> {return mutate(store => store.delete(id));}
export async function loadImportedDownloadIds(): Promise<string[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('downloadImports', 'readonly').objectStore('downloadImports').getAllKeys();
    request.onsuccess = () => resolve(request.result.map(String));
    request.onerror = () => reject(request.error);
  });
}
// A receipt and its track commit together: failed writes can always be retried.
export async function saveDownloadedTrack(track: Track, jobId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['tracks', 'downloadImports'], 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    try {
      transaction.objectStore('tracks').put(track);
      transaction.objectStore('downloadImports').put(true, jobId);
    } catch (error) {
      transaction.abort(); reject(error);
    }
  });
}
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`clear:${key}`);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    if (key === 'theme' && !['glass','light','stage'].includes(value)) return fallback;
    if (key === 'mode' && !['order','repeat','shuffle'].includes(value)) return fallback;
    if (key === 'volume' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return fallback;
    if (key === 'current' && typeof value !== 'string') return fallback;
    return value as T;
  } catch {return fallback;}
}
export function writeSetting(key: string, value: unknown): void {try {localStorage.setItem(`clear:${key}`, JSON.stringify(value));} catch { /* Playback remains available when settings storage is blocked. */ }}
