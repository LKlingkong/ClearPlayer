import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MusicService} from '../server/music-service.mjs';
import {createApiHandler} from '../server/api.mjs';
test('imported song falls back to the same recording only; API keeps local origin protection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'clear-discovery-api-')),audio=await readFile('tests/fixtures/微风.mp3');
 const media=createServer((req,res)=>{res.writeHead(200,{'Content-Length':audio.length});res.end(audio);});await new Promise(r=>media.listen(0,'127.0.0.1',r));
 const resolved=[];const seed={id:'q#M500',source:'qq',title:'同一首歌',artist:'原唱',album:'录音室',duration:20};
 const providers=[{id:'qq',name:'QQ',search:async()=>[],resolve:async()=>{resolved.push('qq');throw new Error('此音源不可用');},lyrics:async()=>''},{id:'netease',name:'网易',search:async()=>[
  {id:'cover',title:seed.title,artist:'翻唱者',duration:20},{id:'live',title:seed.title+' (Live)',artist:'原唱',duration:20},{...seed,id:'original'}
 ],resolve:async s=>{resolved.push(s.id);return {url:`http://127.0.0.1:${media.address().port}/a`};},lyrics:async()=>''}];
 const service=new MusicService({directory:dir,providers,allowLocal:true});await service.init();
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const handler=createApiHandler(service,{origins:[origin],discovery:{playlist:async input=>({name:input,songs:[seed],total:1,complete:true}),candidates:async()=>({songs:[seed],warnings:[]})}});server.on('request',(req,res)=>void handler(req,res));
 const post=(url,data,from=origin)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:from},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/api/playlists/preview',{input:'测试'},'https://evil.example')).status,403);
  assert.equal((await (await post('/api/playlists/preview',{input:'测试'})).json()).total,1);
  const {job}=await (await post('/api/songs/prepare',{song:seed})).json();assert.ok(job.id);
  for(let i=0;i<200;i++){if(['completed','failed'].includes(service.get(job.id).status))break;await new Promise(r=>setTimeout(r,15));}
  assert.equal(service.get(job.id).status,'completed',service.get(job.id).error);
  assert.equal(service.get(job.id).song.source,'netease');assert.deepEqual(resolved,['qq','original']);
  assert.equal((await (await post('/api/songs/prepare',{song:seed})).json()).job.id,job.id);
 }finally{await service.close();server.closeAllConnections();media.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>media.close(r))]);await rm(dir,{recursive:true,force:true});}
});
