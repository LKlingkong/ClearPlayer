import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Track} from '../types';
import {api} from '../lib/online';
import type {DownloadJob} from '../lib/online';
import {loadDiscovery,saveDiscovery} from '../lib/storage';
import {buildTaste,dayKey,initialDiscovery,mergePlaylist,rankRadar,prioritizeEntries} from '../lib/discovery';
import type {DiscoveryState,ListeningStat,PersonalPlaylist,PlaylistEntry,PlaylistPreview,Preferences,SongRef,RadarSong} from '../lib/discovery';
import {recordingMatch,songIdentity,platformIdentity} from '../../shared/music-identity.mjs';

export function useDiscovery({tracks,ready,onImport,notify}:{tracks:Track[];ready:boolean;onImport:(job:DownloadJob,force?:boolean)=>Promise<string|undefined>;notify:(message:string)=>void}){
 const [data,setData]=useState<DiscoveryState>(initialDiscovery),[loaded,setLoaded]=useState(false),[radarBusy,setRadarBusy]=useState(false),[connectionError,setConnectionError]=useState('');
 const ref=useRef(data),tracksRef=useRef(tracks),importRef=useRef(onImport),readyRef=useRef(ready),mounted=useRef(false),loadedRef=useRef(false),writes=useRef(Promise.resolve()),inflight=useRef(new Set<string>()),importing=useRef(new Set<string>()),resuming=useRef(new Set<string>()),radarSequence=useRef(0),pumping=useRef(false);
 tracksRef.current=tracks;importRef.current=onImport;readyRef.current=ready;
 const index=useMemo(()=>{const recordings=new Map<string,Track[]>(),platform=new Map<string,Track>();for(const t of tracks){const key=songIdentity(t);recordings.set(key,[...(recordings.get(key)||[]),t]);if(platformIdentity(t))platform.set(platformIdentity(t),t);}return {recordings,platform};},[tracks]);
 const indexRef=useRef(index);indexRef.current=index;
 const priority=useRef(new Set<string>());
 const commit=useCallback((update:(current:DiscoveryState)=>DiscoveryState)=>{
  const next=update(ref.current);if(next===ref.current)return;ref.current=next;if(mounted.current)setData(next);
  if(loadedRef.current)writes.current=writes.current.catch(()=>{}).then(()=>saveDiscovery(next)).catch(()=>{notify('歌单保存失败，请检查存储空间。已下载的音频仍保留在本地');});
 },[notify]);
 useEffect(()=>{mounted.current=true;let active=true;void loadDiscovery<DiscoveryState>().then(saved=>{
  if(!active)return;const next=saved?.version===1?{...initialDiscovery(),...saved}:initialDiscovery();
  // Interrupted metadata requests can safely restart; real audio jobs keep their persisted ID.
  next.playlists=next.playlists.map(p=>({...p,entries:p.entries.map(e=>e.status==='preparing'?{...e,status:'pending' as const}:e)}));
  ref.current=next;setData(next);loadedRef.current=true;setLoaded(true);
 }).catch(()=>{if(active)notify('无法打开歌单存储，请重新打开播放器后重试');});return()=>{active=false;mounted.current=false;loadedRef.current=false;};},[notify]);
 const patchEntry=useCallback((uid:string,patch:Partial<PlaylistEntry>)=>commit(s=>({...s,playlists:s.playlists.map(p=>p.entries.some(e=>e.uid===uid)?{...p,entries:p.entries.map(e=>e.uid===uid?{...e,...patch}:e)}:p)})),[commit]);
 const matching=useCallback((song:SongRef)=>indexRef.current.platform.get(platformIdentity(song))||indexRef.current.recordings.get(songIdentity(song))?.find(t=>recordingMatch(t,song)),[]);
 const importPlaylist=useCallback((preview:PlaylistPreview)=>{
  const existing=ref.current.playlists.find(p=>p.source===preview.source&&p.sourceId===preview.sourceId);
  let playlist:PersonalPlaylist;
  if(existing){playlist={...mergePlaylist(existing,preview),updatedAt:Date.now(),total:preview.total};}
  else playlist={id:crypto.randomUUID(),name:preview.name,source:preview.source,sourceId:preview.sourceId,sourceUrl:preview.sourceUrl,cover:preview.cover,tags:preview.tags,createdAt:Date.now(),updatedAt:Date.now(),paused:false,total:preview.total,entries:preview.songs.map(song=>{const local=matching(song);return {...song,uid:crypto.randomUUID(),localId:local?.id,status:local?'ready':song.unavailable?'failed':'pending',error:song.unavailable?'原平台暂未公开这首歌的资料':undefined};})};
  commit(s=>({...s,playlists:existing?s.playlists.map(p=>p.id===playlist.id?playlist:p):[...s.playlists,playlist]}));return playlist.id;
 },[commit,matching]);
 const createPlaylist=useCallback((name:string,songs:SongRef[]=[])=>{
  const now=Date.now(),p:PersonalPlaylist={id:crypto.randomUUID(),name:name.trim().slice(0,80)||'新的歌单',createdAt:now,updatedAt:now,paused:false,entries:songs.map(song=>{const local=matching(song);return {...song,uid:crypto.randomUUID(),localId:local?.id,status:local?'ready':'pending'};})};
  commit(s=>({...s,playlists:[...s.playlists,p]}));return p.id;
 },[commit,matching]);
 const editPlaylist=useCallback((id:string,update:(p:PersonalPlaylist)=>PersonalPlaylist)=>commit(s=>({...s,playlists:s.playlists.map(p=>p.id===id?{...update(p),updatedAt:Date.now()}:p)})),[commit]);
 const controlPlaylist=useCallback(async(id:string,action:'pause'|'resume'|'retry'|'cancel')=>{
  const p=ref.current.playlists.find(p=>p.id===id);if(!p)return;
  if(action==='retry')editPlaylist(id,p=>({...p,paused:false,entries:p.entries.map(e=>e.status==='failed'?{...e,status:'pending',jobId:undefined,error:undefined,restore:true}:e)}));
  else editPlaylist(id,p=>({...p,paused:action!=='resume',entries:p.entries.map(e=>action==='cancel'&&!e.localId?{...e,status:'paused',error:'下载已停止，歌单仍然保留'}:e)}));
  const ids=[...new Set(p.entries.filter(e=>e.jobId&&!['ready','failed'].includes(e.status||'')).map(e=>e.jobId!))].filter(job=>!['pause','cancel'].includes(action)||!ref.current.playlists.some(other=>other.id!==id&&(action==='cancel'||!other.paused)&&other.entries.some(e=>!e.localId&&(e.jobId===job||p.entries.some(origin=>origin.jobId===job&&recordingMatch(origin,e))))));
  await Promise.allSettled(ids.map(job=>api(`/downloads/${encodeURIComponent(job)}/${action==='retry'?'retry':action}`,{method:'POST'})));
 },[editPlaylist]);
 const deletePlaylist=useCallback(async(id:string)=>{await controlPlaylist(id,'cancel');commit(s=>({...s,playlists:s.playlists.filter(p=>p.id!==id)}));},[controlPlaylist,commit]);
 const addSong=useCallback((id:string,song:SongRef)=>editPlaylist(id,p=>{
  if(p.entries.some(e=>songIdentity(e)===songIdentity(song)))return p;
  const local=matching(song);return {...p,entries:[...p.entries,{...song,uid:crypto.randomUUID(),localId:local?.id,status:local?'ready':'pending'}]};
 }),[editPlaylist,matching]);
 const record=useCallback((key:string,delta:Partial<ListeningStat>)=>commit(s=>{
  const old=s.stats[key]||{seconds:0,plays:0,completed:0,skips:0,lastPlayed:0};
  return {...s,stats:{...s.stats,[key]:{seconds:old.seconds+(delta.seconds||0),plays:old.plays+(delta.plays||0),completed:old.completed+(delta.completed||0),skips:old.skips+(delta.skips||0),lastPlayed:delta.lastPlayed||old.lastPlayed}}};
 }),[commit]);
 const preferences=useCallback((patch:Partial<Preferences>)=>{++radarSequence.current;setRadarBusy(false);commit(s=>({...s,preferences:{...s.preferences,...patch}}));},[commit]);
 const dislike=useCallback((song:SongRef)=>commit(s=>({...s,preferences:{...s.preferences,disliked:[...new Set([...s.preferences.disliked,songIdentity(song)])]},radar:s.radar?{...s.radar,songs:s.radar.songs.filter(t=>songIdentity(t)!==songIdentity(song))}:undefined})),[commit]);
 const generateRadar=useCallback(async(change=false)=>{
  const sequence=++radarSequence.current;setRadarBusy(true);
  const current=ref.current,batch=change?(current.radar?.batch||0)+1:0,day=dayKey();
  const playlistTags=current.playlists.flatMap(p=>p.tags||[]),taste=buildTaste(tracksRef.current,current.stats,[...current.preferences.tags,...playlistTags].slice(0,12));
  let candidates:SongRef[]=[],warnings:string[]=[];
  try{const result=await api<{songs:SongRef[];warnings:string[];unavailable?:boolean}>('/radar/candidates',{method:'POST',body:JSON.stringify({seeds:taste.seeds.map(t=>({title:t.title,artist:t.artist,album:t.album,duration:t.duration,onlineSource:t.onlineSource,onlineId:t.onlineId})),tags:taste.tags,refresh:change||!!current.radar&&!current.radar.songs.some(s=>!s.localId),batch})});if(result.unavailable)throw new Error('推荐来源暂未返回可用候选，请重新寻找新歌');candidates=result.songs;warnings=result.warnings||[];}
  catch(error){warnings=[(error as Error).message];if(ref.current.radar?.songs.length){if(sequence===radarSequence.current){commit(s=>({...s,radar:s.radar?{...s.radar,batch,recallVersion:2,warnings:[s.radar.songs.some(t=>!t.localId)?'网络暂不可用，保留上次雷达结果':'新歌尚未就绪，保留曲库重听。可以点击“重新寻找新歌”重试',...warnings]}:undefined}));setRadarBusy(false);}return;}}
  if(sequence!==radarSequence.current||!mounted.current)return;
  const songs=rankRadar(candidates,tracksRef.current,ref.current.stats,ref.current.preferences,`${day}:${batch}`);
  const newCount=songs.filter(s=>!s.localId).length;
  if(!newCount&&current.radar?.songs.some(s=>!s.localId)){
   commit(s=>({...s,radar:{...current.radar!,batch,recallVersion:2,warnings:['本轮没有找到可补充的新歌，保留上次完整雷达结果；可以再换一批',...warnings]}}));setRadarBusy(false);return;
  }
  if(!newCount){const known=candidates.filter(s=>matching(s)).length,heard=candidates.filter(s=>!matching(s)&&ref.current.stats[songIdentity(s)]?.seconds>10).length;warnings.push(candidates.length?`本轮取得 ${candidates.length} 首相关候选，其中 ${known} 首已在曲库、${heard} 首已有聆听记录；暂未找到符合条件的新歌，可重新寻找`:'本轮未取得新歌候选，曲库重听已保留。点击“重新寻找新歌”会重新查询来源');}
  else if(songs.length<30)warnings.push(`目前找到 ${newCount} 首新歌、${songs.filter(s=>s.localId).length} 首曲库歌曲，当前按实际可用数量展示`);
  commit(s=>({...s,radar:{day,batch,songs,warnings,generatedAt:Date.now(),exploration:s.preferences.exploration,recallVersion:2,newCount}}));setRadarBusy(false);
 },[commit,matching]);
 // The coordinator stays mounted across pages. At most two active entries are prepared/downloaded.
 useEffect(()=>{
  if(!loaded||!ready)return;let active=true,timer:ReturnType<typeof setTimeout>;
  const tick=async()=>{
   if(!active)return;
   if(pumping.current){timer=setTimeout(()=>void tick(),600);return;}pumping.current=true;
   try{
    const {jobs}=await api<{jobs:DownloadJob[]}>('/downloads');if(!active)return;setConnectionError('');
    for(const p of ref.current.playlists){for(const e of p.entries){
     if(e.status==='ready'&&e.localId&&tracksRef.current.some(t=>t.id===e.localId))continue;
     const local=matching(e);
     if(local){if(e.localId!==local.id||e.status!=='ready')patchEntry(e.uid,{localId:local.id,status:'ready',error:undefined});continue;}
     if(e.status==='ready'){patchEntry(e.uid,{localId:undefined,status:'failed',error:'音频已从曲库移除，可点击重试补齐'});continue;}
     if(!e.jobId)continue;const job=jobs.find(j=>j.id===e.jobId);
     if(!job){if(e.status!=='failed')patchEntry(e.uid,{status:'failed',jobId:undefined,error:'下载任务已过期，点击重试补齐'});continue;}
     if(job.status==='completed'&&e.status!=='failed'&&!p.paused&&!importing.current.has(e.uid)){
      importing.current.add(e.uid);
      try{await importRef.current(job,e.restore===true);patchEntry(e.uid,{localId:`download:${job.id}`,status:'ready',error:undefined,restore:false});}
      catch(error){patchEntry(e.uid,{status:'failed',error:(error as Error).message});}
      finally{importing.current.delete(e.uid);}
     }else if(job.status==='failed'&&e.status!=='failed')patchEntry(e.uid,{status:'failed',error:job.error||'暂时未找到同一版本，可以重试'});
     else if(job.status==='paused'){
      if(!p.paused&&e.status!=='failed'&&!resuming.current.has(job.id)){
       resuming.current.add(job.id);void api(`/downloads/${job.id}/resume`,{method:'POST'}).then(()=>patchEntry(e.uid,{status:'queued'})).catch(error=>patchEntry(e.uid,{status:'failed',error:(error as Error).message})).finally(()=>resuming.current.delete(job.id));
      }else if(e.status!=='paused'&&e.status!=='failed')patchEntry(e.uid,{status:'paused'});
     }
     else if(job.status==='cancelled'&&e.status!=='failed')patchEntry(e.uid,p.paused?{status:'paused'}:{status:'failed',error:'下载已被停止，可以点击重试补齐'});
     else if(['queued','resolving','downloading'].includes(job.status)&&e.status!=='downloading')patchEntry(e.uid,{status:'downloading'});
    }}
    const busy=ref.current.playlists.flatMap(p=>p.entries).filter(e=>['preparing','queued','downloading'].includes(e.status||'')).length;
    const available=Math.max(0,2-busy);
    const pending=prioritizeEntries(ref.current.playlists.filter(p=>!p.paused).flatMap(p=>p.entries).filter(e=>(e.status==='pending'||(e.status==='paused'&&!e.jobId))&&!inflight.current.has(e.uid)),priority.current).slice(0,available);
    for(const e of pending){
     inflight.current.add(e.uid);patchEntry(e.uid,{status:'preparing',error:undefined});
     void api<{job:DownloadJob}>('/songs/prepare',{method:'POST',body:JSON.stringify({song:e})}).then(async({job})=>{
      const owner=ref.current.playlists.find(p=>p.entries.some(x=>x.uid===e.uid));
      if(!owner){
       const references=ref.current.playlists.filter(p=>p.entries.some(entry=>!entry.localId&&(entry.jobId===job.id||recordingMatch(entry,job.song))));
       if(!references.length)await api(`/downloads/${job.id}/cancel`,{method:'POST'}).catch(()=>{});
       else if(references.every(p=>p.paused))await api(`/downloads/${job.id}/pause`,{method:'POST'}).catch(()=>{});
       return;
      }
      patchEntry(e.uid,{jobId:job.id,status:job.status==='failed'?'failed':'queued',error:job.error});
      const otherActive=ref.current.playlists.some(p=>p.id!==owner.id&&!p.paused&&p.entries.some(e=>!e.localId&&(e.jobId===job.id||recordingMatch(e,job.song))));
      if(owner.paused&&!otherActive)await api(`/downloads/${job.id}/pause`,{method:'POST'}).catch(()=>{});
      else if(!owner.paused&&job.status==='paused')await api(`/downloads/${job.id}/resume`,{method:'POST'}).catch(()=>{});
     }).catch(error=>patchEntry(e.uid,{status:'failed',error:(error as Error).message})).finally(()=>inflight.current.delete(e.uid));
    }
   }catch(error){if(active)setConnectionError((error as Error).message);}
   finally{pumping.current=false;if(active)timer=setTimeout(()=>void tick(),1000);}
  };void tick();return()=>{active=false;clearTimeout(timer);};
 },[loaded,ready,matching,patchEntry]);
 const storeRadar=useCallback((download=true)=>{
  const radar=ref.current.radar,sourceId=`${radar?.day||dayKey()}:${radar?.batch||0}`;
  const existing=ref.current.playlists.find(p=>p.source==='radar'&&p.sourceId===sourceId);
  if(existing){if(download)void controlPlaylist(existing.id,'resume');return existing.id;}
  const id=createPlaylist(`个人雷达 · ${dayKey()}`,radar?.songs||[]);
  editPlaylist(id,p=>({...p,source:'radar',sourceId,paused:!download}));return id;
 },[createPlaylist,editPlaylist,controlPlaylist]);
 const ensureSong=useCallback(async(song:SongRef)=>{
  const local=matching(song);if(local)return local.id;
  let p=ref.current.playlists.find(p=>p.id==='radar-saved');
  if(!p){const now=Date.now();p={id:'radar-saved',name:'雷达心动',entries:[],createdAt:now,updatedAt:now,paused:false};commit(s=>({...s,playlists:[...s.playlists,p!]}));}
  addSong(p.id,song);const key=songIdentity(song);priority.current.add(key);
  const until=Date.now()+150000;
  try{
   while(Date.now()<until){const found=matching(song);if(found)return found.id;const e=ref.current.playlists.find(p=>p.id==='radar-saved')?.entries.find(e=>songIdentity(e)===key);if(e?.status==='failed')throw new Error(e.error||'歌曲暂不可用');if(!e)throw new Error('歌曲准备已取消');await new Promise(r=>setTimeout(r,500));}
   throw new Error('歌曲仍在后台准备，可以先听其他歌曲');
  }finally{priority.current.delete(key);}
 },[addSong,commit,matching]);
 return {data,loaded,radarBusy,connectionError,importPlaylist,createPlaylist,editPlaylist,deletePlaylist,addSong,controlPlaylist,record,preferences,dislike,generateRadar,storeRadar,ensureSong,matching};
}
export type DiscoveryController=ReturnType<typeof useDiscovery>;
