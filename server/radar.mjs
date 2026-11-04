import {json as remoteJson} from './providers/http.mjs';
import {provider as qqProvider} from './providers/qq.mjs';
import {normalizeName,songIdentity,versionOf} from '../shared/music-identity.mjs';

const headers={Referer:'https://music.163.com/'};
const normalizeSong=s=>({id:String(s.id),source:'netease',title:s.name,artist:(s.ar||s.artists||[]).map(a=>a.name).filter(Boolean).join('/'),album:(s.al||s.album)?.name||'',duration:Number(s.dt||s.duration||0)/1000,format:'mp3',artworkUrl:(s.al||s.album)?.picUrl});
const artistParts=value=>String(value||'').split(/[/／&,，、;；()（）]|\s+feat\.?\s+|\s+and\s+/i).map(normalizeName).filter(Boolean);
const knownArtist=value=>!!String(value||'').trim()&&!/未知歌手|unknown\s*artist|^unknown$/i.test(value);
export function relatedArtist(a,b){if(!knownArtist(a)||!knownArtist(b))return false;const aa=artistParts(a),bb=artistParts(b);return aa.some(x=>bb.includes(x));}
export function seedMatch(a,b){return normalizeName(a.title)===normalizeName(b.title)&&relatedArtist(a.artist,b.artist)&&versionOf(a)===versionOf(b);}
const strength={similar:4,playlist:3,style:2,artist:1};
const regionTag=/^(华语|欧美|日语|韩语|粤语)$/;
const broadTag=/^(华语|欧美|日语|韩语|粤语|国语|闽南语|小语种|全部|[789]0后|00后|10后|经典|怀旧|治愈|伤感|安静|浪漫|快乐|放松|夜晚|学习|工作|运动|驾车|旅行)$/;
async function mapLimit(items,limit,run){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;await run(items[i],i);}}));}

export class RadarRecall{
 constructor({json=remoteJson,qqSearch=(...args)=>qqProvider.search(...args),timeout=18000,seedTimeout=6500}={}){this.json=json;this.qqSearch=qqSearch;this.cache=new Map();this.timeout=timeout;this.seedTimeout=seedTimeout;}
 async candidates(seeds,tags,signal,{refresh=false,batch=0}={}){
  if(!Array.isArray(seeds)||seeds.length>6||!Array.isArray(tags)||tags.length>12||seeds.some(s=>!s||typeof s.title!=='string'||typeof s.artist!=='string'||s.title.length>300||s.artist.length>300)||tags.some(t=>typeof t!=='string'||t.length>40))throw new Error('偏好参数无效');
  batch=Math.max(0,Math.min(100000,Math.floor(Number(batch)||0)));
  const key=JSON.stringify([seeds,tags,batch]),cached=this.cache.get(key);
  if(!refresh&&cached&&Date.now()-cached.time<300000)return cached.value;
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout);
  const seedSignal=AbortSignal.any([bounded,AbortSignal.timeout(this.seedTimeout)]);
  const warnings=[],pool=new Map(),listData=new Map(),expandedData=new Map(),processedLists=new Set(),derivedTags=new Set(),regions=new Map();
  const diagnostics={seeds:seeds.length,matchedSeeds:0,similar:0,playlist:0,style:0,artist:0,failedRequests:0};
  const add=(items,relation,reason,seed,styleTags=[])=>{
   for(const item of items){
    if(!item?.id||!item.title||!knownArtist(item.artist))continue;
    const song={...item,relation,reason,seed,tags:styleTags},id=songIdentity(song),existing=pool.get(id);
    if(!existing||strength[relation]>strength[existing.relation])pool.set(id,song);
    diagnostics[relation]++;
   }
  };
  const warn=(label,error)=>{signal?.throwIfAborted();diagnostics.failedRequests++;warnings.push(`${label}暂不可用`);};
  const get=async(url,requestSignal=bounded)=>{
   requestSignal.throwIfAborted();const data=await this.json(url,{headers,signal:requestSignal});
   if(!data||data.code!==undefined&&Number(data.code)!==200)throw new Error(`网易云接口返回 ${data?.code??'无效内容'}`);
   return data;
  };
  const search=async(query,type,limit=12,requestSignal=bounded)=>get(`https://music.163.com/api/search/get?s=${encodeURIComponent(query.slice(0,150))}&type=${type}&limit=${limit}&offset=${type===1000?batch%5*2:0}`,requestSignal);
  const songsFromSearch=data=>{
   if(Array.isArray(data.result?.songs))return data.result.songs.map(normalizeSong);
   if(Number(data.result?.songCount)===0)return [];
   throw new Error('歌曲搜索响应格式无效');
  };
  const contexts=seeds.map(seed=>({seed,id:'',matched:false}));
  const artists=[...new Map(contexts.filter(c=>knownArtist(c.seed.artist)).map(c=>[normalizeName(c.seed.artist),c])).values()];
  // Independent sources start now, so a stalled seed lookup cannot consume their entire time budget.
  const qqTask=mapLimit(artists,2,async({seed})=>{
   try{const found=await this.qqSearch(seed.artist,30,{signal:bounded});add(found.filter(s=>relatedArtist(s.artist,seed.artist)),'artist',`你常听的${seed.artist}，还有这些作品`,seed.title);}
   catch(error){warn(`QQ 音乐的${seed.artist}相关作品`,error);}
  });
  // Observe cancellation immediately even if the seed phase exits before the later join.
  qqTask.catch(()=>{});
  // Resolve every local seed. Matching a recommendation anchor does not relax audio download rules.
  await mapLimit(contexts,3,async context=>{
   const {seed}=context;
   try{
    let id=seed.onlineSource==='netease'?String(seed.onlineId||''):seed.source==='netease'?String(seed.id||''):'';
    if(!/^\d+$/.test(id)){
     const results=songsFromSearch(await search(`${seed.title} ${seed.artist}`,1,12,seedSignal));
     id=results.find(song=>seedMatch(song,seed))?.id||'';
    }
    if(!id)return;
    context.id=id;context.matched=true;diagnostics.matchedSeeds++;
    const data=await get(`https://music.163.com/api/discovery/simiSong?artistid=0&songid=${id}&limit=30`,seedSignal);
    if(!Array.isArray(data.songs))throw new Error('相似歌曲响应格式无效');
    add(data.songs.map(normalizeSong),'similar',`和「${seed.title}」的听感相近`,seed.title);
   }catch(error){warn(`「${seed.title}」的相似歌曲`,error);}
  });
  const readList=async(list,reason,seed,relation='playlist',styleTags=[],contextArtist='')=>{
   const id=String(list.id||''),stageKey=`${id}:${relation}:${styleTags.join(',')}`;if(!/^\d+$/.test(id)||processedLists.has(stageKey))return;
   if(!listData.has(id)){if(listData.size>=12)return;listData.set(id,get(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=80&s=0`));}
   const data=await listData.get(id),p=data.playlist;
   if(!p||!Array.isArray(p.tracks))throw new Error('相关歌单详情无效');
   processedLists.add(stageKey);
   if(relation==='style'&&styleTags.length&&!styleTags.some(tag=>(p.tags||[]).some(t=>normalizeName(t)===normalizeName(tag))||normalizeName(p.name||list.name||'').includes(normalizeName(tag))))return;
   // Rotate through the public list instead of returning the same first entries on every refresh.
   let tracks=p.tracks;
   if((relation!=='context'||!tracks.some(s=>relatedArtist(normalizeSong(s).artist,contextArtist)))&&Array.isArray(p.trackIds)&&p.trackIds.length>tracks.length){
    if(!expandedData.has(id))expandedData.set(id,(async()=>{
    const ids=p.trackIds.map(s=>String(s.id)),offset=ids.length?batch*13%ids.length:0,wanted=[...ids.slice(offset),...ids.slice(0,offset)].slice(0,65),byId=new Map(tracks.map(s=>[String(s.id),s]));
    const missing=wanted.filter(id=>!byId.has(id));
    if(missing.length)try{const details=await get(`https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify(missing.map(id=>({id:Number(id)}))))}`);for(const s of details.songs||[])byId.set(String(s.id),s);}catch(error){warn('部分风格歌曲详情',error);}
    return wanted.map(id=>byId.get(id)).filter(Boolean);
    })());tracks=await expandedData.get(id);
   }
   if(relation==='context'&&!tracks.some(s=>relatedArtist(normalizeSong(s).artist,contextArtist)))return;
   for(const tag of p.tags||[])if(typeof tag==='string'&&!broadTag.test(tag))derivedTags.add(tag);
   if(relation==='playlist'||relation==='context')for(const tag of p.tags||[])if(regionTag.test(tag))regions.set(tag,(regions.get(tag)||0)+1);
   // Artist-name search supplies style context only after a matching performer was found in the list.
   if(relation==='context')return;
   const offset=tracks.length?batch*13%tracks.length:0,sample=[...tracks.slice(offset),...tracks.slice(0,offset)].slice(0,65);
   add(sample.map(normalizeSong),relation,reason||`与你常听作品相关的「${String(p.name||list.name||'歌单').slice(0,60)}」`,seed,styleTags);
  };
  if(!bounded.aborted)await Promise.all([
   mapLimit(artists,2,async context=>{
    const {seed,id}=context;
    try{
     let lists=[];
     if(id){const related=await get(`https://music.163.com/api/discovery/simiPlaylist?songid=${id}&limit=3`);lists=related.playlists||[];}
     if(lists.length){await mapLimit(lists.slice(0,1),1,p=>readList(p,`和「${seed.title}」共同收录的歌单`,seed.title));}
     else{
      const found=await search(seed.artist,1000,3);
      if(!Array.isArray(found.result?.playlists)&&Number(found.result?.playlistCount)!==0)throw new Error('歌单搜索响应格式无效');
      await mapLimit((found.result?.playlists||[]).slice(0,1),1,p=>readList(p,undefined,seed.title,'context',[],seed.artist));
     }
    }catch(error){warn(`「${seed.title}」的相关歌单`,error);}
   }),
   qqTask
  ]);
  await qqTask;
  // Public related-list tags supply style context even when imported MP3s have no genre field.
  const styles=[...new Set([...tags,...derivedTags])].filter(t=>t.trim()).slice(0,3);
  const region=tags.find(t=>regionTag.test(t))||[...regions].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!bounded.aborted)await mapLimit(styles,2,async tag=>{
   try{
    const useRegion=region&&region!==tag;
    const data=useRegion?await search(`${region} ${tag}`,1000,4):await get(`https://music.163.com/api/playlist/list?cat=${encodeURIComponent(tag)}&order=hot&limit=3&offset=${batch%5*2}`);
    const lists=useRegion?data.result?.playlists:data.playlists;
    if(!Array.isArray(lists))throw new Error('风格歌单响应格式无效');
    await mapLimit(lists.slice(0,2),2,p=>readList(p,`来自「${useRegion?region+' · ':''}${tag}」风格歌单`,undefined,'style',[tag]));
   }catch(error){warn(`「${tag}」风格候选`,error);}
  });
  signal?.throwIfAborted();
  const songs=[...pool.values()].sort((a,b)=>strength[b.relation]-strength[a.relation]).slice(0,400);
  if(diagnostics.matchedSeeds<seeds.length&&!songs.length)warnings.push('部分本地歌曲尚未关联到推荐平台，相关歌手和风格来源也未返回可用候选');
  if(!songs.length)warnings.push('本轮未找到新的相关候选，可以点击“重新寻找新歌”重试，或在“我的听感”补充风格');
  const value={songs,warnings:[...new Set(warnings)],unavailable:!songs.length&&diagnostics.failedRequests>0,diagnostics,styles};
  // An empty/failed lookup must never lock the user into a library-only radar for an hour.
  if(songs.length){this.cache.set(key,{time:Date.now(),value});while(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);}
  return value;
 }
}
