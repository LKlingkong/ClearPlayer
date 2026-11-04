import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryService} from '../server/discovery.mjs';
import {buildTaste,rankRadar} from '../src/lib/discovery.ts';
import {RadarRecall} from '../server/radar.mjs';

const ne=(id,title,artist,extra={})=>({id,name:title,artists:[{name:artist}],album:{name:'专辑'},duration:200000,...extra});
const local={title:'起风了',artist:'买辣椒也用券',duration:325,album:'专辑'};
const service=(transport,qqSearch=async()=>[])=>new DiscoveryService({json:transport,qqSearch});
const empty={code:200,result:{songs:[],playlists:[]},songs:[],playlists:[]};

test('local file without platform ID resolves artist alias and recalls other performers',async()=>{
 let similarity=false;
 const d=service(async url=>{const u=new URL(url);if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1')return {code:200,result:{songs:[ne(1,'起风了','冯沁苑(买辣椒也用券)',{duration:325868})]}};
 if(url.includes('simiSong')){similarity=true;return {code:200,songs:[ne(2,'另一个声音','其他歌手')]};}return empty;});
 const result=await d.candidates([local],[]);assert.ok(similarity);assert.ok(result.songs.some(s=>s.artist==='其他歌手'));
});
test('all six seeds are used even when the first four have no platform match',async()=>{
 const d=service(async url=>{const u=new URL(url);if(url.includes('simiSong'))return {code:200,songs:[ne(100,'第五首找到的新歌','新歌手')]};
 if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1'){const match=/歌(\d)/.exec(u.searchParams.get('s'));return {code:200,result:{songs:Number(match?.[1])>=5?[ne(Number(match[1]),'歌'+match[1],'歌手'+match[1])]:[]}};}return empty;});
 const result=await d.candidates(Array.from({length:6},(_,i)=>({title:'歌'+(i+1),artist:'歌手'+(i+1),duration:200})),[]);assert.ok(result.songs.length>0);
});
test('search business failures are explicit and empty results never suppress a retry',async()=>{
 let fail=true,calls=0;const d=service(async url=>{calls++;if(fail)return {code:500};if(url.includes('simiSong'))return {code:200,songs:[ne(2,'恢复后的新歌','新歌手')]};if(new URL(url).searchParams.get('type')==='1')return {code:200,result:{songs:[ne(1,local.title,local.artist)]}};return empty;});
 const a=await d.candidates([local],[]);assert.equal(a.unavailable,true);const before=calls;fail=false;
 const b=await d.candidates([local],[]);assert.ok(calls>before);assert.ok(b.songs.length);
});
test('valid empty results are not cached and manual refresh bypasses positive cache',async()=>{
 let calls=0,fill=false;const d=service(async url=>{calls++;if(url.includes('simiSong'))return {code:200,songs:fill?[ne(3,'新歌','新歌手')]:[]};return empty;});
 const seeds=[{...local,onlineSource:'netease',onlineId:'1'}];await d.candidates(seeds,[]);const before=calls;fill=true;const second=await d.candidates(seeds,[]);assert.ok(calls>before);assert.ok(second.songs.length);
 const cachedCalls=calls;await d.candidates(seeds,[]);assert.equal(calls,cachedCalls);await d.candidates(seeds,[],undefined,{refresh:true});assert.ok(calls>cachedCalls);
});
test('empty tag responses cannot disguise a failed similarity source',async()=>{
 const d=service(async url=>{if(url.includes('simiSong'))throw Error('源故障');return empty;});
 const result=await d.candidates([{...local,onlineSource:'netease',onlineId:'1'}],['摇滚']);assert.equal(result.unavailable,true);
});
test('related playlist tags expand to different artists and preserve their real recommendation reason',async()=>{
 const d=service(async url=>{const u=new URL(url);if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1000')return {code:200,result:{playlists:[{id:50,name:'种子歌手的R&B听感'}]}};
 if(url.includes('playlist/list'))return {code:200,playlists:[{id:60,name:'R&B律动'}]};
 if(url.includes('playlist/detail')){const context=u.searchParams.get('id')==='50';return {code:200,playlist:{id:context?50:60,name:'R&B律动',tags:['R&B/Soul'],tracks:[context?ne(1,'本地作品','种子歌手'):ne(3,'跨歌手的新作品','另一位歌手')].map(s=>({...s,ar:s.artists,al:s.album,dt:s.duration}))}};}return empty;});
 const result=await d.candidates([{title:'本地作品',artist:'种子歌手',duration:200}],[]);
 assert.ok(result.songs.some(s=>s.artist==='另一位歌手'));assert.ok(result.songs.some(s=>s.relation==='style'&&s.reason.includes('R&B/Soul')));
});
test('QQ supplies verified artist works when NetEase cannot identify the local recording',async()=>{
 const d=service(async()=>empty,async query=>query.includes('周杰伦')?[{id:'jay#M500',source:'qq',title:'发如雪',artist:'周杰伦',album:'十一月的萧邦',duration:299}]:[]);
 const result=await d.candidates([{title:'晴天',artist:'周杰伦',duration:269}],[]);assert.ok(result.songs.some(s=>s.source==='qq'&&s.title==='发如雪'));
});
test('a source ignoring the requested style cannot fill the radar with an unrelated hot list',async()=>{
 const d=service(async url=>url.includes('playlist/list')?{code:200,playlists:[{id:9}]}:{code:200,playlist:{name:'热门流行',tags:['流行'],tracks:[ne(10,'无关热歌','歌手')]}});
 const result=await d.candidates([],['后摇']);assert.equal(result.songs.length,0);
});
test('slow NetEase seed requests leave an independent QQ fallback time to return',async()=>{
 let qqCalled=false;const d=new RadarRecall({timeout:100,seedTimeout:20,json:async(_url,{signal})=>{if(signal.aborted)throw signal.reason;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},qqSearch:async()=>{qqCalled=true;return [{id:'qq#M500',source:'qq',title:'相关新歌',artist:local.artist,album:'',duration:200}];}});
 const result=await d.candidates([local],[],AbortSignal.timeout(300));assert.ok(qqCalled);assert.ok(result.songs.length);
});
test('one verified playlist can supply context and then different-artist style songs without a second fetch',async()=>{
 let details=0;const d=service(async url=>{
  const u=new URL(url);if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1000')return {code:200,result:{playlists:[{id:50}]}};
  if(url.includes('playlist/list'))return {code:200,playlists:[{id:50}]};
  if(url.includes('playlist/detail')){details++;return {code:200,playlist:{name:'爵士同场',tags:['爵士'],tracks:[ne(1,'种子','种子歌手'),ne(2,'爵士新作','其他歌手')]}};}return empty;
 });
 const result=await d.candidates([{title:'种子',artist:'种子歌手',duration:200}],[]);assert.ok(result.songs.some(s=>s.artist==='其他歌手'));assert.equal(details,1);
});
test('unrelated artist-search playlists cannot supply inferred style preferences',async()=>{
 const d=service(async url=>{
  const u=new URL(url);if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1000')return {code:200,result:{playlists:[{id:50}]}};
  if(url.includes('playlist/list'))return {code:200,playlists:[{id:60}]};
  if(url.includes('playlist/detail'))return {code:200,playlist:{name:'不相关的重金属',tags:['重金属'],tracks:[ne(2,'无关作品','不相关歌手')]}};return empty;
 });
 const result=await d.candidates([{title:'钢琴曲',artist:'钢琴歌手',duration:200}],[]);assert.deepEqual(result.styles,[]);assert.equal(result.songs.length,0);
});
test('existing platform IDs are excluded from new discoveries even when metadata was revised',()=>{
 const track={id:'local',title:'原名称',artist:'歌手',album:'',duration:200,favorite:true,onlineSource:'netease',onlineId:'123'};
 const out=rankRadar([{id:'123',source:'netease',title:'平台修订名称',artist:'歌手',album:'',duration:200}],[track],{}, {exploration:70,tags:[],disliked:[],hiddenArtists:[]},'test');assert.equal(out.filter(s=>!s.localId).length,0);
});
test('taste selects diverse seed artists and ranking does not drown style discoveries in same-artist works',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:'local'+i,title:'旧歌'+i,artist:i<8?'常听歌手':'种子歌手'+i,album:'',duration:200,favorite:true}));
 assert.ok(new Set(buildTaste(tracks,{},[]).seeds.map(s=>s.artist)).size>=4);
 const candidates=Array.from({length:35},(_,i)=>({id:String(i),source:'netease',title:'新歌'+i,artist:i<20?'常听歌手':'新歌手'+i,album:'',duration:200,relation:i<20?'artist':'style',reason:'真实来源'}));
 const out=rankRadar(candidates,tracks,{}, {exploration:70,tags:[],disliked:[],hiddenArtists:[]},'test');
 assert.equal(out.filter(s=>!s.localId).length,21);assert.ok(out.filter(s=>!s.localId&&s.artist==='常听歌手').length<=6);
});
