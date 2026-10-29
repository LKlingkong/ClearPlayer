import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MusicService } from '../server/music-service.mjs';
import { createApiHandler } from '../server/api.mjs';

test('local API searches, downloads, persists history and serves audio/lyrics', async () => {
  const dir=await mkdtemp(join(tmpdir(),'clear-api-test-'));
  const audio=await readFile(new URL('./fixtures/微风.mp3',import.meta.url));
  const media=createServer((_req,res)=>{res.writeHead(200,{'Content-Length':audio.length});res.end(audio);});
  await new Promise(r=>media.listen(0,'127.0.0.1',r));
  const provider={id:'fixture',name:'测试源',async search(q){return [{source:'fixture',id:'1',title:q,artist:'歌手',album:'',duration:20,format:'mp3'}];},async resolve(){return {url:`http://127.0.0.1:${media.address().port}/audio`};},async lyrics(){return '[00:01.00]风吹过';}};
  const service=new MusicService({directory:dir,providers:[provider],allowLocal:true});await service.init();
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const handler=createApiHandler(service,{origins:[origin]});server.on('request',(req,res)=>void handler(req,res));
  const post=(path,data={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
  try {
    const result=await (await fetch(origin+'/api/search?q=微风&source=fixture')).json();assert.equal(result.songs[0].title,'微风');
    const added=await (await post('/api/downloads',{key:result.songs[0].key,lyrics:true})).json();const id=added.job.id;
    for(let i=0;i<200;i++){const j=service.get(id);if(j.status==='completed'||j.status==='failed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(service.get(id).status,'completed',service.get(id).error);assert.equal(service.get(id).hasLyrics,true);
    assert.deepEqual(Buffer.from(await (await fetch(origin+`/api/downloads/${id}/audio`)).arrayBuffer()),audio);
    assert.equal(await (await fetch(origin+`/api/downloads/${id}/lyrics`)).text(),'[00:01.00]风吹过');
    assert.equal((await post('/api/downloads',{url:'http://127.0.0.1/private'})).status,400);
    assert.equal((await fetch(origin+'/api/sources',{headers:{Origin:'https://evil.example'}})).status,403);
    const spoofedHostStatus=await new Promise((resolve,reject)=>{httpGet(origin+'/api/sources',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
    assert.equal(spoofedHostStatus,403);
    assert.equal((await fetch(origin+'/api/downloads/not-a-job/audio')).status,404);
    await service.close();
    const restored=new MusicService({directory:dir,providers:[provider],allowLocal:true});await restored.init();
    assert.equal(restored.get(id).status,'completed');assert.equal(restored.list().length,1);await restored.close();
  } finally {await service.close();server.closeAllConnections();media.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>media.close(r))]);await rm(dir,{recursive:true,force:true});}
});

test('download tasks pause with partial data, resume by Range, and cancel without affecting completed audio', async () => {
  const dir=await mkdtemp(join(tmpdir(),'clear-controls-test-'));
  const audio=await readFile(new URL('./fixtures/微风.mp3',import.meta.url));
  const ranges=[];
  const media=createServer((req,res)=>{
    const start=Number(/^bytes=(\d+)-$/.exec(req.headers.range||'')?.[1])||0;ranges.push(start);
    res.writeHead(start?206:200,{'ETag':'"controls-fixture"','Content-Length':audio.length-start,...(start?{'Content-Range':`bytes ${start}-${audio.length-1}/${audio.length}`}:{})});
    let offset=start;
    const timer=setInterval(()=>{if(offset>=audio.length){clearInterval(timer);res.end();return;}res.write(audio.subarray(offset,offset+1024));offset+=1024;},5);
    res.on('close',()=>clearInterval(timer));
  });await new Promise(r=>media.listen(0,'127.0.0.1',r));
  const provider={id:'fixture',name:'测试源',async search(){return [{source:'fixture',id:'1',title:'微风',artist:'歌手'}];},async resolve(){return {url:`http://127.0.0.1:${media.address().port}/audio`};},async lyrics(){throw new Error('歌词暂不可用');}};
  const service=new MusicService({directory:dir,providers:[provider],allowLocal:true});await service.init();
  const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('task state did not settle');};
  try {
    const {songs}=await service.search('微风','fixture');const first=await service.create(songs[0].key);
    await until(()=>service.get(first.id).received>=1024);
    await service.control(first.id,'pause');assert.equal(service.get(first.id).status,'paused');const paused=service.get(first.id).received;assert.ok(paused>0&&paused<audio.length);
    await service.control(first.id,'resume');await until(()=>service.get(first.id).status==='completed');
    assert.equal(ranges[1],paused);assert.equal(service.get(first.id).hasLyrics,false);assert.match(service.get(first.id).lyricError,/歌词暂不可用/);
    const file=service.file(service.jobs.get(first.id),'audio');assert.deepEqual(await readFile(file),audio);
    provider.search=async()=>[{source:'fixture',id:'2',title:'第二首',artist:'歌手'}];
    const second=await service.create((await service.search('第二首','fixture')).songs[0].key);
    await until(()=>service.get(second.id).received>=1024);await service.control(second.id,'cancel');assert.equal(service.get(second.id).status,'cancelled');
    await assert.rejects(readFile(service.partial(service.jobs.get(second.id))),{code:'ENOENT'});
    assert.deepEqual(await readFile(file),audio);
  } finally {await service.close();media.closeAllConnections();await new Promise(r=>media.close(r));await rm(dir,{recursive:true,force:true});}
});

test('one unavailable provider does not erase successful search results', async () => {
  const dir=await mkdtemp(join(tmpdir(),'clear-search-test-'));
  const service=new MusicService({directory:dir,providers:[{id:'ok',name:'正常源',async search(){return [{id:'a',source:'ok',title:'微风',artist:'歌手'}];}},{id:'bad',name:'故障源',async search(){throw new Error('音源响应超时');}}]});
  try {await service.init();const result=await service.search('微风','all');assert.equal(result.songs.length,1);assert.match(result.warnings[0],/故障源.*超时/);}finally{await service.close();await rm(dir,{recursive:true,force:true});}
});

test('slow provider is bounded so other successful sources still reach the player', async () => {
  const dir=await mkdtemp(join(tmpdir(),'clear-budget-test-'));
  const service=new MusicService({directory:dir,searchTimeout:20,providers:[{id:'ok',name:'正常源',async search(){return [{id:'a',source:'ok',title:'微风'}];}},{id:'slow',name:'慢音源',async search(){await new Promise(r=>setTimeout(r,80));return [{id:'b',source:'slow',title:'慢歌曲'}];}}]});
  try {await service.init();const result=await service.search('微风','all');assert.equal(result.songs.length,1);assert.match(result.warnings[0],/慢音源.*超时/);}finally{await service.close();await rm(dir,{recursive:true,force:true});}
});
