import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {ArtworkService} from '../server/artwork.mjs';
import {createApiHandler} from '../server/api.mjs';
const png=await readFile(new URL('./fixtures/alternate-cover.png',import.meta.url));
const song={title:'晴天',artist:'周杰伦',album:'叶惠美',duration:269};
const apple={trackName:'晴天',artistName:'周杰伦',collectionName:'叶惠美',trackTimeMillis:269000,artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/Music/test/100x100bb.jpg'};
const empty=url=>Response.json(String(url).includes('itunes.apple.com')?{results:[]}:{});
const serviceFor=(items)=>new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:items}):empty(url)});

test('search falls back after a failed Apple region and exposes only opaque candidate IDs',async()=>{
  const regions=[];
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).includes('itunes.apple.com')){const region=new URL(url).searchParams.get('country');regions.push(region);if(region==='cn')throw new Error('unavailable');return Response.json({results:[apple]});}
    return new Response(png);
  }});
  const result=await service.search(song);
  assert.deepEqual(regions,['cn','hk']);assert.match(result.automatic,/^[a-f0-9]{32}$/);assert.ok(result.warnings.length);
  assert.equal(result.candidates[0].confidence,'high');assert.equal(JSON.stringify(result).includes('https://'),false);
  assert.deepEqual((await service.image(result.automatic)).bytes,png);
  await assert.rejects(()=>service.image('a'.repeat(32)),error=>error.status===404);
});

test('Apple falls back beyond Chinese regions when needed',async()=>{
  const regions=[];
  const service=new ArtworkService({fetchImpl:async url=>{if(String(url).includes('itunes.apple.com')){const region=new URL(url).searchParams.get('country');regions.push(region);return Response.json({results:region==='us'?[apple]:[]});}return empty(url);}});
  assert.ok((await service.search(song)).automatic);assert.ok(regions.includes('us'));
});

test('review candidates cover album/version/duration conflicts and unknown singers without automatic selection',async()=>{
  for(const [metadata,items] of [
    [song,[{...apple,collectionName:'演唱会'}]],
    [song,[{...apple,trackName:'晴天 (Live)'}]],
    [song,[{...apple,trackName:'晴天 (Remix)'}]],
    [song,[{...apple,trackName:'晴天 (翻唱)'}]],
    [song,[{...apple,trackTimeMillis:180000}]],
    [{...song,artist:'未知歌手'},[apple]],
  ]){
    const result=await serviceFor(items).search(metadata);
    assert.equal(result.automatic,null);assert.ok(result.candidates.length);assert.equal(result.candidates[0].confidence,'review');
  }
});

test('matching recognizes traditional tags, common English singer aliases and artist sets',async()=>{
  for(const [metadata,item] of [
    [song,{...apple,artistName:'Jay Chou (周杰倫)',collectionName:'葉惠美'}],
    [{title:'合唱',artist:'周杰伦 / 陈奕迅'},{...apple,trackName:'合唱',artistName:'Eason Chan & Jay Chou'}],
  ])assert.ok((await serviceFor([item]).search(metadata)).automatic);
  assert.equal((await serviceFor([{...apple,artistName:'周杰伦 / 陈奕迅'}]).search(song)).automatic,null,'extra lead singers require review');
});

test('NetEase and QQ official searches independently return album candidates when another source fails',async()=>{
  for(const source of ['网易云音乐','QQ 音乐']){
    const service=new ArtworkService({fetchImpl:async (url,options)=>{
      if(String(url).includes('itunes.apple.com'))throw new Error('Apple offline');
      if(String(url).includes('music.163.com')){
        if(source!=='网易云音乐')throw new Error('NetEase offline');
        assert.equal(options.method,'POST');return Response.json({code:200,result:{songs:[{name:'晴天',ar:[{name:'周杰伦'}],al:{name:'叶惠美',picUrl:'http://p1.music.126.net/cover.jpg'},dt:269000}]}});
      }
      if(String(url).includes('u.y.qq.com')){
        if(source!=='QQ 音乐')throw new Error('QQ offline');
        const payload=JSON.parse(options.body);assert.equal(payload.req.module,'music.search.SearchCgiService');assert.equal(payload.req.method,'DoSearchForQQMusicMobile');
        return Response.json({code:0,req:{code:0,data:{body:{item_song:[{name:'晴天',singer:[{name:'周杰伦'}],album:{name:'叶惠美',mid:'abc123'},interval:269}]}}}});
      }
      assert.ok(String(url).startsWith('https://'));return new Response(png);
    }});
    const result=await service.search(song);assert.ok(result.automatic);assert.equal(result.candidates.find(x=>x.id===result.automatic).source,source);
    assert.deepEqual((await service.image(result.automatic)).bytes,png);
  }
});

test('refresh bypasses a negative result and temporary source failures are not cached permanently',async()=>{
  let found=false;
  const service=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:found?[apple]:[]}):empty(url)});
  assert.equal((await service.search(song)).automatic,null);found=true;
  assert.equal((await service.search(song)).automatic,null,'negative cache avoids repeated searches');
  assert.ok((await service.search(song,undefined,{refresh:true})).automatic);
  let failed=true;
  const recovering=new ArtworkService({fetchImpl:async url=>{if(failed)throw new Error('offline');return String(url).includes('itunes.apple.com')?Response.json({results:[apple]}):empty(url);}});
  assert.equal((await recovering.search(song)).automatic,null);failed=false;assert.ok((await recovering.search(song)).automatic);
});

test('concurrent searches share a request and image previews retain signature, size and redirect checks',async()=>{
  let searches=0;
  const service=new ArtworkService({fetchImpl:async (url,options)=>{assert.equal(options.redirect,'error');if(String(url).includes('itunes.apple.com')){searches++;await new Promise(resolve=>setTimeout(resolve,15));return Response.json({results:[apple]});}return new Response('<html>bad</html>');}});
  const [a,b]=await Promise.all([service.search(song),service.search(song)]);assert.equal(a.automatic,b.automatic);assert.equal(searches,1);
  await assert.rejects(()=>service.image(a.automatic),/格式/);
  for(const bad of ['http://127.0.0.1/a.jpg','https://mzstatic.com.evil.test/a.jpg','https://is1-ssl.mzstatic.com:444/a.jpg']){
    const result=await serviceFor([{...apple,artworkUrl100:bad}]).search(song);
    assert.equal(result.automatic,null);assert.equal(result.candidates.length,0);assert.ok(result.warnings.length);
  }
  const redirected=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:[apple]}):new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
  const result=await redirected.search(song);await assert.rejects(()=>redirected.image(result.automatic),/封面/);
});

test('HTTP review responses, refresh and candidate previews enforce the local origin boundary',async()=>{
  const artwork=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:[{...apple,collectionName:'其他专辑'}]}):String(url).includes('mzstatic.com')?new Response(png):empty(url)});
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;handler=createApiHandler({},{origins:[origin],artwork});
  try{
    const result=await fetch(origin+'/api/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(song)});
    assert.equal(result.status,409);const data=await result.json();assert.ok(Array.isArray(data.warnings));assert.match(data.candidates[0].id,/^[a-f0-9]{32}$/);
    const path='/api/artwork/candidates/'+data.candidates[0].id;
    const image=await fetch(origin+path);assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
    assert.equal((await fetch(origin+path,{headers:{Origin:'https://evil.test'}})).status,403);
    assert.equal((await fetch(origin+'/api/artwork/candidates/'+'0'.repeat(32))).status,404);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('explicit HTTP review returns choices even with a high confidence match and supports non-ASCII source names',async()=>{
  const artwork=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:[apple]}):String(url).includes('mzstatic.com')?new Response(png):empty(url)});
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;handler=createApiHandler({},{origins:[origin],artwork});
  try{
    const result=await fetch(origin+'/api/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...song,review:true})});
    assert.equal(result.status,409);assert.equal((await result.json()).candidates[0].confidence,'high');
    artwork.image=async()=>({bytes:png,type:'image/png',source:'网易云音乐'});
    const image=await fetch(origin+'/api/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(song)});
    assert.equal(image.status,200);assert.equal(decodeURIComponent(image.headers.get('x-artwork-source')),'网易云音乐');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a full review list cannot hide a later high confidence result from another source',async()=>{
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).includes('itunes.apple.com')){
      const region=new URL(url).searchParams.get('country');
      return Response.json({results:['cn','hk'].includes(region)?Array.from({length:12},(_,index)=>({...apple,collectionName:'其他专辑',artworkUrl100:`https://is1-ssl.mzstatic.com/image/${region}/${index}/100x100bb.jpg`})) :[]});
    }
    if(String(url).includes('music.163.com'))return Response.json({code:200,result:{songs:[{name:'晴天',ar:[{name:'周杰伦'}],al:{name:'叶惠美',picUrl:'https://p1.music.126.net/right.jpg'},dt:269000}]}});
    return empty(url);
  }});
  const result=await service.search(song);assert.ok(result.automatic);assert.equal(result.candidates.find(candidate=>candidate.id===result.automatic).source,'网易云音乐');assert.ok(result.candidates.length<=24);
});

test('candidate IDs expire and bounded registries evict old candidates',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const service=new ArtworkService({fetchImpl:async url=>Response.json({results:[{...apple,trackName:new URL(url).searchParams.get('term').replace(/ 周杰伦$/,'')} ]})});
  const first=await service.search(song);
  t.mock.timers.tick(31*60000);await assert.rejects(()=>service.image(first.automatic),error=>error.status===404);
  const second=await service.search(song);assert.notEqual(second.automatic,first.automatic);
  for(let i=0;i<260;i++)await service.search({...song,title:`歌曲 ${i}`});
  await assert.rejects(()=>service.image(second.automatic),error=>error.status===404);
});

test('image cache evicts older bytes and oversized streaming images never reach the client',async()=>{
  let downloads=0;
  const large=Buffer.alloc(8*1024*1024);png.copy(large);
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).includes('itunes.apple.com')){const title=new URL(url).searchParams.get('term').replace(/ 周杰伦$/,'');return Response.json({results:[{...apple,trackName:title,artworkUrl100:`https://is1-ssl.mzstatic.com/image/${encodeURIComponent(title)}/100x100bb.jpg`}]});}
    downloads++;return new Response(large);
  }});
  let first;
  for(let i=0;i<5;i++){const result=await service.search({...song,title:`歌曲 ${i}`});first??=result.automatic;await service.image(result.automatic);}
  assert.equal(downloads,5);await service.image(first);assert.equal(downloads,6,'old image bytes were evicted instead of retaining every cover');
  const streaming=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:[apple]}):new Response(new ReadableStream({start(controller){controller.enqueue(large);controller.enqueue(png);controller.close();}}))});
  const result=await streaming.search(song);await assert.rejects(()=>streaming.image(result.automatic),/过大/);
});

test('distinct concurrent songs use bounded search concurrency',async()=>{
  let active=0,peak=0;
  const service=new ArtworkService({fetchImpl:async url=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;const title=new URL(url).searchParams.get('term').replace(/ 周杰伦$/,'');return Response.json({results:[{...apple,trackName:title}]});}});
  const results=await Promise.all(Array.from({length:6},(_,index)=>service.search({...song,title:`歌曲 ${index}`})));
  assert.ok(results.every(result=>result.automatic));assert.ok(peak<=2);
});

test('HTTP refresh true bypasses the cached negative lookup',async()=>{
  let found=false;
  const artwork=new ArtworkService({fetchImpl:async url=>String(url).includes('itunes.apple.com')?Response.json({results:found?[apple]:[]}):String(url).includes('mzstatic.com')?new Response(png):empty(url)});
  let handler;const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;handler=createApiHandler({},{origins:[origin],artwork});
  const post=metadata=>fetch(origin+'/api/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)});
  try{
    assert.equal((await post(song)).status,404);found=true;
    assert.equal((await post(song)).status,404);
    const recovered=await post({...song,refresh:true});assert.equal(recovered.status,200);assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),png);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('six distinct candidate previews queue behind four downloads and same URLs stay deduplicated',async()=>{
  let active=0,peak=0,downloads=0;
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).includes('itunes.apple.com'))return Response.json({results:Array.from({length:6},(_,i)=>({...apple,artworkUrl100:`https://is1-ssl.mzstatic.com/image/${i}/100x100bb.jpg`}))});
    downloads++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return new Response(png);
  }});
  const {candidates}=await service.search(song);
  const results=await Promise.allSettled([...candidates.map(candidate=>service.image(candidate.id)),service.image(candidates[0].id)]);
  assert.ok(results.every(result=>result.status==='fulfilled'),'normal preview requests must wait instead of failing when four images are active');
  assert.equal(downloads,6);assert.equal(peak,4);
});

test('cancelled queued images leave the queue without consuming a download slot',async()=>{
  const started=[],release=[];
  const service=new ArtworkService({fetchImpl:async url=>{
    if(String(url).includes('itunes.apple.com'))return Response.json({results:Array.from({length:6},(_,i)=>({...apple,artworkUrl100:`https://is1-ssl.mzstatic.com/image/${i}/100x100bb.jpg`}))});
    started.push(String(url));if(started.length<=4)await new Promise(resolve=>release.push(resolve));return new Response(png);
  }});
  const {candidates}=await service.search(song),controller=new AbortController();
  const first=candidates.slice(0,4).map(candidate=>service.image(candidate.id));
  const cancelled=service.image(candidates[4].id,controller.signal),cancelledCheck=assert.rejects(cancelled,/cancel preview/);
  const last=service.image(candidates[5].id),lastCheck=Promise.allSettled([last]);
  controller.abort(new Error('cancel preview'));await cancelledCheck;
  release.forEach(resolve=>resolve());await Promise.all(first);
  assert.equal((await lastCheck)[0].status,'fulfilled');assert.equal(started.length,5);assert.equal(started.some(url=>url.includes('/image/4/')),false);
  assert.deepEqual((await service.image(candidates[4].id)).bytes,png,'the cancelled URL can be retried');
});

test('image waiting and download share a deadline and expired queued requests are cleared',async t=>{
  const service=new ArtworkService({fetchImpl:async (url,{signal})=>{
    if(String(url).includes('itunes.apple.com'))return Response.json({results:Array.from({length:6},(_,i)=>({...apple,artworkUrl100:`https://is1-ssl.mzstatic.com/image/${i}/100x100bb.jpg`}))});
    await new Promise((resolve,reject)=>{signal.throwIfAborted();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  }});
  const {candidates}=await service.search(song),timeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',()=>timeout(25));
  const keepAlive=setTimeout(()=>{},200);
  try{
    const results=await Promise.allSettled(candidates.map(candidate=>service.image(candidate.id)));
    assert.ok(results.every(result=>result.status==='rejected' && result.reason.name==='TimeoutError'));
    assert.equal(service.imageWaiters.length,0);assert.equal(service.imageActive,0);assert.equal(service.imagePending.size,0);
  }finally{clearTimeout(keepAlive);}
});

test('shared searches let one caller cancel while another independent caller succeeds',async()=>{
  let searches=0,started;const begun=new Promise(resolve=>started=resolve);
  const service=new ArtworkService({fetchImpl:async (url,{signal})=>{
    searches++;started();await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
    return Response.json({results:[apple]});
  }});
  const first=new AbortController(),second=new AbortController();
  const a=service.search(song,first.signal),b=service.search(song,second.signal),rejected=assert.rejects(a,/first cancelled/);
  await begun;first.abort(new Error('first cancelled'));await rejected;
  assert.ok((await b).automatic);assert.equal(searches,1);
});

test('cancelling every shared search subscriber aborts its transport and leaves retries usable',async()=>{
  let searches=0,aborted=0,started;
  const begun=new Promise(resolve=>started=resolve);
  const service=new ArtworkService({fetchImpl:async (url,{signal})=>{
    searches++;
    if(searches===1){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));}
    return Response.json({results:[apple]});
  }});
  const first=new AbortController(),second=new AbortController();
  const a=service.search(song,first.signal),b=service.search(song,second.signal),settled=Promise.allSettled([a,b]);
  await begun;first.abort(new Error('first cancelled'));assert.equal(aborted,0,'the remaining subscriber still needs the transport');second.abort(new Error('second cancelled'));
  assert.ok((await settled).every(result=>result.status==='rejected'));assert.equal(aborted,1);
  assert.ok((await service.search(song)).automatic);assert.equal(searches,2);
});

test('cancelling a preview does not cancel another caller applying the same image',async()=>{
  let downloads=0,started;const begun=new Promise(resolve=>started=resolve);
  const service=new ArtworkService({fetchImpl:async (url,{signal})=>{
    if(String(url).includes('itunes.apple.com'))return Response.json({results:[apple]});
    downloads++;started();await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});return new Response(png);
  }});
  const {automatic}=await service.search(song),preview=new AbortController(),applying=new AbortController();
  const a=service.image(automatic,preview.signal),b=service.image(automatic,applying.signal),rejected=assert.rejects(a,/preview cancelled/);
  await begun;preview.abort(new Error('preview cancelled'));await rejected;
  assert.deepEqual((await b).bytes,png);assert.equal(downloads,1);assert.deepEqual((await service.image(automatic)).bytes,png);assert.equal(downloads,1);
});

test('cancelling all image subscribers aborts the download and does not poison its retry',async()=>{
  let downloads=0,aborted=0,started;
  const begun=new Promise(resolve=>started=resolve);
  const service=new ArtworkService({fetchImpl:async (url,{signal})=>{
    if(String(url).includes('itunes.apple.com'))return Response.json({results:[apple]});
    downloads++;if(downloads===1){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));}return new Response(png);
  }});
  const {automatic}=await service.search(song),first=new AbortController(),second=new AbortController();
  const a=service.image(automatic,first.signal),b=service.image(automatic,second.signal),settled=Promise.allSettled([a,b]);
  await begun;first.abort();assert.equal(aborted,0);second.abort();assert.ok((await settled).every(result=>result.status==='rejected'));assert.equal(aborted,1);
  assert.deepEqual((await service.image(automatic)).bytes,png);assert.equal(downloads,2);assert.equal(service.imageBytes,png.length);
});
