import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, Disc3, LoaderCircle, Radio, Search } from 'lucide-react';
import { api } from '../lib/online';
import type { DownloadJob, OnlineSong } from '../lib/online';
import { formatTime } from '../lib/library';
import { loadImportedDownloadIds } from '../lib/storage';
import './OnlineMusic.css';

type Warning = string | {source?:string; message?:string; error?:string};
const labels: Record<DownloadJob['status'], string> = {queued:'等待下载',resolving:'正在获取音频',downloading:'正在下载',paused:'已暂停',completed:'已完成',failed:'下载失败',cancelled:'已取消'};
const bytes = (n: number) => n >= 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.round(n/1024)} KB`;
export function OnlineMusic({visible, ready, onImport}: {visible:boolean; ready:boolean; onImport:(job:DownloadJob, force?:boolean) => Promise<string | undefined>}) {
  const [sources, setSources] = useState<{id:string;name:string}[]>([]);
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<OnlineSong[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [serviceError, setServiceError] = useState('');
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [imports, setImports] = useState<Record<string,string>>({});
  const [importErrors, setImportErrors] = useState<Record<string,string>>({});
  const [importWarnings, setImportWarnings] = useState<Record<string,string>>({});
  const [receiptsReady, setReceiptsReady] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const attempted = useRef(new Set<string>());
  const mounted = useRef(true);
  const searchSequence = useRef(0);
  const refreshSources = useCallback(async () => {
    try {const data = await api<{sources:{id:string;name:string}[]}>('/sources'); if (mounted.current) {setSources(data.sources);setServiceError('');}}
    catch(error) {if (mounted.current) setServiceError((error as Error).message);}
  }, []);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void refreshSources();
    void loadImportedDownloadIds().then(ids => {
      if (!active) return;
      setImports(Object.fromEntries(ids.map(id => [id,'done']))); setReceiptsReady(true);
    }).catch(() => {if (active) {setServiceError('无法读取曲库保存记录，请检查浏览器存储设置后刷新');}});
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {const data = await api<{jobs:DownloadJob[]}>('/downloads');if (active) {setJobs(data.jobs);setServiceError('');}}
      catch(error) {if (active) setServiceError((error as Error).message);}
      if (active) timer = setTimeout(() => void poll(), 1200);
    };
    void poll();
    return () => {active=false;mounted.current=false;clearTimeout(timer);};
  }, [refreshSources]);
  const importJob = useCallback(async (job:DownloadJob, force=false) => {
    setImports(items => ({...items,[job.id]:'busy'}));
    setImportErrors(items => ({...items,[job.id]:''}));
    try {
      const warning = await onImport(job, force);
      if (mounted.current) {setImports(items => ({...items,[job.id]:'done'}));setImportWarnings(items => ({...items,[job.id]:warning || ''}));}
    } catch(error) {
      if (mounted.current) {setImports(items => ({...items,[job.id]:'failed'}));setImportErrors(items => ({...items,[job.id]:(error as Error).message || '加入曲库失败，请检查浏览器存储空间后重试'}));}
    }
  }, [onImport]);
  useEffect(() => {
    if (!ready || !receiptsReady) return;
    for (const job of jobs) if (job.status === 'completed' && !imports[job.id] && !attempted.current.has(job.id)) {
      attempted.current.add(job.id);void importJob(job);
    }
  }, [jobs, imports, ready, receiptsReady, importJob]);
  const search = async (e:React.FormEvent) => {
    e.preventDefault();if (!query.trim()) return;
    const sequence = ++searchSequence.current;
    setSearching(true);setSearchError('');setWarnings([]);setSongs([]);setSearched(true);
    try {
      const data = await api<{songs:OnlineSong[];warnings?:Warning[]}>(`/search?q=${encodeURIComponent(query.trim())}&source=${encodeURIComponent(source)}&limit=30`);
      if (sequence === searchSequence.current) {setSongs(data.songs);setWarnings(data.warnings || []);}
    } catch(error) {if (sequence === searchSequence.current) setSearchError((error as Error).message);}
    finally {if (sequence === searchSequence.current) setSearching(false);}
  };
  const act = async (key:string, action:() => Promise<{job:DownloadJob}>) => {
    if (pending.has(key)) return;
    setPending(items => new Set(items).add(key));
    try {const {job} = await action();setJobs(items => [job, ...items.filter(item => item.id !== job.id)]);setServiceError('');}
    catch(error) {setServiceError((error as Error).message);}
    finally {setPending(items => {const next = new Set(items);next.delete(key);return next;});}
  };
  return <section className="online-music" aria-label="在线音乐" hidden={!visible}>
    <header className="online-heading"><div><div className="eyebrow"><Radio size={12}/>DISCOVER & KEEP</div><h1>找到下一首喜欢。</h1><p>从音源寻找音乐，下载后留在自己的曲库。</p></div><span className="online-signal"><i/>在线找歌</span></header>
    <form className="online-search" onSubmit={e => void search(e)}><label><span>音源</span><select aria-label="选择音源" value={source} onChange={e => setSource(e.target.value)}><option value="all">全部音源</option>{sources.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="online-query"><Search size={18}/><input aria-label="在线搜索关键词" placeholder="输入歌名、歌手或专辑" value={query} onChange={e => setQuery(e.target.value)}/></label><button className="primary-button" type="submit" disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="spin" size={15}/> : <Search size={15}/>}搜索歌曲</button></form>
    {serviceError && <div className="online-message" role="alert"><span>{serviceError}</span><button onClick={() => void refreshSources()}>重新连接</button></div>}
    {searchError && <p className="online-message" role="alert">{searchError}</p>}
    {warnings.length > 0 && <div className="online-warnings" role="status">{warnings.map((warning,i) => <p key={i}>{typeof warning === 'string' ? warning : `${warning.source ? `${sources.find(s => s.id === warning.source)?.name || warning.source}：` : ''}${warning.message || warning.error || '音源暂不可用'}`}</p>)}</div>}
    <section className="online-results" aria-label="在线搜索结果"><div className="online-section-title"><h2>搜索结果 <span>{songs.length ? `${songs.length} 首` : ''}</span></h2><span>下载包含可用的歌词</span></div>
      {searching ? <div className="online-empty" role="status"><LoaderCircle className="spin" size={24}/><p>正在寻找音乐…</p></div> : songs.length ? <div className="online-song-list">{songs.map(song => <article className="online-song" key={song.key}><span className="online-disc"><Disc3 size={22}/></span><div className="online-song-meta"><h3>{song.title}</h3><p>{song.artist || '未知歌手'}{song.album ? ` · ${song.album}` : ''}</p><small>{sources.find(item => item.id === song.source)?.name || song.source} · {song.format?.toUpperCase() || '音源格式'}{song.duration ? ` · ${formatTime(song.duration)}` : ''}</small></div><button aria-label={`下载 ${song.title}`} className="online-download" disabled={pending.has(song.key)} onClick={() => void act(song.key, () => api('/downloads',{method:'POST',body:JSON.stringify({key:song.key,lyrics:true})}))}>{pending.has(song.key) ? <LoaderCircle className="spin" size={16}/> : <ArrowDownToLine size={16}/>}<span>下载</span></button></article>)}</div> : !searchError && <div className="online-empty"><Search size={26}/><p>{searched ? '没有找到歌曲，试试其他关键词或音源' : '输入一首歌，寻找喜欢的声音'}</p></div>}
    </section>
    <section className="online-downloads" aria-label="下载任务"><div className="online-section-title"><h2>下载与收藏 <span>{jobs.length ? `${jobs.length} 项` : ''}</span></h2><span>下载不会打断正在播放的音乐</span></div>{!jobs.length ? <p className="online-task-empty">下载的歌曲会出现在这里，完成后自动加入曲库。</p> : jobs.map(job => {
      const progress = job.total && job.total > 0 ? Math.min(100, Math.round(job.received/job.total*100)) : undefined;
      const control = (action:string, text:string) => <button disabled={pending.has(job.id)} onClick={() => void act(job.id, () => api(`/downloads/${encodeURIComponent(job.id)}/${action}`,{method:'POST'}))}>{text}</button>;
      return <article className={`online-task task-${job.status}`} aria-label={`下载任务 ${job.song.title}`} key={job.id}><div className="online-task-top"><div><strong>{job.song.title}</strong><span>{job.song.artist}</span></div><span className="online-task-status">{job.status === 'completed' && <CheckCircle2 size={13}/>}<span>{labels[job.status]}</span></span></div>
        {['queued','resolving','downloading','paused'].includes(job.status) && <><progress aria-label={`${job.song.title} 下载进度`} value={progress} max={100}/><p className="online-byte-count">{bytes(job.received || 0)}{job.total ? ` / ${bytes(job.total)} · ${progress}%` : ' · 等待音源提供文件大小'}</p></>}
        {job.error && <p className="online-task-error">{job.error}</p>}{job.lyricError && <p className="online-task-note">音频已保留，歌词未获取：{job.lyricError}</p>}{importWarnings[job.id] && <p className="online-task-note">{importWarnings[job.id]}</p>}{importErrors[job.id] && <p className="online-task-error" role="alert">{importErrors[job.id]}</p>}
        <div className="online-task-actions">{['queued','resolving','downloading'].includes(job.status) && <>{control('pause','暂停下载')}{control('cancel','取消下载')}</>}{job.status === 'paused' && <>{control('resume','继续下载')}{control('cancel','取消下载')}</>}{job.status === 'failed' && control('retry','重试下载')}{job.status === 'cancelled' && control('retry','重新下载')}{job.status === 'completed' && <><span className="online-import-status">{imports[job.id] === 'done' ? '已加入曲库' : imports[job.id] === 'busy' ? '正在加入曲库…' : imports[job.id] === 'failed' ? '尚未加入曲库' : '等待加入曲库'}</span><button disabled={!ready || imports[job.id] === 'busy'} onClick={() => void importJob(job,true)}>{imports[job.id] === 'done' ? '再次加入曲库' : '重试加入曲库'}</button><a href={`/api/downloads/${encodeURIComponent(job.id)}/audio`} download>保存音频</a>{job.hasLyrics && <a href={`/api/downloads/${encodeURIComponent(job.id)}/lyrics`} download>保存歌词</a>}</>}</div>
      </article>;
    })}</section><p className="online-footnote">音源可用性由上游服务决定，部分歌曲可能无法下载。音频按实际格式保存。</p>
  </section>;
}
