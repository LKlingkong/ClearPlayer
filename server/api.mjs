import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {ArtworkService} from './artwork.mjs';
import {DiscoveryService} from './discovery.mjs';

const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
async function body(req,max=4096) {
  if(!String(req.headers['content-type']||'').startsWith('application/json')) throw new Error('请求格式无效');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('请求内容过大');chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString());} catch{throw new Error('请求内容无效');}
}
export function createApiHandler(service,{origins,artwork=new ArtworkService(),discovery=new DiscoveryService()}) {
  const allowed=new Set(origins);
  return async function handler(req,res) {
    let url;
    try {url=new URL(req.url,'http://127.0.0.1');} catch {send(res,400,{error:'请求地址无效'});return true;}
    if(!url.pathname.startsWith('/api/')) return false;
    const self=`http://${req.headers.host}`;
    if(!allowed.has(self) || (req.headers.origin && !allowed.has(req.headers.origin)) || req.headers['sec-fetch-site']==='cross-site') {send(res,403,{error:'仅允许从本机播放器访问'});return true;}
    const method=req.method;
    try {
      if(method==='GET'&&url.pathname==='/api/discovery/cover'){
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const cover=await artwork.imageFromUrl(url.searchParams.get('url'),controller.signal);
        res.writeHead(200,{'Content-Type':cover.type,'Content-Length':cover.bytes.length,'Cache-Control':'private, max-age=1800','X-Content-Type-Options':'nosniff'});res.end(cover.bytes);return true;
      }
      if(method==='POST'&&['/api/playlists/preview','/api/radar/candidates','/api/songs/prepare'].includes(url.pathname)){
        const data=await body(req,16384),controller=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(url.pathname==='/api/playlists/preview'?60000:23000)]);
        if(url.pathname==='/api/playlists/preview')send(res,200,await discovery.playlist(data.input,signal));
        else if(url.pathname==='/api/radar/candidates')send(res,200,await discovery.candidates(data.seeds,data.tags,signal,{refresh:data.refresh===true,batch:data.batch}));
        else send(res,202,{job:await service.prepare(data.song,signal)});
        return true;
      }
      if(method==='POST' && url.pathname==='/api/artwork'){
        const metadata=await body(req),controller=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const result=await artwork.search(metadata,controller.signal,{refresh:metadata.refresh===true});
        if(metadata.review===true || !result.automatic){send(res,result.candidates.length?409:404,{error:result.candidates.length?'请选择合适的专辑封面':'没有找到匹配的专辑封面，可以手动选择图片',candidates:result.candidates,warnings:result.warnings});return true;}
        const cover=await artwork.image(result.automatic,controller.signal);
        res.writeHead(200,{'Content-Type':cover.type,'Content-Length':cover.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Artwork-Source':encodeURIComponent(cover.source)});res.end(cover.bytes);return true;
      }
      const artworkCandidate=/^\/api\/artwork\/candidates\/([a-f0-9]{32})$/.exec(url.pathname);
      if(method==='GET' && artworkCandidate){
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const cover=await artwork.image(artworkCandidate[1],controller.signal);
        res.writeHead(200,{'Content-Type':cover.type,'Content-Length':cover.bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Artwork-Source':encodeURIComponent(cover.source)});res.end(cover.bytes);return true;
      }
      if(method==='GET' && url.pathname==='/api/sources') {send(res,200,{sources:service.sources()});return true;}
      if(method==='GET' && url.pathname==='/api/search') {
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const limit=Math.max(1,Math.min(30,Number(url.searchParams.get('limit'))||20));
        const result=await service.search(url.searchParams.get('q'),url.searchParams.get('source')||'all',limit,controller.signal);send(res,200,result);return true;
      }
      if(method==='GET' && url.pathname==='/api/downloads') {send(res,200,{jobs:service.list()});return true;}
      if(method==='POST' && url.pathname==='/api/downloads') {
        const data=await body(req);if(typeof data?.key!=='string' || !/^[a-f0-9]{32}$/.test(data.key)) throw new Error('请从搜索结果选择歌曲下载');
        send(res,202,{job:await service.create(data.key,data.lyrics)});return true;
      }
      const match=/^\/api\/downloads\/([a-f0-9-]{36})\/(audio|lyrics|pause|resume|cancel|retry)$/.exec(url.pathname);
      if(match) {
        const [,id,action]=match;const job=service.get(id);
        if(!job){send(res,404,{error:'未找到下载任务'});return true;}
        if(method==='POST' && ['pause','resume','cancel','retry'].includes(action)) {send(res,200,{job:await service.control(id,action)});return true;}
        if(method==='GET' && ['audio','lyrics'].includes(action)) {
          if(job.status!=='completed' || (action==='lyrics'&&!job.hasLyrics)) {send(res,404,{error:'文件尚未下载完成'});return true;}
          const file=service.file(service.jobs.get(id),action);let info;
          try {info=await stat(file);} catch {send(res,404,{error:'本地文件已被移动或删除，请重新下载'});return true;}
          const filename=action==='audio'?job.filename:job.filename.replace(/\.[^.]+$/,'.lrc');
          const mime=action==='lyrics'?'text/plain; charset=utf-8':({'mp3':'audio/mpeg',flac:'audio/flac',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav'}[job.song.format]||'application/octet-stream');
          res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
          const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return true;
        }
      }
      send(res,404,{error:'未找到这个功能'});return true;
    } catch(error) {if(!res.headersSent&&!res.destroyed)send(res,error.status===404?404:400,{error:error.message||'操作失败，请重试'});return true;}
  };
}
