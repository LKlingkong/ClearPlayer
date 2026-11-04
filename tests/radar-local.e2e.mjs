import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {DiscoveryService} from '../server/discovery.mjs';
import {createApiHandler} from '../server/api.mjs';
import {createDesktopProtocol} from '../desktop/protocol.mjs';
import {readTrack} from '../src/lib/library.ts';

test('real local MP3 without online IDs reaches actual recommendation API and returns cross-artist new songs',{timeout:60000},async()=>{
 const audio=await readFile('tests/fixtures/微风.mp3'),expected=await readTrack(new File([audio],'微风.mp3',{type:'audio/mpeg'}));
 let edition=1,fail=false,searches=0;const requests=[];
 const raw=(id,title,artist)=>({id,name:title,artists:[{name:artist}],album:{name:'相近曲风'},duration:expected.duration*1000});
 const discovery=new DiscoveryService({qqSearch:async()=>[],json:async url=>{
  if(fail)return {code:500};const u=new URL(url);
  if(u.pathname.endsWith('search/get')&&u.searchParams.get('type')==='1'){
   searches++;return {code:200,result:{songs:u.searchParams.get('s').startsWith(expected.title+' ')?[raw(1,expected.title,expected.artist)]:[]}};
  }
  if(url.includes('simiSong'))return {code:200,songs:edition===0?[raw(1,expected.title,expected.artist)]:Array.from({length:45},(_,i)=>raw(1000*edition+i,`曲风新歌${edition}-${i}`,`不同歌手${i}`))};
  return {code:200,playlists:[],result:{playlists:[],songs:[]}};
 }});
 const candidates=discovery.candidates.bind(discovery);discovery.candidates=(seeds,tags,signal,options)=>{requests.push({seeds,options});return candidates(seeds,tags,signal,options);};
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const api=createApiHandler({sources:()=>[],list:()=>[]},{origins:[origin],discovery});const staticHandler=createDesktopProtocol({dist:resolve('dist'),apiOrigin:origin});
 server.on('request',async(req,res)=>{try{if(await api(req,res))return;const response=await staticHandler(new Request('clear://player'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(e.message);}});
 const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('clear:auto-artwork','false'));
 const button=name=>page.getByRole('button',{name,exact:true});
 try{
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/微风.mp3');await page.getByRole('heading',{name:expected.title,exact:true}).waitFor();
  await page.evaluate(async()=>{
   const db=await new Promise(r=>{const q=indexedDB.open('clear-music-library');q.onsuccess=()=>r(q.result);});
   const original=await new Promise(r=>{const q=db.transaction('tracks').objectStore('tracks').getAll();q.onsuccess=()=>r(q.result[0]);});
   await new Promise((r,j)=>{const tx=db.transaction('tracks','readwrite');tx.oncomplete=r;tx.onerror=j;const store=tx.objectStore('tracks');store.put({...original,favorite:true});for(let i=0;i<29;i++)store.put({...original,id:'existing-'+i,title:'已有歌曲'+i,artist:'已有歌手'+i,addedAt:i+1,favorite:false});});db.close();
  });
  await page.reload();await button('个人雷达').click();await button('生成今日雷达').click();await page.waitForFunction(()=>document.querySelectorAll('.radar-song').length===30);
  assert.equal(await page.getByText('新发现',{exact:true}).count(),21);assert.equal(await page.getByText('曲库重逢',{exact:true}).count(),9);
  assert.ok(requests[0].seeds.every(s=>!s.onlineId&&!s.onlineSource));assert.ok(searches>0);
  edition=0;await button('换一批').click();await page.getByText('本轮没有找到可补充的新歌，保留上次完整雷达结果',{exact:false}).waitFor();const emptyBatch=requests.at(-1).options.batch;
  const before=searches;edition=2;await button('换一批').click();await page.getByText('曲风新歌2-',{exact:false}).first().waitFor();assert.ok(searches>before);assert.equal(requests.at(-1).options.refresh,true);assert.equal(requests.at(-1).options.batch,emptyBatch+1);
  fail=true;await button('换一批').click();await page.getByText('网络暂不可用，保留上次雷达结果',{exact:false}).waitFor();assert.equal(await page.getByText('新发现',{exact:true}).count(),21);fail=false;
  // A v1.0.1 library-only snapshot is recovered once on entry; no profile clearing is needed.
  await page.evaluate(async()=>{
   const db=await new Promise(r=>{const q=indexedDB.open('clear-music-library');q.onsuccess=()=>r(q.result);});
   const state=await new Promise(r=>{const q=db.transaction('discovery').objectStore('discovery').get('personal');q.onsuccess=()=>r(q.result);});
   const tracks=await new Promise(r=>{const q=db.transaction('tracks').objectStore('tracks').getAll();q.onsuccess=()=>r(q.result);});
   const date=new Date(),day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
   state.radar={day,batch:0,songs:tracks.slice(0,9).map(t=>({id:t.id,localId:t.id,source:'local',title:t.title,artist:t.artist,album:t.album,duration:t.duration,reason:'曲库重听'})),warnings:[],generatedAt:Date.now(),exploration:70};
   await new Promise((r,j)=>{const tx=db.transaction('discovery','readwrite');tx.oncomplete=r;tx.onerror=j;tx.objectStore('discovery').put(state,'personal');});db.close();
  });
  edition=3;const beforeRecovery=requests.length;await page.reload();await button('个人雷达').click();await page.getByText('曲风新歌3-',{exact:false}).first().waitFor();assert.equal(requests.length,beforeRecovery+1);assert.equal(await page.getByText('新发现',{exact:true}).count(),21);assert.deepEqual(errors,[]);
  console.log('LOCAL_MP3_REAL_API_RADAR_OK: 21 new / 9 existing, cross-artist discovery, refresh, outage retention, legacy recovery');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
