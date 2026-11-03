import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayMode, Track } from '../types';
import { nextTrackId } from '../lib/library';
import { readSetting, writeSetting } from '../lib/storage';

export function usePlayer(tracks: Track[], loaded: boolean, notify: (message: string) => void) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<string | null>(() => readSetting('current', null));
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => readSetting('volume', 0.7));
  const [muted, setMuted] = useState(false);
  const [mode, setModeState] = useState<PlayMode>(() => readSetting('mode', 'order'));
  const wantPlay = useRef(false);
  const request = useRef(0);
  const intentHandler=useRef<(()=>void)|undefined>(undefined);
  const setIntentHandler=useCallback((handler:(()=>void)|undefined)=>{intentHandler.current=handler;},[]);
  const advanceHandler=useRef<((automatic:boolean,direction:number)=>boolean)|undefined>(undefined);
  const setAdvanceHandler=useCallback((handler:((automatic:boolean,direction:number)=>boolean)|undefined)=>{advanceHandler.current=handler;},[]);
  const [queueIds,setQueueIds]=useState<string[]>([]);
  const queue=queueIds.length?queueIds.map(id=>tracks.find(t=>t.id===id)).filter((t):t is Track=>!!t):tracks;
  const track = tracks.find(t => t.id === currentId);

  const startAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    const sequence = ++request.current;
    try { await audio.play(); }
    catch (error) {
      if (sequence !== request.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      wantPlay.current = false; setPlaying(false);
      notify(error instanceof DOMException && error.name === 'NotAllowedError' ? '请点击播放，开始聆听' : '浏览器无法播放这份音频。文件仍已保存，可以保存音频后使用其他播放器');
    }
  }, [notify]);

  useEffect(() => {
    if (!loaded) return;
    if (tracks.length && !tracks.some(t => t.id === currentId)) setCurrentId(tracks[0].id);
    else if (!tracks.length) {wantPlay.current = false; setCurrentId(null);}
  }, [tracks, currentId, loaded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    ++request.current; audio.pause(); setTime(0); setDuration(0);
    if (!track) { audio.removeAttribute('src'); audio.load(); return; }
    const url = URL.createObjectURL(track.file);
    audio.src = url; audio.load();
    writeSetting('current', track.id);
    if (wantPlay.current) void startAudio();
    return () => { ++request.current; audio.pause(); URL.revokeObjectURL(url); };
    // A favorite or lyric edit must never reset the audio resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, startAudio]);

  useEffect(() => { if (audioRef.current) { audioRef.current.volume = volume; audioRef.current.muted = muted; } }, [volume, muted]);
  const select = useCallback((id: string, play = true) => {
    intentHandler.current?.();
    wantPlay.current = play;
    if (id === currentId) { if (play) void startAudio(); return; }
    setCurrentId(id);
  }, [currentId, startAudio]);
  const toggle = useCallback(() => {
    intentHandler.current?.();
    if (!track) { notify('先导入一首音乐，或去在线找歌'); return; }
    const audio = audioRef.current;
    if (audio && !audio.paused) { wantPlay.current = false; ++request.current; audio.pause(); }
    else { wantPlay.current = true; void startAudio(); }
  }, [track, startAudio, notify]);
  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) { audio.currentTime = Math.max(0, Math.min(value, audio.duration)); setTime(audio.currentTime); }
  }, []);
  const next = useCallback((automatic = false) => {
    if(advanceHandler.current?.(automatic,1))return;
    const id = nextTrackId(queue.map(t => t.id), currentId, mode, automatic);
    if (!id) { wantPlay.current = false; setPlaying(false); return; }
    if (id === currentId) { seek(0); wantPlay.current = true; void startAudio(); }
    else select(id);
  }, [queue, currentId, mode, select, seek, startAudio]);
  const previous = useCallback(() => {
    if(advanceHandler.current?.(false,-1))return;
    if (!queue.length) return;
    const i = queue.findIndex(t => t.id === currentId);
    select(queue[(i - 1 + queue.length) % queue.length].id);
  }, [queue, currentId, select]);
  const setVolume = useCallback((value: number) => { const v = Math.max(0, Math.min(1, value)); setVolumeState(v); setMuted(false); writeSetting('volume', v); }, []);
  const setMode = useCallback((value: PlayMode) => { setModeState(value); writeSetting('mode', value); }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({title: track.title, artist: track.artist, album: track.album});
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [['play', () => {intentHandler.current?.();wantPlay.current = true; void startAudio();}], ['pause', () => {intentHandler.current?.();audioRef.current?.pause();}], ['previoustrack', previous], ['nexttrack', () => next()], ['seekto', detail => {if(detail.seekTime !== undefined) seek(detail.seekTime);}]];
    handlers.forEach(([action, handler]) => {try {session.setActionHandler(action, handler);} catch { /* Browser may not support this media action. */ }});
    return () => handlers.forEach(([action]) => {try {session.setActionHandler(action, null);} catch { /* Unsupported action. */ }});
  }, [track, next, previous, seek, startAudio]);

  return {audioRef, track, currentId, playing, setPlaying, time, setTime, duration, setDuration, volume, setVolume, muted, setMuted, mode, setMode, select, toggle, seek, next, previous,queue,setQueue:setQueueIds,setAdvanceHandler,setIntentHandler};
}
