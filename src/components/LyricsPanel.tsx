import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronDown, FileMusic, LocateFixed, Maximize2, Minimize2, Plus } from 'lucide-react';
import { parseLyrics, lyricIndex } from '../lib/lyrics';
import type { Track } from '../types';
import { IconButton } from './IconButton';
export function LyricsPanel({track, time, onSeek, onImport, immersive, onImmersive, layoutKey, visible=true}: {track?: Track; time: number; onSeek: (time: number) => void; onImport: () => void; immersive: boolean; onImmersive: () => void; layoutKey?: string; visible?: boolean}) {
  const lyrics = useMemo(() => parseLyrics(track?.lyrics || ''), [track?.lyrics]);
  const index = lyricIndex(lyrics.lines, time);
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => { setFollow(true); }, [track?.id]);
  useEffect(() => {
    if (!visible || !follow || index < 0) return;
    const container = scroller.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${index}"]`);
    if (container && line) container.scrollTo({top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }, [index, follow, immersive, layoutKey, visible]);
  return <section className={`lyrics-panel ${lyrics.lines.length ? 'has-lyrics' : ''}`} aria-label="歌词">
    <div className="panel-heading"><span><AudioLines size={15}/>歌词<span className="tiny-pill">{lyrics.synced ? '同步' : lyrics.lines.length ? '文本' : 'LYRICS'}</span></span><IconButton label={immersive ? '退出沉浸模式' : '沉浸歌词'} onClick={onImmersive}>{immersive ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</IconButton></div>
    {lyrics.lines.length ? <><div ref={scroller} className="lyric-scroll" onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
      <div className="lyric-spacer"/>{lyrics.lines.map((line, i) => <button key={i} data-line={i} className={`lyric-line ${index === i ? 'current' : ''} ${index > i ? 'past' : ''}`} disabled={line.time === null} onClick={() => {if(line.time !== null) { onSeek(line.time); setFollow(true); }}}>{line.text || '♪'}</button>)}<div className="lyric-spacer"/>
    </div><div className="lyrics-bottom">{!follow && lyrics.synced ? <button className="text-button" onClick={() => setFollow(true)}><LocateFixed size={13}/>回到当前歌词</button> : <span>{lyrics.synced ? '点击任意一句，回到那个瞬间' : '纯文本歌词 · 暂不支持同步'}</span>}<IconButton label="替换歌词" onClick={onImport}><Plus size={15}/></IconButton></div></> : <div className="lyrics-empty"><div className="lyric-decoration"><i/><i/><i/><i/><i/></div><div className="lyric-empty-icon"><FileMusic size={25} strokeWidth={1.3}/></div><h3>让每一句，都被听见。</h3><p>{track ? '为这首歌添上歌词\n让文字，跟着旋律一起流动' : '旋律之外，还有文字的温度\n导入音乐与歌词，开启你的聆听时刻'}</p><button className="lyric-import" onClick={onImport}><Plus size={15}/>导入歌词<span>LRC / TXT</span></button><div className="lyric-empty-foot"><ChevronDown size={13}/>支持同名歌词自动匹配</div></div>}
  </section>;
}
