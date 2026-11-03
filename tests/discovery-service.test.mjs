import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylistInput,DiscoveryService} from '../server/discovery.mjs';
import {MusicService} from '../server/music-service.mjs';
import {ArtworkService} from '../server/artwork.mjs';
import {readFile} from 'node:fs/promises';
test('accepts shared playlist text and hash URLs, rejects arbitrary hosts and song links',()=>{
 assert.deepEqual(parsePlaylistInput('分享歌单 https://music.163.com/#/playlist?id=123&userid=45'),{source:'netease',sourceId:'123'});
 assert.deepEqual(parsePlaylistInput('https://y.qq.com/n/ryqq/playlist/123'),{source:'qq',sourceId:'123'});
 for(const url of ['http://127.0.0.1/a','https://y.qq.com.evil.com/playlist/123','https://music.163.com/song?id=123','file:///x'])assert.throws(()=>parsePlaylistInput(url));
});
test('NetEase retrieves missing detail rows in original ID order and exposes incomplete metadata',async()=>{
 const transport=async url=>url.includes('playlist/detail')?{code:200,playlist:{id:123,name:'测试歌单',trackCount:3,trackIds:[{id:1},{id:2},{id:3}],tracks:[{id:1,name:'歌1',ar:[{name:'甲'}],al:{name:'专辑'},dt:200000}],tags:['摇滚']}}:{code:200,songs:[{id:3,name:'歌3',ar:[{name:'甲'}],al:{name:'专辑'},dt:200000}]};
 const d=new DiscoveryService({json:transport});const p=await d.playlist('https://music.163.com/playlist?id=123');
 assert.equal(p.total,3);assert.equal(p.songs.length,3);assert.equal(p.songs[2].title,'歌3');
 assert.equal(p.complete,false);assert.ok(p.warnings.length);assert.equal(p.songs[1].unavailable,true);
});
test('QQ playlist count mismatch is visible, never reported complete',async()=>{
 const d=new DiscoveryService({json:async()=>({code:0,cdlist:[{dissname:'QQ歌单',total_song_num:4,songlist:[{songmid:'a',songname:'歌',singer:[{name:'甲'}],interval:200}]}]})});
 const p=await d.playlist('https://y.qq.com/n/ryqq/playlist/123');assert.equal(p.complete,false);assert.ok(p.warnings.length);assert.equal(p.songs.length,1);
});
test('private and removed playlists produce actionable error',async()=>{
 const d=new DiscoveryService({json:async()=>({code:200,cdlist:[]})});
 await assert.rejects(d.playlist('https://y.qq.com/n/ryqq/playlist/123'),/公开|私密|访问/);
});
test('share short links cannot redirect to arbitrary or private hosts',async()=>{
 let calls=0;const d=new DiscoveryService({fetchRequest:async()=>{calls++;return {status:302,headers:new Headers({location:'http://127.0.0.1/private'}),body:{cancel:async()=>{}}};}});
 await assert.rejects(d.playlist('https://c6.y.qq.com/base/fcgi-bin/u?__=abc'),/仅支持/);assert.equal(calls,1);
});
test('independent seed candidates are fetched concurrently and failures preserve successful songs',async()=>{
 let started=0,release;const gate=new Promise(r=>release=r);
 const d=new DiscoveryService({json:async url=>{
  started++;if(started===3)release();await gate;
  if(url.includes('songid=2'))throw new Error('源失败');
  const id=url.includes('songid=1')?11:33;return {songs:[{id,name:'相似'+id,artists:[{name:'歌手'}],album:{name:'唱片'},duration:200000}]};
 }});
 const result=await d.candidates([1,2,3].map(id=>({source:'netease',id:String(id),title:'歌'+id,artist:'歌手'})),[]);
 assert.equal(started,3);assert.equal(result.songs.length,2);assert.equal(result.warnings.length,1);
});
test('total candidate source outage is explicit and is not cached for an hour',async()=>{
 let calls=0;const d=new DiscoveryService({json:async()=>{calls++;throw new Error('网络故障');}});
 const seeds=[{source:'netease',id:'1',title:'种子',artist:'歌手'}];
 const a=await d.candidates(seeds,[]);assert.equal(a.unavailable,true);await d.candidates(seeds,[]);assert.equal(calls,2);
});
test('desktop playlist images use bounded official-CDN proxy, rejecting local URLs',async()=>{
 const png=await readFile('tests/fixtures/embedded-cover.png');let calls=0;
 const service=new ArtworkService({fetchImpl:async url=>{calls++;assert.ok(String(url).startsWith('https://qpic.y.qq.com/'));return new Response(png);}});
 const image=await service.imageFromUrl('http://qpic.y.qq.com/music_cover/example/300');assert.equal(image.type,'image/png');assert.deepEqual(image.bytes,png);
 await assert.rejects(service.imageFromUrl('http://127.0.0.1/private'),/来源|支持/);assert.equal(calls,1);
});
test('registration strips arbitrary download URLs, and prepare rejects a cover-only match',async()=>{
 const service=new MusicService({directory:'.verification/discovery-unit',providers:[{id:'netease',name:'网易',search:async()=>[]},{id:'qq',name:'QQ',search:async()=>[{id:'cover',title:'测试歌',artist:'别人',duration:200}]}]});
 const registered=service.register({id:'1',source:'netease',title:'测试歌',artist:'原唱',duration:200,url:'http://127.0.0.1/private'});
 assert.equal(service.catalog.get(registered.key).url,undefined);assert.equal(registered.key.length,32);
 await assert.rejects(service.prepare({id:'local:1',source:'local',title:'测试歌',artist:'原唱',duration:200}),/同一版本|匹配/);
});
