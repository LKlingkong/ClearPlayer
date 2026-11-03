import {randomBytes} from 'node:crypto';
import {confidence,normalize,unknownArtist} from './artwork-matching.mjs';
import {artworkSources} from './artwork-sources.mjs';
const MAX_IMAGE=8*1024*1024,MAX_CACHE_BYTES=32*1024*1024,CATALOG_TTL=30*60000;
export function artworkType(bytes){
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return null;
}
async function limitedBody(response,limit){
  if(!response.ok || response.redirected){await response.body?.cancel();throw new Error('封面服务暂时不可用');}
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('封面图片过大');}
  const chunks=[];let size=0;
  const reader=response.body?.getReader();if(!reader)throw new Error('封面内容为空');
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('封面图片过大');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks);
}
function imageUrl(raw,source){
  let url;try{url=new URL(raw);}catch{throw new Error('封面图片地址无效');}
  const trusted=source==='Apple Music'?/^([a-z0-9-]+\.)+mzstatic\.com$/i.test(url.hostname):source==='网易云音乐'?/^p[1-9]\.music\.126\.net$/i.test(url.hostname):source==='QQ 音乐' && ['y.gtimg.cn','qpic.y.qq.com'].includes(url.hostname);
  // NetEase's official search still emits HTTP CDN links; fetch the same host over TLS.
  if(trusted && ['网易云音乐','QQ 音乐'].includes(source) && url.protocol==='http:')url.protocol='https:';
  if(url.protocol!=='https:' || !trusted || url.port || url.username || url.password)throw new Error('封面图片来源不受支持');
  if(source==='Apple Music')url.pathname=url.pathname.replace(/\/100x100bb\.(jpg|png)$/,'/600x600bb.$1');
  url.hash='';return url.href;
}
const bounded=(signal,timeout)=>signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
// Subscribers cancel independently; stop the shared transport only after the last leaves.
function sharedTask(pending,key,signal,start){
  signal?.throwIfAborted();
  let entry=pending.get(key);
  if(!entry){
    entry={controller:new AbortController(),users:0,settled:false};pending.set(key,entry);
    entry.promise=Promise.resolve().then(()=>{entry.controller.signal.throwIfAborted();return start(entry.controller.signal);});
    const settled=()=>{entry.settled=true;if(pending.get(key)===entry)pending.delete(key);};
    entry.promise.then(settled,settled);
  }
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(callback,value)=>{
      if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.users--;
      if(!entry.users && !entry.settled){
        if(pending.get(key)===entry)pending.delete(key);
        entry.controller.abort(value);
      }
      callback(value);
    };
    const abort=()=>finish(reject,signal.reason);
    entry.users++;signal?.addEventListener('abort',abort,{once:true});
    entry.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}
function validate(metadata){
  const {title,artist='',album='',duration}=metadata||{};
  if(![title,artist,album].every(value=>typeof value==='string' && value.length<=200) || (duration!==undefined && (typeof duration!=='number' || !Number.isFinite(duration) || duration<0 || duration>86400)))throw new Error('封面歌曲信息无效');
  return {title:title.trim(),artist:artist.trim(),album:album.trim(),duration};
}
const missing=()=>Object.assign(new Error('封面候选已过期，请重新查找'),{status:404});

export class ArtworkService{
  constructor({fetchImpl=fetch}={}){
    this.fetch=fetchImpl;this.cache=new Map();this.catalog=new Map();this.images=new Map();this.imageBytes=0;
    this.pending=new Map();this.imagePending=new Map();this.active=0;this.waiters=[];
    this.imageActive=0;this.imageWaiters=[];
  }
  prune(){
    const now=Date.now();
    for(const [key,value] of this.cache)if(value.until<=now)this.cache.delete(key);
    for(const [key,value] of this.catalog)if(value.until<=now)this.catalog.delete(key);
    for(const [key,value] of this.images)if(value.until<=now){this.images.delete(key);this.imageBytes-=value.value.bytes.length;}
  }
  async slot(signal){
    signal?.throwIfAborted();
    if(this.active>=2){
      if(this.waiters.length>=32)throw new Error('封面查找繁忙，请稍后重试');
      await new Promise((resolve,reject)=>{
        const ready=()=>{signal?.removeEventListener('abort',abort);resolve();};
        const abort=()=>{const index=this.waiters.indexOf(ready);if(index>=0)this.waiters.splice(index,1);reject(signal.reason);};
        this.waiters.push(ready);signal?.addEventListener('abort',abort,{once:true});
      });
    }else this.active++;
  }
  release(){const next=this.waiters.shift();if(next)next();else this.active--;}
  async search(metadata,signal,{refresh=false}={}){
    const input=validate(metadata);signal?.throwIfAborted();
    if(!input.title)return {automatic:null,candidates:[],warnings:[]};
    this.prune();
    const key=[input.title,input.artist,input.album].map(normalize).concat(input.duration||'').join('\0');
    const cached=this.cache.get(key);
    if(!refresh && cached && cached.value.candidates.every(candidate=>this.catalog.has(candidate.id)))return structuredClone(cached.value);
    if(!this.pending.has(key) && this.pending.size>=34)throw new Error('封面查找繁忙，请稍后重试');
    const result=await sharedTask(this.pending,key,signal,async sharedSignal=>{
      const result=await this.searchSources(input,sharedSignal,refresh);sharedSignal.throwIfAborted();
      // A temporary outage must not become a negative cache entry.
      if(result.candidates.length || !result.warnings.length){
        this.cache.set(key,{value:result,until:Date.now()+(result.candidates.length?CATALOG_TTL:60000)});
        while(this.cache.size>64)this.cache.delete(this.cache.keys().next().value);
      }
      return result;
    });
    return structuredClone(result);
  }
  async searchSources(metadata,signal,refresh){
    await this.slot(signal);
    try{
      const overall=bounded(signal,26000),candidates=[],warnings=[],seen=new Set();let automatic=null;
      const query={...metadata,artist:unknownArtist(metadata.artist)?'':metadata.artist};
      for(const provider of artworkSources){
        signal?.throwIfAborted();if(overall.aborted){warnings.push('封面查找超时，可以重新查找');break;}
        try{
          const requestSignal=bounded(overall,3500);
          const items=await provider.search(query,async (url,options={})=>JSON.parse((await limitedBody(await this.fetch(url,{...options,signal:requestSignal,redirect:'error'}),512*1024)).toString('utf8')));
          for(const item of items){
            if(typeof item.title!=='string' || typeof item.artist!=='string')continue;
            const level=confidence(metadata,item);if(!level || !item.url)continue;
            let url;try{url=imageUrl(item.url,provider.source);}catch(error){warnings.push(error.message);continue;}
            const unique=[provider.source,normalize(item.title),normalize(item.artist),normalize(item.album),url].join('\0');
            if(seen.has(unique))continue;
            if(candidates.length>=24){
              const replace=candidates.findLastIndex(candidate=>candidate.confidence==='review');
              if(level!=='high' || replace<0)continue;
              this.catalog.delete(candidates[replace].id);candidates.splice(replace,1);
            }
            seen.add(unique);
            const id=randomBytes(16).toString('hex');
            this.catalog.set(id,{url,source:provider.source,until:Date.now()+CATALOG_TTL});
            while(this.catalog.size>256)this.catalog.delete(this.catalog.keys().next().value);
            candidates.push({id,title:item.title.slice(0,200),artist:item.artist.slice(0,200),album:String(item.album||'').slice(0,200),source:provider.source,confidence:level});
            if(level==='high' && !automatic)automatic=id;
          }
        }catch(error){signal?.throwIfAborted();warnings.push(`${provider.label} 暂不可用`);}
        if(automatic && !refresh)break;
      }
      candidates.sort((a,b)=>(a.confidence==='high'?0:1)-(b.confidence==='high'?0:1));
      return {automatic,candidates,warnings:[...new Set(warnings)]};
    }finally{this.release();}
  }
  async imageSlot(signal){
    signal.throwIfAborted();
    if(this.imageActive<4){this.imageActive++;return;}
    if(this.imageWaiters.length>=32)throw new Error('封面图片加载繁忙，请稍后重试');
    await new Promise((resolve,reject)=>{
      const ready=()=>{signal.removeEventListener('abort',abort);resolve();};
      const abort=()=>{const index=this.imageWaiters.indexOf(ready);if(index>=0)this.imageWaiters.splice(index,1);reject(signal.reason);};
      this.imageWaiters.push(ready);signal.addEventListener('abort',abort,{once:true});
    });
  }
  releaseImage(){const next=this.imageWaiters.shift();if(next)next();else this.imageActive--;}
  async image(id,signal){
    this.prune();signal?.throwIfAborted();
    const entry=/^[a-f0-9]{32}$/.test(id||'') && this.catalog.get(id);if(!entry)throw missing();
    const cached=this.images.get(entry.url);if(cached)return cached.value;
    return sharedTask(this.imagePending,entry.url,signal,async sharedSignal=>{
      const deadline=bounded(sharedSignal,12000);
      await this.imageSlot(deadline);
      try{
        deadline.throwIfAborted();
        const response=await this.fetch(imageUrl(entry.url,entry.source),{signal:deadline,redirect:'error'});
        const bytes=await limitedBody(response,MAX_IMAGE),type=artworkType(bytes);deadline.throwIfAborted();if(!type)throw new Error('封面图片格式无效');
        const value={bytes,type,source:entry.source};
        this.images.set(entry.url,{value,until:Date.now()+CATALOG_TTL});this.imageBytes+=bytes.length;
        while(this.imageBytes>MAX_CACHE_BYTES || this.images.size>32){const key=this.images.keys().next().value;this.imageBytes-=this.images.get(key).value.bytes.length;this.images.delete(key);}
        return value;
      }finally{this.releaseImage();}
    });
  }
  async imageFromUrl(raw,signal){
    let url;try{url=new URL(raw);}catch{throw new Error('封面图片来源不受支持');}
    const source=/^p[1-9]\.music\.126\.net$/i.test(url.hostname)?'网易云音乐':'QQ 音乐';
    const normalized=imageUrl(raw,source),id=randomBytes(16).toString('hex');
    this.catalog.set(id,{url:normalized,source,until:Date.now()+CATALOG_TTL});
    try{return await this.image(id,signal);}finally{this.catalog.delete(id);}
  }
  async lookup(metadata,signal){
    const input=validate(metadata);if(unknownArtist(input.artist))return null;
    const result=await this.search(input,signal);
    if(result.automatic)return this.image(result.automatic,signal);
    const unsafe=result.warnings.find(warning=>warning.startsWith('封面图片'));if(unsafe)throw new Error(unsafe);
    return null;
  }
}
