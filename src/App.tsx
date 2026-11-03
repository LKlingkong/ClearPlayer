import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, AudioLines, Check, CheckCircle2, ChevronRight, Disc3, FolderOpen, Headphones, Heart, History, Library, ListMusic, LoaderCircle, Menu, Music2, Palette, Pause, Play, Plus, Repeat1, Search, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Upload, Volume1, Volume2, VolumeX, Waves, X } from 'lucide-react';
import type { Theme, Track } from './types';
import { fileStem, formatTime, readLyricFile, readTrack } from './lib/library';
import { deleteTrack, loadImportedDownloadIds, loadTracks, readSetting, saveDownloadedTrack, saveTrack, writeSetting } from './lib/storage';
import { usePlayer } from './hooks/usePlayer';
import { Artwork } from './components/Artwork';
import { IconButton } from './components/IconButton';
import { ThemePicker, themes } from './components/ThemePicker';
import { VinylPlayer } from './components/VinylPlayer';
import { WindowChrome } from './components/WindowChrome';
import {localArtwork} from './lib/artwork';
import {useArtworkDiscovery} from './hooks/useArtworkDiscovery';
import {ArtworkManager} from './components/ArtworkManager';
import type {ArtworkFit} from './lib/artworkGeometry';

import { OnlineMusic } from './components/OnlineMusic';
import { downloadFile } from './lib/online';
import type { DownloadJob } from './lib/online';

type Section = 'all' | 'favorites' | 'recent' | 'online' | 'playing';
const modeLabels = {order:'顺序播放', shuffle:'随机播放', repeat:'单曲循环'};

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readSetting('theme', 'glass'));
  const [themeOpen, setThemeOpen] = useState(false);
  const [section, setSection] = useState<Section>('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [mobileLyrics, setMobileLyrics] = useState(false);
  const [autoArtwork,setAutoArtwork]=useState(()=>readSetting('auto-artwork',true));
  const [artworkManagerId,setArtworkManagerId]=useState<string|null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lyricsInput = useRef<HTMLInputElement>(null);
  const artworkInput = useRef<HTMLInputElement>(null);
  const artworkTarget = useRef<string | null>(null);
  const importQueue = useRef<Promise<unknown>>(Promise.resolve());
  const removalVersions = useRef(new Map<string, number>());
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const dragDepth = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  const player = usePlayer(tracks, loaded, notify);

  useEffect(() => { loadTracks().then(items => {setTracks(items); setLoaded(true);}).catch(() => {setLoaded(true); notify('本地存储暂不可用，仍可导入并在本次打开时播放');}); }, [notify]);
  useEffect(() => { document.documentElement.dataset.theme = theme; writeSetting('theme', theme); }, [theme]);
  useEffect(() => {if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer);}, [toast]);
  const persist = useCallback((track: Track) => { void saveTrack(track).catch(() => notify('本次可以继续播放，但保存失败。请检查浏览器存储空间或隐私设置')); }, [notify]);

  const updateTrack = useCallback((id: string, update: Partial<Track>) => {
    const next=tracksRef.current.map(t=>{if(t.id!==id)return t;const changed={...t,...update};persist(changed);return changed;});
    tracksRef.current=next;setTracks(next);
  }, [persist]);
  const applyDiscoveredArtwork=useCallback(async(id:string,artwork:Blob,provider:string,replace=false)=>{
    const current=tracksRef.current.find(track=>track.id===id);
    if(!current || (current.artwork&&!replace))return false;
    const changed:Track={...current,artwork,artworkSource:'online',artworkProvider:provider,artworkFit:undefined};
    const next=tracksRef.current.map(track=>track.id===id?changed:track);tracksRef.current=next;setTracks(next);
    try{await saveTrack(changed);}catch{notify('封面已显示，但保存失败，请检查存储空间');throw new Error('封面没有保存成功，请检查存储空间后重试');}return true;
  },[notify]);
  const saveArtworkFit=useCallback(async(id:string,artworkFit:ArtworkFit)=>{
    const current=tracksRef.current.find(track=>track.id===id);if(!current)throw new Error('这首歌已被移除');
    const changed={...current,artworkFit},next=tracksRef.current.map(track=>track.id===id?changed:track);tracksRef.current=next;setTracks(next);await saveTrack(changed);
  },[]);
  const getTrack=useCallback((id:string)=>tracksRef.current.find(track=>track.id===id),[]);
  const artworkDiscovery=useArtworkDiscovery(player.track,autoArtwork,applyDiscoveredArtwork,getTrack);
  const changeAutoArtwork=(value:boolean)=>{setAutoArtwork(value);writeSetting('auto-artwork',value);};
  const toggleFavorite = (track: Track) => updateTrack(track.id, {favorite: !track.favorite});
  const chooseTrack = (track: Track) => player.select(track.id);

  const enqueueImport = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const task = importQueue.current.then(operation, operation);
    importQueue.current = task.catch(() => undefined);
    return task;
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    if (!loaded) return;
    return enqueueImport(async () => {
      setBusy(true);
      try {
        const audioFiles = files.filter(f => /\.(mp3|flac|m4a|ogg|wav)$/i.test(f.name));
        const lyricFiles = files.filter(f => /\.(lrc|txt)$/i.test(f.name));
        if (!audioFiles.length && !lyricFiles.length) {notify('请选择 MP3 / FLAC / M4A / OGG / WAV 音乐，或 LRC / TXT 歌词文件'); return;}
        const lyrics = new Map<string, {text: string; name: string}>();
        for (const file of lyricFiles) lyrics.set(fileStem(file.name), {text: await readLyricFile(file), name: file.name});
        const imported: Track[] = [];
        for (const file of audioFiles) {
          try {const track=await readTrack(file);if(!track.artwork){track.artwork=await localArtwork(track,files);if(track.artwork)track.artworkSource='local';}imported.push(track);}
          catch { notify(`无法读取 ${file.name}，请尝试其他音频文件`); }
        }
        const latestTracks = tracksRef.current;
        const merged = [...latestTracks];
        let added = 0, matched = 0;
        const used = new Set<string>();
        for (const incoming of imported) {
          const existing = merged.find(t => t.id === incoming.id);
          if (!existing) {merged.push(incoming); added++;}
          else if(!existing.artwork && incoming.artwork){const index=merged.indexOf(existing);merged[index]={...existing,artwork:incoming.artwork,artworkSource:incoming.artworkSource};}
        }
        for (let i = 0; i < merged.length; i++) {
          const key = fileStem(merged[i].file.name); const lyric = lyrics.get(key);
          if (lyric) {merged[i] = {...merged[i], lyrics: lyric.text, lyricFile: lyric.name}; used.add(key); matched++;}
        }
        const unmatched = [...lyrics.entries()].filter(([key]) => !used.has(key));
        if (unmatched.length === 1 && !audioFiles.length && player.currentId) {
          const index = merged.findIndex(t => t.id === player.currentId);
          if (index >= 0) {merged[index] = {...merged[index], lyrics: unmatched[0][1].text, lyricFile: unmatched[0][1].name}; matched++; used.add(unmatched[0][0]);}
        }
        tracksRef.current = merged; setTracks(merged);
        for (const track of merged) if (imported.some(t => t.id === track.id) || track !== latestTracks.find(t => t.id === track.id)) persist(track);
        if (added) {notify(`已导入 ${added} 首音乐${matched ? `，匹配 ${matched} 份歌词` : ''}`); setSection(current => current === 'online' ? current : 'all'); setSearch('');}
        else if (matched) notify(`已添加 ${matched} 份歌词`);
        else if (audioFiles.length) notify('这些音乐已经在曲库里了');
        if (lyrics.size > used.size) notify('部分歌词未匹配：请使用与音频相同的文件名，或选中歌曲后单独导入一份歌词');
      } catch { notify('文件读取失败，请重新选择文件'); }
      finally {setBusy(false);}
    });
  }, [loaded, player.currentId, notify, persist, enqueueImport]);

  const importDownloaded = useCallback((job: DownloadJob, force = false): Promise<string | undefined> => {
    const trackId = `download:${job.id}`;
    const version = removalVersions.current.get(trackId) || 0;
    const wasRemoved = () => (removalVersions.current.get(trackId) || 0) !== version;
    const removedError = () => new Error('这首歌曲刚刚已被移除，本次加入已取消。需要时可再次加入曲库');
    return enqueueImport(async () => {
      if (wasRemoved()) throw removedError();
      if (!force && (await loadImportedDownloadIds()).includes(job.id)) return;
      const file = await downloadFile(job, 'audio');
      const incoming = await readTrack(file);
      incoming.id = trackId;
      incoming.title = job.song.title || incoming.title;
      incoming.artist = job.song.artist || incoming.artist;
      incoming.album = job.song.album || incoming.album;
      incoming.duration ||= job.song.duration || 0;
      let warning: string | undefined;
      if (job.hasLyrics) {
        try {const lyrics = await downloadFile(job, 'lyrics'); incoming.lyrics = await readLyricFile(lyrics); incoming.lyricFile = lyrics.name;}
        catch {warning = '音频已加入曲库，歌词读取失败。可以使用保存歌词后单独导入';}
      }
      const existing = tracksRef.current.find(track => track.id === incoming.id);
      if (existing) {incoming.favorite = existing.favorite; incoming.addedAt = existing.addedAt; incoming.lastPlayed = existing.lastPlayed; incoming.artworkSource=existing.artwork?existing.artworkSource:incoming.artworkSource;incoming.artworkProvider=existing.artwork?existing.artworkProvider:incoming.artworkProvider;incoming.artworkFit=existing.artwork?existing.artworkFit:incoming.artworkFit;incoming.artwork = existing.artwork || incoming.artwork;}
      if (wasRemoved()) throw removedError();
      try {await saveDownloadedTrack(incoming, job.id);}
      catch {throw new Error('加入曲库未保存成功，请检查浏览器存储空间后重试；下载文件仍然保留');}
      if (wasRemoved()) {
        await deleteTrack(trackId);
        throw removedError();
      }
      const latest = tracksRef.current;
      const next = latest.some(track => track.id === incoming.id) ? latest.map(track => track.id === incoming.id ? {...incoming, favorite:track.favorite, lastPlayed:track.lastPlayed, artwork:track.artwork || incoming.artwork,artworkSource:track.artwork?track.artworkSource:incoming.artworkSource,artworkProvider:track.artwork?track.artworkProvider:incoming.artworkProvider,artworkFit:track.artwork?track.artworkFit:incoming.artworkFit} : track) : [...latest, incoming];
      tracksRef.current = next; setTracks(next);
      notify(`「${incoming.title}」已加入曲库${warning ? '，歌词可稍后导入' : ''}`);
      return warning;
    });
  }, [enqueueImport, notify]);

  const remove = (track: Track) => {
    removalVersions.current.set(track.id, (removalVersions.current.get(track.id) || 0) + 1);
    const remaining=tracksRef.current.filter(t=>t.id!==track.id);tracksRef.current=remaining;setTracks(remaining);
    void deleteTrack(track.id).catch(() => notify('本次已移除，但保存失败，刷新后可能重新出现'));
    notify(`已从曲库移除「${track.title}」`);
  };
  const openImport = () => fileInput.current?.click();
  const openLyrics = () => { if (!player.track) {notify('先导入音乐，再为它添加歌词'); openImport();} else lyricsInput.current?.click(); };
  const openArtwork = () => {if(player.track)setArtworkManagerId(player.track.id);};
  const setArtwork = async(file?:File) => {
    const id=artworkTarget.current || player.currentId;
    if(!file || !id)return;
    try {
      if(!/\.(jpe?g|png|webp)$/i.test(file.name) || file.size>20*1024*1024)throw new Error('请选择 20 MB 以内的 JPG、PNG 或 WEBP 图片');
      const bitmap=await createImageBitmap(file);bitmap.close();
      if(!tracksRef.current.some(track=>track.id===id))return;
      updateTrack(id,{artwork:file,artworkSource:'manual',artworkProvider:undefined,artworkFit:undefined});notify('专辑封面已更新');
    }catch(error){notify(error instanceof Error ? error.message : '这张图片无法读取，请换一张图片');}
    finally{artworkTarget.current=null;}
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {if(themeOpen || artworkManagerId) return; if(!queueOpen && !settingsOpen && section === 'playing') setSection('all'); setQueueOpen(false); setSettingsOpen(false); setSidebarOpen(false); setImmersive(false); return;}
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, button, dialog') || e.ctrlKey || e.metaKey || e.altKey || themeOpen || artworkManagerId) return;
      if (e.code === 'Space') {e.preventDefault(); player.toggle();}
      if (e.key === 'ArrowRight') {e.preventDefault(); player.seek(player.time + 5);}
      if (e.key === 'ArrowLeft') {e.preventDefault(); player.seek(player.time - 5);}
      if (e.key === 'ArrowUp') {e.preventDefault(); player.setVolume(player.volume + .05);}
      if (e.key === 'ArrowDown') {e.preventDefault(); player.setVolume(player.volume - .05);}
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [player, themeOpen, queueOpen, settingsOpen, section,artworkManagerId]);

  const filtered = useMemo(() => {
    let items = tracks.filter(t => (section !== 'favorites' || t.favorite) && (section !== 'recent' || t.lastPlayed));
    if(section === 'recent') items.sort((a,b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    const query = search.trim().toLowerCase();
    return items.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(query));
  }, [tracks, section, search]);
  const themeName = themes.find(t => t.id === theme)?.name;
  const artworkManagerTrack=tracks.find(track=>track.id===artworkManagerId);
  const duration = player.duration || player.track?.duration || 0;
  const chooseSection = (next: Section) => {setSection(next); setSidebarOpen(false); setImmersive(false); if(next === 'all') setSearch('');};
  const openPlayback = () => {setSection('playing'); setSidebarOpen(false); setImmersive(false);};

  return <div className={`app-shell ${player.playing ? 'is-playing' : ''} ${section === 'playing' ? 'vinyl-view' : 'library-view'} ${mobileLyrics ? 'show-mobile-lyrics' : ''}`}
    onDragEnter={e => {e.preventDefault(); if (e.dataTransfer.types.includes('Files')) {dragDepth.current++; setDragging(true);}}}
    onDragOver={e => e.preventDefault()} onDragLeave={e => {e.preventDefault(); if (--dragDepth.current <= 0) {setDragging(false); dragDepth.current = 0;}}}
    onDrop={e => {e.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(Array.from(e.dataTransfer.files));}}>
    <WindowChrome/>
    {player.track?.artwork && <div className="space-atmosphere" aria-hidden="true"><Artwork blob={player.track.artwork}/></div>}
    <audio ref={player.audioRef} preload="metadata" onTimeUpdate={e => player.setTime(e.currentTarget.currentTime)} onDurationChange={e => player.setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} onPlay={() => {player.setPlaying(true); if(player.currentId) updateTrack(player.currentId, {lastPlayed:Date.now()});}} onPause={() => player.setPlaying(false)} onEnded={() => player.next(true)} onError={() => {player.setPlaying(false); notify('浏览器无法解码这份音频。文件仍已保存，可以保存音频后使用其他播放器');}}/>
    <input ref={fileInput} type="file" accept=".mp3,.flac,.m4a,.ogg,.wav,.lrc,.txt,.jpg,.jpeg,.png,.webp" multiple hidden disabled={busy || !loaded} onChange={e => {void importFiles(Array.from(e.target.files || [])); e.target.value = '';}}/>
    <input ref={lyricsInput} type="file" accept=".lrc,.txt" hidden disabled={busy || !loaded} onChange={e => {void importFiles(Array.from(e.target.files || [])); e.target.value = '';}}/>
    <input ref={artworkInput} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={e=>{void setArtwork(e.target.files?.[0]);e.target.value='';}}/>

    {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}/>}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#" onClick={e => {e.preventDefault(); chooseSection('all');}}><span className="brand-mark"><AudioLines size={24}/></span><span className="brand-name">澄音<span>C L E A R</span></span></a>
      <div className="sidebar-label">你的音乐空间</div>
      <nav aria-label="曲库导航"><button onClick={openPlayback}><Disc3 size={18}/><span>正在播放</span></button><button className={section === 'online' ? 'nav-active' : ''} onClick={() => chooseSection('online')}><Search size={18}/><span>在线找歌</span></button><button aria-label="本地音乐，我的曲库" className={section === 'all' ? 'nav-active' : ''} onClick={() => chooseSection('all')}><Library size={18}/><span>我的曲库</span><small>{tracks.length}</small></button><button className={section === 'favorites' ? 'nav-active' : ''} onClick={() => chooseSection('favorites')}><Heart size={18}/><span>我的喜欢</span><small>{tracks.filter(t => t.favorite).length}</small></button><button className={section === 'recent' ? 'nav-active' : ''} onClick={() => chooseSection('recent')}><History size={18}/><span>最近播放</span></button></nav>
      <div className="sidebar-divider"/>
      <div className="sidebar-label collection-heading">我的收藏夹<span>LOCAL ONLY</span></div>
      <button className="collection" onClick={() => chooseSection('all')}><span><Disc3 size={19}/></span><div>私人音乐收藏<small>{tracks.length ? `${tracks.length} 首，都是心头好` : '好音乐，慢慢收藏'}</small></div><ChevronRight size={13}/></button>
      <div className="sidebar-spacer"/>
      <div className="local-note"><span className="note-icon"><Headphones size={21}/></span><h3>只属于你的音乐。</h3><p>找到喜欢的歌<br/>下载，留给每个此刻。</p><span className="local-status"><i/>文件仅保存在本机</span></div>
      <button className="appearance-link" onClick={() => setThemeOpen(true)}><Palette size={17}/><div>外观与氛围<small>{themeName}</small></div><ChevronRight size={14}/></button>
      <div className="sidebar-version">CLEAR PLAYER<span>V 1.0</span></div>
    </aside>

    <main className="main-content">
      <VinylPlayer audioRef={player.audioRef} visible={section === 'playing'} track={player.track} playing={player.playing} time={player.time} focused={immersive} onBack={() => chooseSection('all')} onTheme={() => setThemeOpen(true)} onFavorite={() => player.track && toggleFavorite(player.track)} onSeek={player.seek} onImport={openLyrics} onFocus={() => setImmersive(!immersive)} onArtwork={openArtwork} artworkStatus={artworkDiscovery.status} autoArtwork={autoArtwork} onFindArtwork={artworkDiscovery.retry}/>
      <header className="topbar"><div className="breadcrumb"><IconButton label="打开导航" className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20}/></IconButton><span>音乐空间</span><ChevronRight size={12}/><strong>{section === 'online' ? '在线找歌' : section === 'favorites' ? '我的喜欢' : section === 'recent' ? '最近播放' : '本地音乐'}</strong></div><div className="topbar-actions">{section !== 'online' && <label className="search-box"><Search size={16}/><input placeholder="搜索音乐、歌手" value={search} onChange={e => setSearch(e.target.value)}/><kbd>⌕</kbd></label>}<IconButton label="外观预设" onClick={() => setThemeOpen(true)}><Palette size={18}/></IconButton><span className="topbar-rule"/><span className="avatar">C<span/></span></div></header>
      <div className="page-content">
        <OnlineMusic visible={section === 'online'} ready={loaded} onImport={importDownloaded}/>
        <div hidden={section === 'online'}>

        <section className="page-heading"><div><div className="eyebrow"><span className="status-dot"/>YOUR PERSONAL SOUNDSPACE</div><h1>{section === 'favorites' ? '偏爱，值得重听。' : section === 'recent' ? '余音，还在这里。' : '我的曲库'}</h1><p>{section === 'all' ? '所有喜欢的声音，都在这里。' : section === 'favorites' ? '把喜欢留下，让每次相遇都有回响。' : '循着旋律，回到那些喜欢的瞬间。'}</p></div><button className="primary-button import-main" onClick={openImport} disabled={busy || !loaded}>{busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={17}/>} {busy ? '正在导入' : '导入音乐'}<span>AUDIO</span></button></section>        <div className="workspace-tabs"><div className="active"><span className="tab-dot"/>{section === 'favorites' ? '喜欢的歌曲' : section === 'recent' ? '聆听记录' : '全部歌曲'}<small>{filtered.length} 首</small></div><button className="library-player-link" onClick={openPlayback}><Disc3 size={14}/>进入播放界面<ChevronRight size={13}/></button></div>
        <div className="listening-space">
          <section className="now-playing" aria-label="正在播放"><div className="now-playing-top"><span><span className={`equalizer ${player.playing ? 'animated' : ''}`}><i/><i/><i/><i/></span>{player.playing ? 'NOW PLAYING' : 'READY WHEN YOU ARE'}</span><span className="quality-badge">LOCAL AUDIO</span></div>
            <div className="cover-stage"><div className="cover-halo"/><div className="cover-frame"><Artwork blob={player.track?.artwork}/><div className="cover-shine"/></div><div className="cover-reflection"/></div>
            <div className="track-meta"><div><h2>{player.track?.title || '音乐，自在此间。'}</h2><p>{player.track ? `${player.track.artist}${player.track.album ? ` · ${player.track.album}` : ''}` : '你的下一首心动，正等待播放'}</p></div><IconButton label={player.track?.favorite ? '取消收藏当前歌曲' : '收藏当前歌曲'} active={player.track?.favorite} disabled={!player.track} onClick={() => player.track && toggleFavorite(player.track)}><Heart size={21} fill={player.track?.favorite ? 'currentColor' : 'none'}/></IconButton></div>
            <div className="cover-caption"><Waves size={14}/><span>{player.track ? '抛开喧嚣，留一点时间给音乐' : '从一首喜欢的歌开始'}</span><span className="caption-rule"/></div><button className="open-record-button" onClick={openPlayback} aria-label="进入黑胶播放页"><Disc3 size={16}/><span>黑胶播放页</span><ChevronRight size={13}/></button>
          </section>
        </div>

        <section className="library-section" aria-label="本地曲库"><div className="library-heading"><div><h2>{section === 'favorites' ? '我的喜欢' : section === 'recent' ? '最近播放' : '我的曲库'}<span>{filtered.length} 首音乐</span></h2><p>{section === 'all' ? '收藏每一个让你按下播放的瞬间' : '旋律会记得，你喜欢的样子'}</p></div><div className="library-artwork-actions"><button className="text-button" disabled={!tracks.length} onClick={()=>setArtworkManagerId(player.currentId||tracks[0].id)}><Sparkles size={14}/>补齐封面</button><button className="text-button" onClick={openImport} disabled={busy || !loaded}><FolderOpen size={15}/><span>添加本地文件</span></button></div></div>
          {filtered.length ? <div className="track-list"><div className="track-table-head"><span>#</span><span>歌曲 / 歌手</span><span>专辑</span><span>时长</span><span/></div>{filtered.map((track, i) => <div className={`track-row ${track.id === player.currentId ? 'current-track' : ''}`} key={track.id}><button className="track-play" aria-label={`播放 ${track.title}`} onClick={() => chooseTrack(track)}>{track.id === player.currentId && player.playing ? <span className="equalizer animated"><i/><i/><i/></span> : <><span className="track-number">{String(i + 1).padStart(2, '0')}</span><Play className="row-play-icon" size={14} fill="currentColor"/></>}</button><button className="track-title" onClick={() => chooseTrack(track)}><Artwork blob={track.artwork}/><span><strong>{track.title}</strong><small>{track.artist}{track.lyrics && <span className="has-lyric-tag">词</span>}</small></span></button><span className="track-album">{track.album || '本地音乐'}</span><span className="track-duration">{formatTime(track.duration)}</span><div className="track-actions"><IconButton label={`${track.favorite ? '取消收藏' : '收藏'} ${track.title}`} active={track.favorite} onClick={() => toggleFavorite(track)}><Heart size={15} fill={track.favorite ? 'currentColor' : 'none'}/></IconButton><IconButton label={`移除 ${track.title}`} onClick={() => remove(track)}><X size={15}/></IconButton></div></div>)}</div> : search || section !== 'all' ? <div className="empty-results"><Search size={22}/><p>{search ? '没有找到这首音乐，换个关键词试试' : section === 'favorites' ? '点亮歌曲旁的爱心，把喜欢收藏在这里' : '播放一首音乐，你的聆听足迹会留在这里'}</p></div> : <button className="import-dropzone" onClick={openImport} disabled={busy || !loaded}><span className="upload-icon">{busy ? <LoaderCircle size={23} className="spin"/> : <ArrowDownToLine size={23}/>}</span><div><h3>{loaded ? '把喜欢的声音，留在这里。' : '正在打开你的音乐空间…'}</h3><p>拖入音乐与歌词，或<span>选择本地文件<ArrowUpRight size={12}/></span></p></div><span className="file-types">MP3 / FLAC / M4A<span>＋</span>LRC / TXT</span></button>}
          <div className="library-foot"><span><CheckCircle2 size={12}/>纯本地播放 · 音乐不会被上传</span><span>好音乐，值得用心聆听。</span></div>
        </section>
        </div>
      </div>
    </main>

    <footer className="player-bar" aria-label="播放控制栏"><div className="mini-track"><Artwork blob={player.track?.artwork}/><button className="mini-info" aria-label="打开播放界面" onClick={openPlayback}><strong>{player.track?.title || '还没有正在播放的音乐'}</strong><span>{player.track?.artist || '导入一首，开启好心情'}</span></button><IconButton label={player.track?.favorite ? '取消迷你播放器收藏' : '收藏迷你播放器歌曲'} active={player.track?.favorite} disabled={!player.track} onClick={() => player.track && toggleFavorite(player.track)}><Heart size={17} fill={player.track?.favorite ? 'currentColor' : 'none'}/></IconButton></div>
      <div className="playback-center"><div className="transport-controls"><IconButton label={modeLabels[player.mode]} active={player.mode !== 'order'} onClick={() => {const modes = ['order','shuffle','repeat'] as const; const next = modes[(modes.indexOf(player.mode) + 1) % 3]; player.setMode(next); notify(`已切换为${modeLabels[next]}`);}}>{player.mode === 'repeat' ? <Repeat1 size={17}/> : player.mode === 'shuffle' ? <Shuffle size={17}/> : <ListMusic size={18}/>}</IconButton><IconButton label="上一首" disabled={!tracks.length} onClick={player.previous}><SkipBack size={20} fill="currentColor"/></IconButton><button className="play-button" aria-label={player.playing ? '暂停' : '播放'} title="空格 · 播放 / 暂停" onClick={player.toggle}>{player.playing ? <Pause size={21} fill="currentColor"/> : <Play size={21} fill="currentColor"/>}</button><IconButton label="下一首" disabled={!tracks.length} onClick={() => player.next()}><SkipForward size={20} fill="currentColor"/></IconButton><IconButton label="显示歌词" active={section === 'playing'} onClick={() => {if(section !== 'playing') openPlayback(); else setImmersive(!immersive);}}><AudioLines size={18}/></IconButton></div><div className="progress-control"><span>{formatTime(player.time)}</span><input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(player.time, duration || 0)} disabled={!duration} onChange={e => player.seek(Number(e.target.value))} style={{'--range-progress': `${duration ? player.time / duration * 100 : 0}%`} as React.CSSProperties}/><span>{formatTime(duration)}</span></div></div>
      <div className="player-extras"><div className="volume-control"><IconButton label={player.muted ? '取消静音' : '静音'} onClick={() => player.setMuted(!player.muted)}>{player.muted || !player.volume ? <VolumeX size={19}/> : player.volume < .5 ? <Volume1 size={19}/> : <Volume2 size={19}/>}</IconButton><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={player.muted ? 0 : player.volume} onChange={e => player.setVolume(Number(e.target.value))} style={{'--range-progress': `${player.muted ? 0 : player.volume * 100}%`} as React.CSSProperties}/></div><span className="extras-divider"/><IconButton label="播放设置" active={settingsOpen} onClick={() => {setSettingsOpen(!settingsOpen); setQueueOpen(false);}}><SlidersHorizontal size={17}/></IconButton><IconButton label="播放队列" active={queueOpen} onClick={() => {setQueueOpen(!queueOpen); setSettingsOpen(false);}}><ListMusic size={20}/></IconButton><span className="queue-count">{tracks.length}</span></div>
    </footer>

    {settingsOpen && <section className="queue-panel playback-settings" aria-label="播放设置面板"><div className="panel-heading"><h2>播放设置</h2><IconButton label="关闭播放设置" onClick={() => setSettingsOpen(false)}><X size={18}/></IconButton></div><div className="settings-body"><span className="settings-label">播放模式</span><div className="mode-options">{(['order','shuffle','repeat'] as const).map(mode => <button key={mode} aria-pressed={mode === player.mode} className={mode === player.mode ? 'selected' : ''} onClick={() => player.setMode(mode)}>{mode === 'order' ? <ListMusic size={14}/> : mode === 'shuffle' ? <Shuffle size={14}/> : <Repeat1 size={14}/>} {modeLabels[mode]}</button>)}</div><div className="settings-volume"><IconButton label={player.muted ? '播放设置取消静音' : '播放设置静音'} onClick={() => player.setMuted(!player.muted)}>{player.muted || !player.volume ? <VolumeX size={18}/> : <Volume2 size={18}/>}</IconButton><input aria-label="设置音量" type="range" min="0" max="1" step="0.01" value={player.muted ? 0 : player.volume} onChange={e => player.setVolume(Number(e.target.value))} style={{'--range-progress': `${player.muted ? 0 : player.volume * 100}%`} as React.CSSProperties}/><span>{Math.round((player.muted ? 0 : player.volume) * 100)}%</span></div><div className="artwork-setting"><label><span>自动联网补全封面</span><input type="checkbox" checked={autoArtwork} onChange={e=>changeAutoArtwork(e.target.checked)}/></label><p>优先使用本地封面。缺少时从 Apple、网易云、QQ 音乐查找，不上传音频，版本不确定时由你选图。</p></div></div></section>}
    {queueOpen && <section className="queue-panel" aria-label="播放队列"><div className="panel-heading"><h2>播放队列 <small>{tracks.length}</small></h2><IconButton label="关闭播放队列" onClick={() => setQueueOpen(false)}><X size={18}/></IconButton></div>{tracks.length ? <div className="queue-list">{tracks.map((track, i) => <button key={track.id} className={track.id === player.currentId ? 'queue-current' : ''} onClick={() => chooseTrack(track)}><span>{String(i+1).padStart(2,'0')}</span><Artwork blob={track.artwork}/><div><strong>{track.title}</strong><small>{track.artist}</small></div>{track.id === player.currentId && <AudioLines size={16}/>}</button>)}</div> : <div className="queue-empty"><Music2 size={30}/><p>第一首音乐，等你来添加</p><button className="primary-button" onClick={openImport}><Plus size={15}/>导入音乐</button></div>}<div className="queue-footer">{modeLabels[player.mode]}<span>共 {tracks.length} 首</span></div></section>}
    {artworkManagerTrack&&<ArtworkManager track={artworkManagerTrack} tracks={tracks} state={artworkDiscovery.states[artworkManagerTrack.id]} batch={artworkDiscovery.batch} onClose={()=>setArtworkManagerId(null)} onTarget={setArtworkManagerId} onImport={()=>{artworkTarget.current=artworkManagerTrack.id;artworkInput.current?.click();}} onFit={fit=>saveArtworkFit(artworkManagerTrack.id,fit)} onSearch={query=>artworkDiscovery.search(query,{refresh:true,review:true})} onChoose={candidate=>artworkDiscovery.choose(artworkManagerTrack.id,candidate)} onBatch={()=>artworkDiscovery.startBatch(tracksRef.current)} onStop={artworkDiscovery.cancelBatch}/>}
    {artworkDiscovery.batch.running&&!artworkManagerTrack&&<button className="artwork-batch-notice" onClick={()=>setArtworkManagerId(player.currentId||tracks[0]?.id||null)}><LoaderCircle size={13} className="spin"/>封面补齐 {artworkDiscovery.batch.done} / {artworkDiscovery.batch.total}<span>查看进度</span></button>}
    {themeOpen && <ThemePicker theme={theme} onChange={setTheme} onClose={() => setThemeOpen(false)}/>}
    {toast && <div className="toast" role="status"><Check size={16}/><span>{toast}</span><button onClick={() => setToast('')} aria-label="关闭提示"><X size={14}/></button></div>}
    {dragging && <div className="drag-overlay"><div><Upload size={44} strokeWidth={1.3}/><h2>松开，让音乐进来。</h2><p>MP3 / FLAC / M4A / OGG / WAV · LRC / TXT 歌词</p></div></div>}
  </div>;
}
