import {AudioLines, ChevronDown, Disc3, Heart, Palette,LoaderCircle,RefreshCw} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {Track} from '../types';
import {Artwork} from './Artwork';
import {IconButton} from './IconButton';
import {LyricsPanel} from './LyricsPanel';
import {readSetting,writeSetting} from '../lib/storage';
import {PlaybackAtmosphere} from './PlaybackAtmosphere';
import type {ArtworkStatus} from '../hooks/useArtworkDiscovery';

interface Props {
  audioRef:RefObject<HTMLAudioElement|null>;
  visible:boolean;
  track?:Track;
  playing:boolean;
  time:number;
  focused:boolean;
  onBack:()=>void;
  onTheme:()=>void;
  onFavorite:()=>void;
  onSeek:(time:number)=>void;
  onImport:()=>void;
  onFocus:()=>void;
  onArtwork:()=>void;
  artworkStatus:ArtworkStatus;
  autoArtwork:boolean;
  onFindArtwork:()=>void;
}

export function VinylPlayer({audioRef,visible,track,playing,time,focused,onBack,onTheme,onFavorite,onSeek,onImport,onFocus,onArtwork,artworkStatus,autoArtwork,onFindArtwork}:Props){
  const [pageVisible,setPageVisible]=useState(!document.hidden);
  const nativeVisible=useRef(true);
  useEffect(()=>{
    const change=()=>setPageVisible(!document.hidden&&nativeVisible.current);
    const unsubscribe=window.clearDesktop?.onVisibility(visible=>{nativeVisible.current=visible;change();});
    document.addEventListener('visibilitychange',change);
    return()=>{unsubscribe?.();document.removeEventListener('visibilitychange',change);};
  },[]);
  const [layout,setLayout]=useState<'vinyl'|'stage'>(()=>readSetting<string>('player-layout','vinyl')==='stage'?'stage':'vinyl');
  const chooseLayout=(next:'vinyl'|'stage')=>{setLayout(next);writeSetting('player-layout',next);};
  return <section hidden={!visible} data-moving={visible&&playing&&pageVisible} className={`vinyl-player ${focused?'lyrics-focused':''} ${layout==='stage'?'lyric-stage':''}`} aria-label="黑胶播放界面">
    <PlaybackAtmosphere artwork={track?.artwork} audioRef={audioRef} active={visible&&playing&&pageVisible}/>
    <header className="vinyl-topbar"><button className="back-to-library" onClick={onBack} aria-label="返回曲库"><ChevronDown size={23}/><span>返回曲库</span></button><span className="vinyl-wordmark"><Disc3 size={14}/>CLEAR<span>正在播放</span></span><div className="vinyl-view-actions"><div className="player-layout-switch" role="group" aria-label="播放页布局"><button onClick={()=>chooseLayout('vinyl')} aria-pressed={layout==='vinyl'}><Disc3 size={14}/><span>黑胶唱片</span></button><button onClick={()=>chooseLayout('stage')} aria-pressed={layout==='stage'}><AudioLines size={14}/><span>歌词舞台</span></button></div><IconButton label="外观预设" onClick={onTheme}><Palette size={20}/></IconButton></div></header>
    <div className="vinyl-canvas">
      <div className="vinyl-song"><div className="vinyl-song-title"><h1>{track?.title || '音乐，自在此间。'}</h1><IconButton label={track?.favorite?'取消收藏当前歌曲':'收藏当前歌曲'} active={track?.favorite} disabled={!track} onClick={onFavorite}><Heart size={22} fill={track?.favorite?'currentColor':'none'}/></IconButton></div><p>{track?.artist || '导入一首喜欢的歌，开始聆听'}{track?.album && <span> · {track.album}</span>}</p></div>
      <div className="vinyl-disc-area"><div className="vinyl-disc-shadow" aria-hidden="true"/><div className="vinyl-record" style={{animationPlayState:playing?'running':'paused'}}><div className="vinyl-grooves" aria-hidden="true"/><button className="vinyl-label" disabled={!track} onClick={onArtwork} aria-label={track?.artwork?'更换专辑封面':'设置专辑封面'} title={track?.artwork?'点击管理封面与构图':'点击查找或添加专辑封面'}>{track?.artwork?<Artwork blob={track.artwork} autoTrim fit={track.artworkFit}/>:<div className="vinyl-missing-art"><Disc3 size={38} strokeWidth={1}/><span>{track?.album||'专辑封面'}</span><small>{track?'点击查找封面':'等待下一首心动'}</small></div>}</button><div className="vinyl-sheen" aria-hidden="true"/><i className="vinyl-spindle" aria-hidden="true"/></div></div>
      <div className="vinyl-lyrics"><LyricsPanel track={track} time={time} onSeek={onSeek} onImport={onImport} immersive={focused} onImmersive={onFocus} layoutKey={layout} visible={visible}/></div>
      {track&&<div className="vinyl-artwork-note" aria-live="polite">{track.artwork?<><span className="gold-mark"/>{track.artworkSource==='online'?`专辑封面 · ${track.artworkProvider||'Apple Music'}`:'专辑封面 · 本地珍藏'}</>:<><span>{artworkStatus==='loading'?<><LoaderCircle size={11} className="spin"/>正在寻找专辑封面</>:artworkStatus==='review'?'找到候选封面，待你选择':artworkStatus==='error'?'暂时无法联网，可手动选图':artworkStatus==='missing'?'未找到匹配封面，可调整关键词':autoArtwork?'专辑封面待补全':'点击唱片，添加专辑封面'}</span>{autoArtwork&&artworkStatus!=='loading'&&<button onClick={onFindArtwork} aria-label="重新查找专辑封面"><RefreshCw size={10}/>重试</button>}</>}<button onClick={onArtwork}>封面与构图</button></div>}
      <div className="vinyl-footnote"><span className="status-dot"/>{playing?'让旋律，慢慢转动。':'停一会儿，音乐在这里。'}</div>
    </div>
  </section>;
}
