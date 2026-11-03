import {useCallback,useEffect,useRef,useState} from 'react';
import type {Track} from '../types';
import {validArtwork} from '../lib/artwork';
import {emptyArtworkProgress,runArtworkBatch} from '../lib/artworkBatch';
import type {ArtworkOutcome} from '../lib/artworkBatch';

export type ArtworkStatus='idle'|'loading'|'missing'|'error'|'review';
export interface ArtworkCandidate{id:string;title:string;artist:string;album:string;source:string;confidence:'high'|'review'}
export interface ArtworkSearchState{status:ArtworkStatus;candidates:ArtworkCandidate[];message:string}
const idle:ArtworkSearchState={status:'idle',candidates:[],message:''};
const sourceOf=(response:Response)=>{try{return decodeURIComponent(response.headers.get('X-Artwork-Source')||'在线封面');}catch{return '在线封面';}};
const keyOf=(track:Track)=>[track.id,track.title,track.artist,track.album,track.duration].join('\0');
type Apply=(id:string,blob:Blob,provider:string,replace?:boolean)=>Promise<boolean>;
export function useArtworkDiscovery(track:Track|undefined,enabled:boolean,apply:Apply,getTrack:(id:string)=>Track|undefined){
  const [states,setStates]=useState<Record<string,ArtworkSearchState>>({});
  const [batch,setBatch]=useState({...emptyArtworkProgress(),running:false});
  const requests=useRef(new Map<string,{key:string;controller:AbortController;promise:Promise<ArtworkOutcome>}>());
  const completed=useRef(new Map<string,string>()),mounted=useRef(true),batchController=useRef<AbortController|null>(null),batchTrack=useRef<string|null>(null);
  const lookup=useCallback((query:Track,options:{refresh?:boolean;review?:boolean;signal?:AbortSignal}={}):Promise<ArtworkOutcome>=>{
    const key=keyOf(query),existing=requests.current.get(query.id);
    if(existing?.key===key&&!options.refresh)return existing.promise;
    existing?.controller.abort();
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(35000),...(options.signal?[options.signal]:[])]);
    const publish=(state:ArtworkSearchState)=>{if(mounted.current&&!controller.signal.aborted&&!options.signal?.aborted)setStates(current=>({...current,[query.id]:state}));};
    publish({...idle,status:'loading'});
    let applying=false;
    const promise=(async():Promise<ArtworkOutcome>=>{
      try{
        const response=await fetch('/api/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:query.title,artist:query.artist,album:query.album,duration:query.duration,refresh:!!options.refresh,review:!!options.review}),signal});
        signal.throwIfAborted();
        if(response.status===409){
          const data=await response.json();
          const candidates:Array<ArtworkCandidate>=Array.isArray(data.candidates)?data.candidates.filter((item:ArtworkCandidate)=>/^[a-f0-9]{32}$/.test(item.id)).slice(0,12):[];
          publish({status:candidates.length?'review':'missing',candidates,message:Array.isArray(data.warnings)?data.warnings.join('；'):''});
          completed.current.set(query.id,key);return candidates.length?'review':'missing';
        }
        if(response.status===404){publish({status:'missing',candidates:[],message:'暂未找到合适的封面，可调整关键词再查找'});completed.current.set(query.id,key);return 'missing';}
        if(!response.ok)throw new Error('封面服务暂不可用，可以稍后重试或选择本地图片');
        const blob=await response.blob();if(!(await validArtwork(blob)))throw new Error('返回的图片无法读取，请重新查找');
        signal.throwIfAborted();
        applying=true;const applied=await apply(query.id,blob,sourceOf(response));
        if(mounted.current&&requests.current.get(query.id)?.controller===controller&&!options.signal?.aborted)setStates(current=>({...current,[query.id]:idle}));
        completed.current.set(query.id,key);return applied?'filled':'skipped';
      }catch(error){
        if(applying){
          if(mounted.current&&requests.current.get(query.id)?.controller===controller)setStates(current=>({...current,[query.id]:{status:'error',candidates:[],message:error instanceof Error?error.message:'封面没有保存成功'}}));
          return 'error';
        }
        if(controller.signal.aborted||options.signal?.aborted)return 'skipped';
        publish({status:'error',candidates:[],message:error instanceof Error?error.message:'暂时无法查找封面'});return 'error';
      }finally{if(requests.current.get(query.id)?.controller===controller)requests.current.delete(query.id);}
    })();requests.current.set(query.id,{key,controller,promise});return promise;
  },[apply]);
  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;batchController.current?.abort();for(const request of requests.current.values())request.controller.abort();requests.current.clear();};
  },[]);
  useEffect(()=>{
    if(track&&!track.artwork&&enabled&&!batch.running&&completed.current.get(track.id)!==keyOf(track)){
      void lookup(track);
      const request=requests.current.get(track.id);
      return()=>{if(requests.current.get(track.id)===request)request?.controller.abort();};
    }
  },[track?.id,track?.title,track?.artist,track?.album,track?.duration,track?.artwork,enabled,batch.running,lookup]);
  const retry=useCallback(()=>{if(track)void lookup(track,{refresh:true});},[track,lookup]);
  const startBatch=useCallback((tracks:Track[])=>{
    if(batchController.current)return;
    const controller=new AbortController();batchController.current=controller;
    setBatch({...emptyArtworkProgress(),running:true});
    void runArtworkBatch(tracks,async(snapshot,signal)=>{
      const latest=getTrack(snapshot.id);if(!latest||latest.artwork)return 'skipped';
      batchTrack.current=latest.id;
      return lookup(latest,{refresh:true,signal});
    },{signal:controller.signal,onProgress:progress=>{if(mounted.current)setBatch({...progress,running:true});}}).then(progress=>{if(mounted.current)setBatch({...progress,running:false});}).finally(()=>{batchTrack.current=null;if(batchController.current===controller)batchController.current=null;});
  },[getTrack,lookup]);
  const choose=useCallback(async(id:string,candidate:ArtworkCandidate)=>{
    const before=getTrack(id);if(!before)return false;
    const response=await fetch(`/api/artwork/candidates/${candidate.id}`,{signal:AbortSignal.timeout(18000)});
    if(!response.ok)throw new Error('这张封面已过期或暂时无法读取，请重新查找');
    const blob=await response.blob();if(!(await validArtwork(blob)))throw new Error('图片无法读取，请选择其他封面');
    const latest=getTrack(id);if(!latest)return false;
    if(latest.artwork!==before.artwork)throw new Error('封面已发生变化，请重新确认选择');
    const applied=await apply(id,blob,sourceOf(response),true);
    if(applied){requests.current.get(id)?.controller.abort();if(mounted.current)setStates(current=>({...current,[id]:idle}));}return applied;
  },[apply,getTrack]);
  const cancelBatch=()=>{
    batchController.current?.abort();const id=batchTrack.current;if(!id)return;
    const active=requests.current.get(id);if(active)completed.current.set(id,active.key);
    setStates(current=>({...current,[id]:idle}));
  };
  return {status:track&&!track.artwork?(states[track.id]?.status||'idle'):'idle' as ArtworkStatus,states,retry,search:lookup,choose,batch,startBatch,cancelBatch};
}
