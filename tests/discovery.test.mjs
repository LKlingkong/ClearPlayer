import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingMatch,songIdentity} from '../shared/music-identity.mjs';
import {rankRadar,measureListening,mergePlaylist,buildTaste,prioritizeEntries} from '../src/lib/discovery.ts';

const song=(i,extra={})=>({id:String(i),source:'netease',title:`歌曲${i}`,artist:'歌手甲',album:'唱片',duration:200,...extra});
test('same recording normalizes script and punctuation but rejects versions and covers',()=>{
 assert.ok(recordingMatch(song(1,{title:'後來'}),song(2,{title:'后来'})));
 assert.ok(!recordingMatch(song(1),song(2,{title:'歌曲1 (Live)'})));
 assert.ok(!recordingMatch(song(1),song(2,{title:'歌曲1',artist:'歌手乙'})));
 assert.ok(!recordingMatch(song(1),song(2,{title:'歌曲1',duration:240})));
 assert.equal(songIdentity(song(1)),songIdentity(song(3,{title:'歌曲1'})));
 assert.ok(!recordingMatch(song(1,{title:'歌曲1 (伴奏)'}),song(1)));
});
test('radar mixes exactly 70/30 when supply permits, excludes heard/disliked, and is stable',()=>{
 const tracks=Array.from({length:20},(_,i)=>song(i,{id:`local-${i}`,favorite:i<3,addedAt:0}));
 const remote=Array.from({length:60},(_,i)=>song(i+100));
 const stats={[songIdentity(remote[0])]:{seconds:190,plays:1,completed:1,skips:0,lastPlayed:1000}};
 const preferences={exploration:70,tags:['流行'],disliked:[songIdentity(remote[1])],hiddenArtists:[]};
 const a=rankRadar(remote,tracks,stats,preferences,'2026-11-03',30);
 assert.equal(a.length,30);assert.equal(a.filter(s=>s.localId).length,9);
 assert.ok(!a.some(s=>s.title===remote[0].title||s.title===remote[1].title));
 assert.deepEqual(a,rankRadar(remote,tracks,stats,preferences,'2026-11-03',30));
 assert.ok(a.every(s=>s.reason));
});
test('radar does not silently substitute old music to fake an unavailable new quota',()=>{
 const tracks=Array.from({length:30},(_,i)=>song(i,{id:`local-${i}`}));
 const out=rankRadar([],tracks,{}, {exploration:70,tags:[],disliked:[],hiddenArtists:[]},'a',30);
 assert.equal(out.length,9);assert.ok(out.every(s=>s.localId));
});
test('listening measurement rejects seeks and paused time',()=>{
 assert.equal(measureListening(2,3,true,1.1),1);
 assert.equal(measureListening(2,100,true,1),0);
 assert.equal(measureListening(2,3,false,1),0);
 assert.equal(measureListening(100,2,true,1),0);
});
test('source updates preserve local edits and do not duplicate same platform songs',()=>{
 const old={id:'list',name:'我的名字',entries:[{...song(1),uid:'one'},{...song(2),uid:'two'}]};
 const merged=mergePlaylist(old,{name:'远端名称',songs:[song(2),song(3)]});
 assert.equal(merged.name,'我的名字');assert.deepEqual(merged.entries.map(s=>s.id),['1','2','3']);
 assert.equal(mergePlaylist(merged,{songs:[song(3)]}).entries.length,3);
});
test('taste uses actual file tags and explicit preferences rather than inventing genre',()=>{
 const taste=buildTaste([song(1,{favorite:true,tags:['摇滚']}),song(2)],{},['电子']);
 assert.ok(taste.tags.includes('摇滚'));assert.ok(taste.tags.includes('电子'));
 assert.ok(!taste.tags.includes('流行'));assert.equal(taste.seeds[0].title,'歌曲1');
});
test('a recovered platform row replaces its unavailable placeholder and becomes retryable',()=>{
 const old={name:'本地名称',entries:[{...song(1,{title:'暂不可用',artist:'',unavailable:true}),uid:'kept',status:'failed',error:'资料缺失'}]};
 const merged=mergePlaylist(old,{songs:[song(1)]});assert.equal(merged.entries.length,1);assert.equal(merged.entries[0].uid,'kept');assert.equal(merged.entries[0].title,'歌曲1');assert.ok(!merged.entries[0].unavailable);assert.equal(merged.entries[0].status,'pending');
});
test('a selected pending song is prepared first without changing playlist order',()=>{
 const entries=[1,2,3].map(i=>({...song(i),uid:String(i)}));
 const prioritized=prioritizeEntries(entries,new Set([songIdentity(entries[2])]));
 assert.deepEqual(prioritized.map(e=>e.uid),['3','1','2']);assert.deepEqual(entries.map(e=>e.uid),['1','2','3']);
});
