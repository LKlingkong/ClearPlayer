import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage();
await page.route('**/api/**',r=>r.fulfill({json:r.request().url().endsWith('/downloads')?{jobs:[]}:{sources:[]}}));
try{
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
 const bytes=Array.from(await readFile('tests/fixtures/微风.mp3'));
 await page.evaluate(async bytes=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('clear-music-library');r.onsuccess=resolve;r.onerror=reject;});
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clear-music-library',2);r.onupgradeneeded=()=>{r.result.createObjectStore('tracks',{keyPath:'id'});r.result.createObjectStore('downloadImports');};r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','downloadImports'],'readwrite');tx.oncomplete=resolve;tx.onerror=reject;tx.objectStore('tracks').put({id:'legacy-v2',file:new File([new Uint8Array(bytes)],'旧曲库.mp3',{type:'audio/mpeg'}),title:'旧曲库',artist:'旧歌手',album:'原有专辑',duration:20,favorite:true,addedAt:12,lyrics:'[00:01]原有歌词',artwork:new Blob(['original-cover'],{type:'image/png'}),artworkFit:{zoom:1.2,x:10,y:20}});tx.objectStore('downloadImports').put(true,'old-receipt');});db.close();
 },bytes);
 await page.reload();await page.getByRole('button',{name:'播放 旧曲库',exact:true}).waitFor();await page.getByRole('button',{name:'导入歌单',exact:true}).waitFor();
 const migrated=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('clear-music-library');q.onsuccess=()=>r(q.result);});const result=await new Promise(r=>{const q=db.transaction('tracks').objectStore('tracks').get('legacy-v2');q.onsuccess=()=>r(q.result);});const receipt=await new Promise(r=>{const q=db.transaction('downloadImports').objectStore('downloadImports').get('old-receipt');q.onsuccess=()=>r(q.result);});const out={version:db.version,hasDiscovery:db.objectStoreNames.contains('discovery'),favorite:result.favorite,lyrics:result.lyrics,artwork:await result.artwork.text(),fit:result.artworkFit,size:result.file.size,receipt};db.close();return out;});
 assert.equal(migrated.version,3);assert.ok(migrated.hasDiscovery);assert.ok(migrated.favorite);assert.equal(migrated.lyrics,'[00:01]原有歌词');assert.equal(migrated.artwork,'original-cover');assert.deepEqual(migrated.fit,{zoom:1.2,x:10,y:20});assert.equal(migrated.size,bytes.length);assert.ok(migrated.receipt);
 console.log('DISCOVERY_V2_MIGRATION_OK');
}finally{await browser.close();}
