import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,truncate} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArtworkService} from '../server/artwork.mjs';
import {findLocalArtwork} from '../desktop/artwork.mjs';
import {createApiHandler} from '../server/api.mjs';
import './artwork-search.test.mjs';

const png=await readFile(new URL('./fixtures/alternate-cover.png',import.meta.url));
const song={title:'晴天',artist:'周杰伦',album:'叶惠美'};
const candidate={trackName:'晴天',artistName:'周杰伦',collectionName:'叶惠美',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/Music/test/100x100bb.jpg'};
const response=(value)=>Response.json({results:value});

test('automatic artwork rejects covers by other artists/versions and uses a matching album',async()=>{
  const requests=[];
  const service=new ArtworkService({fetchImpl:async url=>{
    requests.push(String(url));
    if(String(url).startsWith('https://itunes.apple.com/'))return response([{...candidate,artistName:'翻唱歌手'},{...candidate,trackName:'晴天 (Live)'},{...candidate,collectionName:'演唱会'},candidate]);
    return new Response(png,{headers:{'content-type':'image/png'}});
  }});
  const result=await service.lookup(song);
  assert.deepEqual(result.bytes,png);assert.equal(result.source,'Apple Music');
  assert.equal(requests.length,2);assert.ok(requests[1].includes('/600x600bb.jpg'));
  await service.lookup(song);assert.equal(requests.length,2,'a saved lookup must not download the same image again');
});

test('unknown singer never triggers a network lookup and mismatched album keeps the placeholder',async()=>{
  let calls=0;const service=new ArtworkService({fetchImpl:async()=>{calls++;return response([{...candidate,collectionName:'另一张专辑'}]);}});
  assert.equal(await service.lookup({...song,artist:'未知歌手'}),null);assert.equal(calls,0);
  assert.equal(await service.lookup(song),null);assert.equal(calls,7);
});

test('Chinese regional fallback recognizes traditional tags without accepting a live version',async()=>{
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).startsWith('https://itunes.apple.com/'))return response(new URL(url).searchParams.get('country')==='cn'?[]:[{...candidate,artistName:'周杰倫',collectionName:'葉惠美'}]);
    return new Response(png);
  }});
  assert.deepEqual((await service.lookup(song)).bytes,png);
});

test('artwork lookup rejects non-CDN URLs, HTML disguised as an image, and oversized bodies',async()=>{
  for(const scenario of ['host','html','large']){
    let images=0;
    const service=new ArtworkService({fetchImpl:async url=>{
      if(String(url).startsWith('https://itunes.apple.com/'))return response([{...candidate,artworkUrl100:scenario==='host'?'http://127.0.0.1/private.png':candidate.artworkUrl100}]);
      if(!String(url).includes('mzstatic.com'))return Response.json({});
      images++;
      if(scenario==='html')return new Response('<html>bad</html>',{headers:{'content-type':'image/png'}});
      return new Response(png,{headers:{'content-type':'image/png','content-length':String(9*1024*1024)}});
    }});
    await assert.rejects(()=>service.lookup(song),/封面|图片/);
    if(scenario==='host')assert.equal(images,0);
  }
});

test('local cover gives same-name image priority over folder cover and rejects non-audio paths',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clear-cover-'));
  const audio=join(directory,'晴天.mp3');await writeFile(audio,'fixture');
  await writeFile(join(directory,'COVER.PNG'),png);
  const exact=await readFile(new URL('./fixtures/embedded-cover.png',import.meta.url));
  await writeFile(join(directory,'晴天.png'),exact);
  assert.deepEqual(Buffer.from((await findLocalArtwork(audio)).bytes),exact);
  assert.equal(await findLocalArtwork(join(directory,'晴天.png')),null);
  const other=join(directory,'另一首.mp3');await writeFile(other,'fixture');
  assert.deepEqual(Buffer.from((await findLocalArtwork(other)).bytes),png);
  await writeFile(join(directory,'另一首.png'),png);await truncate(join(directory,'另一首.png'),21*1024*1024);
  assert.deepEqual(Buffer.from((await findLocalArtwork(other)).bytes),png,'an oversized same-name file falls back to the valid folder cover');
});

test('artwork HTTP endpoint serves image bytes and protects the local origin boundary',async()=>{
  const artwork=new ArtworkService({fetchImpl:async url=>String(url).startsWith('https://itunes.apple.com/')?response([candidate]):new Response(png)});
  let handler;const server=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createApiHandler({},{origins:[origin],artwork});
  try{
    const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(song)};
    const result=await fetch(origin+'/api/artwork',options);
    assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
    const blocked=await fetch(origin+'/api/artwork',{...options,headers:{...options.headers,Origin:'https://untrusted.example'}});assert.equal(blocked.status,403);
    const uncertain=await fetch(origin+'/api/artwork',{...options,body:JSON.stringify({...song,artist:'未知歌手'})});assert.equal(uncertain.status,409);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
