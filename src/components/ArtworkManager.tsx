import {useEffect,useRef,useState} from 'react';
import {Check,ImagePlus,LoaderCircle,Search,Sparkles,X} from 'lucide-react';
import type {Track} from '../types';
import type {ArtworkFit} from '../lib/artworkGeometry';
import type {ArtworkCandidate,ArtworkSearchState} from '../hooks/useArtworkDiscovery';
import type {ArtworkBatchProgress} from '../lib/artworkBatch';
import {Artwork} from './Artwork';
import './ArtworkManager.css';

interface Props{
  track:Track;tracks:Track[];state?:ArtworkSearchState;batch:ArtworkBatchProgress&{running:boolean};
  onClose:()=>void;onImport:()=>void;onFit:(fit:ArtworkFit)=>Promise<void>;onTarget:(id:string)=>void;
  onSearch:(query:Track)=>Promise<unknown>;onChoose:(candidate:ArtworkCandidate)=>Promise<boolean>;
  onBatch:()=>void;onStop:()=>void;
}
const defaultFit:ArtworkFit={zoom:1,x:50,y:50,trim:true};
export function ArtworkManager({track,tracks,state,batch,onClose,onImport,onFit,onTarget,onSearch,onChoose,onBatch,onStop}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  const [fit,setFit]=useState<ArtworkFit>(track.artworkFit||defaultFit);
  const [query,setQuery]=useState({title:track.title,artist:track.artist==='未知歌手'?'':track.artist,album:track.album});
  const [selected,setSelected]=useState<string|null>(null),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{setFit(track.artworkFit||defaultFit);setSelected(null);setMessage('');},[track.id,track.artwork]);
  useEffect(()=>{setQuery({title:track.title,artist:track.artist==='未知歌手'?'':track.artist,album:track.album});dialog.current?.scrollTo({top:0,behavior:'instant'});},[track.id]);
  const candidates=state?.candidates||[],candidate=candidates.find(item=>item.id===selected);
  const apply=async()=>{
    if(!candidate)return;setSaving(true);setMessage('');
    try{const success=await onChoose(candidate);setMessage(success?'这张封面已应用并保存在本机':'这首歌已被移除，本次应用已取消');setSelected(null);}
    catch(error){setMessage(error instanceof Error?error.message:'封面无法应用，请重试');}
    finally{setSaving(false);}
  };
  const pending=batch.items.filter(item=>item.status==='review'||item.status==='missing'||item.status==='error').map(item=>({item,track:tracks.find(t=>t.id===item.id)})).filter(entry=>entry.track&&!entry.track.artwork);
  return <dialog ref={dialog} className="artwork-dialog" aria-label="封面工作室" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <header className="artwork-dialog-heading"><div><span><Sparkles size={12}/>让每张唱片，都有自己的样子</span><h2>封面工作室</h2><p>{track.title}<i>·</i>{track.artist}</p></div><button className="icon-button" aria-label="关闭封面工作室" onClick={onClose}><X size={20}/></button></header>
    <div className="artwork-workspace">
      <section className="artwork-composition" aria-label="封面构图">
        <div className="artwork-crop-preview">{track.artwork?<Artwork blob={track.artwork} autoTrim fit={fit}/>:<div className="artwork-preview-empty"><ImagePlus size={32}/><span>为这首歌找一张封面</span></div>}</div>
        <div className="composition-title"><strong>铺满唱片中心</strong><span>原图会完整保留</span></div>
        <label className="trim-toggle"><span>自动去除纯色留边</span><input type="checkbox" checked={fit.trim} disabled={!track.artwork} onChange={event=>setFit(value=>({...value,trim:event.target.checked}))}/></label>
        {([['zoom','缩放',1,2,.01],['x','水平位置',0,100,1],['y','垂直位置',0,100,1]] as const).map(([field,label,min,max,step])=><label className="crop-control" key={field}><span>{label}<small>{field==='zoom'?`${Math.round(fit.zoom*100)}%`:Math.round(fit[field])}</small></span><input type="range" aria-label={`封面${label}`} min={min} max={max} step={step} value={fit[field]} disabled={!track.artwork} onChange={event=>setFit(value=>({...value,[field]:Number(event.target.value)}))}/></label>)}
        <div className="composition-actions"><button onClick={()=>setFit(defaultFit)} disabled={!track.artwork}>重置</button><button className="primary-button" disabled={!track.artwork||saving} onClick={()=>{setSaving(true);void onFit(fit).then(()=>setMessage('封面构图已保存')).catch(()=>setMessage('构图尚未保存，请检查存储空间后重试')).finally(()=>setSaving(false));}}><Check size={13}/>保存构图</button></div>
        <button className="local-artwork-button" disabled={saving} onClick={onImport}><ImagePlus size={14}/>选择本地图片</button>
      </section>
      <section className="artwork-discovery" aria-label="查找专辑封面">
        <div className="artwork-section-title"><h3>找到属于这首歌的封面</h3><p>从多个音源查找，版本不确定时由你来选。</p></div>
        <form className="cover-query" onSubmit={event=>{event.preventDefault();setSelected(null);setMessage('');void onSearch({...track,...query});}}>
          <label>歌名<input aria-label="封面查找歌名" value={query.title} required maxLength={200} onChange={event=>setQuery(value=>({...value,title:event.target.value}))}/></label>
          <label>歌手<input aria-label="封面查找歌手" placeholder="可留空" value={query.artist} maxLength={200} onChange={event=>setQuery(value=>({...value,artist:event.target.value}))}/></label>
          <label>专辑<input aria-label="封面查找专辑" placeholder="可留空" value={query.album} maxLength={200} onChange={event=>setQuery(value=>({...value,album:event.target.value}))}/></label>
          <button className="primary-button" disabled={saving||state?.status==='loading'||!query.title.trim()}>{state?.status==='loading'?<LoaderCircle size={14} className="spin"/>:<Search size={14}/>}查找封面</button>
        </form>
        {state?.status==='loading'?<div className="cover-result-empty" role="status"><LoaderCircle className="spin" size={24}/><p>正在比对歌曲与专辑信息…</p><small>播放会继续，稍后可以回来选择。</small></div>:candidates.length?<>
          <div className="cover-candidates" role="group" aria-label="候选封面">{candidates.map(item=><button key={item.id} className={selected===item.id?'selected':''} aria-label={`选择封面 ${item.album||item.title} ${item.source}`} aria-pressed={selected===item.id} disabled={saving} onClick={()=>setSelected(item.id)}><div><img src={`/api/artwork/candidates/${item.id}`} alt={`${item.album||item.title}候选封面`} loading="lazy" onError={event=>{event.currentTarget.src='/artwork.svg';}}/>{selected===item.id&&<span><Check size={16}/></span>}</div><strong>{item.album||item.title}</strong><small>{item.artist}</small><em>{item.source}{item.confidence==='high'?' · 匹配明确':' · 请确认版本'}</em></button>)}</div>
          <div className="candidate-apply"><span>{candidate?`${candidate.title} · ${candidate.artist}`:'选中图片后即可应用'}</span><button className="primary-button" disabled={!candidate||saving} onClick={()=>void apply()}>{saving?<LoaderCircle size={14} className="spin"/>:<Check size={14}/>}使用这张封面</button></div>
        </>:<div className="cover-result-empty"><Search size={25}/><p>{state?.status==='missing'?'还没有找到合适的版本':state?.status==='error'?'这次查找未完成':'换一张封面，换一种心情'}</p><small>{state?.status==='missing'?'试着留空专辑，或补充歌手后再查一次。':'输入歌曲信息查找，也可以直接选择本地图片。'}</small></div>}
        {state?.message&&<p className="cover-search-note">{state.message}</p>}
        {message&&<p className="cover-feedback" role="status">{message}</p>}
      </section>
    </div>
    <section className="library-artwork-batch" aria-label="整库封面补齐"><div className="batch-heading"><div><h3>把缺失的封面，一起找回来</h3><p>只补缺图，不覆盖已有封面。仅发送歌曲信息，音频留在本机。</p></div><button className={batch.running?'batch-stop':'primary-button'} onClick={batch.running?onStop:onBatch} disabled={!batch.running&&!tracks.some(t=>!t.artwork)}>{batch.running?<><X size={13}/>停止补齐</>:<><Sparkles size={13}/>补齐曲库封面</>}</button></div>
      {batch.total>0&&<><progress aria-label="整库封面补齐进度" max={batch.total} value={batch.done}/><div className="batch-summary" role="status"><span>{batch.running?'正在补齐':batch.cancelled?'已停止':'本轮已完成'} {batch.done} / {batch.total}</span><span>已补齐 {batch.filled} · 待确认 {pending.filter(entry=>entry.item.status==='review').length} · 未匹配 {batch.missing} · 暂不可用 {batch.errors}</span></div></>}
      {!!pending.length&&<div className="batch-review-list">{pending.map(({item,track:entry})=><button key={item.id} onClick={()=>!saving&&onTarget(item.id)}><span>{entry!.title}<small>{entry!.artist}</small></span><em>{item.status==='review'?'选择候选封面':'调整信息再查找'}</em></button>)}</div>}
    </section>
  </dialog>;
}
