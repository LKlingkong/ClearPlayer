import {json as remoteJson,request} from './providers/http.mjs';
import {recordingMatch,normalizeName,songIdentity} from '../shared/music-identity.mjs';

const headers={'User-Agent':'Mozilla/5.0','Referer':'https://music.163.com/'};
const qqHeaders={...headers,Referer:'https://y.qq.com/'};
const allowed=host=>['music.163.com','163cn.tv','163cn.link','y.qq.com','c.y.qq.com','qqmusic.qq.com'].includes(host)||host.endsWith('.y.qq.com');
function inputUrl(input){
 if(typeof input!=='string'||input.length>2000)throw new Error('请粘贴 QQ 音乐或网易云的公开歌单分享链接');
 const found=input.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[，。；、）)]+$/u,'');
 let url;try{url=new URL(found);}catch{throw new Error('请粘贴完整的歌单分享链接');}
 if(!['http:','https:'].includes(url.protocol)||!allowed(url.hostname)||url.username||url.password||(url.port&&url.port!=='443'&&url.port!=='80'))throw new Error('仅支持 QQ 音乐和网易云音乐的公开歌单链接');
 return url;
}
export function parsePlaylistInput(input){
 const url=inputUrl(input),path=url.pathname+url.hash;
 const params=new URLSearchParams((url.hash.includes('?')?url.hash.split('?')[1]:url.search).replace(/^\?/,''));
 let sourceId;
 if(url.hostname==='music.163.com'&&/playlist/i.test(path)){
  sourceId=params.get('id')||/playlist\/(\d+)/.exec(path)?.[1];if(/^\d{1,20}$/.test(sourceId||''))return {source:'netease',sourceId};
 }
 if(url.hostname.endsWith('qq.com')){
  sourceId=url.searchParams.get('disstid')||url.searchParams.get('ADTAG')&&null;
  if(/playlist|playsquare|taoge/i.test(path))sourceId||=url.searchParams.get('id')||/playlist\/(\d+)/.exec(path)?.[1];
  if(/^\d{1,20}$/.test(sourceId||''))return {source:'qq',sourceId};
 }
 throw new Error('没有识别到歌单编号，请使用歌单的分享链接，而非单曲或个人主页');
}
const neSong=s=>({id:String(s.id),source:'netease',title:s.name,artist:(s.ar||s.artists||[]).map(a=>a.name).filter(Boolean).join('/'),album:(s.al||s.album)?.name||'',duration:Number(s.dt||s.duration||0)/1000,format:'mp3',artworkUrl:(s.al||s.album)?.picUrl});
const qqSong=s=>({id:String(s.mid||s.songmid||s.id||s.songid)+'#M500',source:'qq',title:s.name||s.songname,artist:(s.singer||[]).map(a=>a.name).filter(Boolean).join('/'),album:s.album?.name||s.albumname||'',duration:Number(s.interval||0),format:'mp3'});
const coverUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.href:undefined;}catch{return undefined;}};
export class DiscoveryService{
 constructor({json=remoteJson,fetchRequest=request}={}){this.json=json;this.fetchRequest=fetchRequest;this.cache=new Map();}
 async resolveInput(input,signal){
  try{return parsePlaylistInput(input);}catch(error){
   let url=inputUrl(input);
   if(!['163cn.tv','163cn.link'].includes(url.hostname)&&!/(?:^|\/)(?:n\/(?:m\/)?detail|base\/fcgi-bin\/u|w|s)(?:\/|$)/i.test(url.pathname))throw error;
   for(let i=0;i<5;i++){
    const r=await this.fetchRequest(url.href,{headers:qqHeaders,redirect:'manual',signal});
    if(![301,302,303,307,308].includes(r.status)){await r.body?.cancel();break;}
    const location=r.headers.get('location');await r.body?.cancel();
    if(!location)break;url=inputUrl(new URL(location,url).href);
    try{return parsePlaylistInput(url.href);}catch{/* Continue only through whitelisted share redirects. */}
   }
   throw new Error('短链接暂时无法展开，请打开歌单后复制完整分享链接');
  }
 }
 async playlist(input,signal){
  const {source,sourceId}=await this.resolveInput(input,signal);
  const p=source==='netease'?await this.netease(sourceId,signal):await this.qq(sourceId,signal);
  return {...p,source,sourceId,sourceUrl:source==='netease'?`https://music.163.com/playlist?id=${sourceId}`:`https://y.qq.com/n/ryqq/playlist/${sourceId}`};
 }
 async netease(id,signal){
  const d=await this.json(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=100000&s=0`,{headers,signal});
  const p=d.playlist;if(d.code!==200||!p)throw new Error('无法访问此歌单，请确认它是公开歌单且没有被删除');
  const ids=(p.trackIds||[]).map(s=>String(s.id)),map=new Map((p.tracks||[]).map(s=>[String(s.id),s]));
  const missing=ids.filter(id=>!map.has(id)).slice(0,10000);
  const warnings=[];
  for(let i=0;i<missing.length;i+=200){
   const batch=missing.slice(i,i+200);
   try{const details=await this.json(`https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify(batch.map(id=>({id:Number(id)}))))}`,{headers,signal});for(const s of details.songs||[])map.set(String(s.id),s);}
   catch(error){if(signal?.aborted)throw error;warnings.push('部分歌曲详情暂时无法读取，可以稍后检查更新');break;}
  }
  const order=ids.length?ids:[...map.keys()];
  const songs=order.slice(0,10000).map(id=>map.has(id)?neSong(map.get(id)):{id,source:'netease',title:`暂不可用的歌曲 (${id})`,artist:'',album:'',duration:0,unavailable:true});
  const total=Number(p.trackCount)||order.length,complete=total===songs.length&&songs.every(s=>!s.unavailable);
  if(!complete)warnings.push(`歌单共 ${total} 首，已读取 ${songs.filter(s=>!s.unavailable).length} 首详情；不可用条目会保留原位置`);
  return {name:p.name||'网易云歌单',cover:coverUrl(p.coverImgUrl),tags:(p.tags||[]).filter(t=>typeof t==='string'),description:p.description||'',songs,total,complete,warnings};
 }
 async qq(id,signal){
  const songs=[],seen=new Set(),warnings=[];let first,total=0;
  for(let begin=0;begin<10000;begin+=500){
   const d=await this.json(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&utf8=1&disstid=${id}&loginUin=0&format=json&new_format=1&onlysong=0&song_begin=${begin}&song_num=500`,{headers:qqHeaders,signal});
   const p=d.cdlist?.[0];if(Number(d.code)!==0||!p){if(!first)throw new Error('无法访问此 QQ 歌单，请确认歌单公开且分享链接有效');warnings.push('后续歌曲读取失败，可以稍后检查更新');break;}
   first||=p;total=Number(p.total_song_num||p.songnum||0);
   let added=0;for(const raw of p.songlist||[]){const s=qqSong(raw);if(!s.title||!s.id||seen.has(s.id))continue;seen.add(s.id);songs.push(s);added++;}
   if(!added||songs.length>=total||!total)break;
  }
  total||=songs.length;const complete=total===songs.length;
  if(!complete)warnings.push(`原歌单共 ${total} 首，目前读取 ${songs.length} 首，上游可能限制未登录访问；可重试检查更新`);
  return {name:first?.dissname||'QQ 音乐歌单',cover:coverUrl(first?.logo||first?.picurl),description:first?.desc||'',tags:(first?.tags||[]).map(t=>t.name).filter(Boolean),songs,total,complete,warnings};
 }
 async candidates(seeds,tags,signal){
  if(!Array.isArray(seeds)||seeds.length>6||!Array.isArray(tags)||tags.length>12)throw new Error('偏好参数无效');
  const signature=JSON.stringify([seeds,tags]);const cached=this.cache.get(signature);if(cached&&Date.now()-cached.time<3600000)return cached.value;
  const songs=[],warnings=[];let successes=0;
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000);
  const add=(items,reason,seed,tags=[])=>{for(const song of items)if(song.title&&song.artist)songs.push({...song,reason,seed,tags});};
  // Seed resolution is deliberately strict; an artist-name search is not a similar-song recommendation.
  const seedTasks=seeds.slice(0,4).map(async seed=>{
   if(typeof seed?.title!=='string'||typeof seed?.artist!=='string')return;
   try{
    let id=seed.onlineSource==='netease'?String(seed.onlineId||''):seed.source==='netease'?String(seed.id):'';
    if(!/^\d+$/.test(id)){
     const found=await this.json(`https://music.163.com/api/search/get?s=${encodeURIComponent(`${seed.title} ${seed.artist}`.slice(0,150))}&type=1&limit=8&offset=0`,{headers,signal:bounded});
     id=(found.result?.songs||[]).map(neSong).find(s=>recordingMatch(s,seed))?.id||'';
    }
    if(!id)return;
    const d=await this.json(`https://music.163.com/api/discovery/simiSong?artistid=0&songid=${id}&limit=30`,{headers,signal:bounded});
    if(d.code!==undefined&&d.code!==200)throw new Error('相似歌曲暂不可用');successes++;
    add((d.songs||[]).map(neSong),`和「${seed.title}」的听感相近`,seed.title);
   }catch(error){if(signal?.aborted)throw error;warnings.push(`「${seed.title}」的相似歌曲暂不可用`);}
  });
  const tagTasks=tags.filter(t=>typeof t==='string'&&t.length<40).slice(0,3).map(async tag=>{
   try{
    const d=await this.json(`https://music.163.com/api/playlist/list?cat=${encodeURIComponent(tag)}&order=hot&limit=2&offset=0`,{headers,signal:bounded});
    if(d.code!==undefined&&d.code!==200)throw new Error('风格歌单暂不可用');
    if(!(d.playlists||[]).length)successes++;
    await Promise.all((d.playlists||[]).slice(0,2).map(async p=>{
     const list=await this.json(`https://music.163.com/api/v6/playlist/detail?id=${String(p.id)}&n=40&s=0`,{headers,signal:bounded});if(!list.playlist)throw new Error('风格歌曲暂不可用');successes++;add((list.playlist?.tracks||[]).slice(0,35).map(neSong),`来自「${tag}」风格歌单`,undefined,[tag]);
    }));
   }catch(error){if(signal?.aborted)throw error;warnings.push(`「${tag}」风格候选暂不可用`);}
  });
  await Promise.all([...seedTasks,...tagTasks]);
  const unique=[...new Map(songs.map(s=>[songIdentity(s),s])).values()].slice(0,250);
  if(!unique.length)warnings.push('暂时没有找到新的候选，可以添加偏好标签、收藏更多歌曲后再试');
  const value={songs:unique,warnings:[...new Set(warnings)],unavailable:successes===0&&warnings.some(w=>/暂不可用/.test(w))};
  if(!value.unavailable)this.cache.set(signature,{time:Date.now(),value});if(this.cache.size>25)this.cache.delete(this.cache.keys().next().value);return value;
 }
}
