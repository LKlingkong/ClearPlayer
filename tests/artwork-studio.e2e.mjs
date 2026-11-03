import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

await mkdir('screenshots',{recursive:true});
const root=resolve('dist'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root))throw Error();res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
const ids=['a'.repeat(32),'b'.repeat(32)],requests=[];
const png=await readFile('tests/fixtures/embedded-cover.png');
let delayedResolve,delayNext=false,delayCandidate=false,releaseCandidate;
const routeApi=async route=>{
  const url=new URL(route.request().url());
  try{
    if(url.pathname==='/api/sources')return await route.fulfill({json:{sources:[]}});
    if(url.pathname==='/api/downloads')return await route.fulfill({json:{jobs:[]}});
    if(url.pathname.startsWith('/api/artwork/candidates/')){if(delayCandidate&&route.request().resourceType()!=='image'){delayCandidate=false;await new Promise(resolve=>releaseCandidate=resolve);}return await route.fulfill({body:png,contentType:'image/png',headers:{'X-Artwork-Source':encodeURIComponent('网易云音乐')}});}
    if(url.pathname==='/api/artwork'){
      const query=route.request().postDataJSON();requests.push(query);
      if(delayNext){delayNext=false;await new Promise(resolve=>delayedResolve=resolve);}
      if(query.title==='准确匹配'&&!query.review)return await route.fulfill({body:png,contentType:'image/png',headers:{'X-Artwork-Source':encodeURIComponent('QQ 音乐')}});
      if(query.title==='无法匹配')return await route.fulfill({status:404,json:{error:'没有匹配封面'}});
      return await route.fulfill({status:409,json:{candidates:ids.map((id,i)=>({id,title:query.title,artist:'测试歌手',album:i?'另一版本':'候选专辑',source:'网易云音乐',confidence:'review'})),warnings:[]}});
    }
    await route.fulfill({status:404,json:{error:'not found'}});
  }catch{/* A cancelled batch legitimately cancels its fixture request too. */}
};
await page.route('**/api/**',routeApi);
try{
  await page.addInitScript(()=>localStorage.setItem('clear:auto-artwork','false'));
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
  const audio=[...await readFile('tests/fixtures/微风.mp3')];
  await page.evaluate(async bytes=>{
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=600;const c=canvas.getContext('2d');c.fillStyle='#000';c.fillRect(0,0,600,600);c.fillStyle='#467e83';c.fillRect(75,0,450,600);c.fillStyle='#d5b87c';c.fillRect(200,180,100,200);
    const artwork=await new Promise(resolve=>canvas.toBlob(resolve));
    const db=await new Promise(resolve=>{const r=indexedDB.open('clear-music-library');r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('tracks','readwrite');tx.oncomplete=resolve;for(const [i,title] of ['已有封面','准确匹配','待确认曲目','无法匹配'].entries())tx.objectStore('tracks').put({id:`studio-${i}`,title,artist:'测试歌手',album:'专辑',file:new File([new Uint8Array(bytes)],`${title}.mp3`,{type:'audio/mpeg'}),artwork:i===0?artwork:undefined,artworkSource:'embedded',duration:24,favorite:false,addedAt:i});});db.close();
  },audio);
  await page.reload();await page.getByRole('heading',{name:'已有封面',exact:true}).waitFor();
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===450);
  const resource=await page.locator('audio').getAttribute('src');
  await page.getByRole('button',{name:'封面与构图',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'封面工作室'});await dialog.waitFor();
  await page.getByRole('slider',{name:'封面缩放'}).fill('1.3');await page.getByRole('slider',{name:'封面水平位置'}).fill('20');
  await page.getByRole('button',{name:'保存构图',exact:true}).click();
  await page.getByRole('button',{name:'关闭封面工作室'}).click();
  assert.equal(await page.locator('audio').getAttribute('src'),resource);assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  assert.equal(await page.locator('.vinyl-label img').evaluate(img=>img.style.transform),'scale(1.3)');
  await page.getByRole('button',{name:'封面与构图',exact:true}).click();
  await page.getByRole('checkbox',{name:'自动去除纯色留边'}).uncheck();
  await page.waitForFunction(()=>document.querySelector('.artwork-crop-preview img')?.naturalWidth===600);
  await page.getByRole('checkbox',{name:'自动去除纯色留边'}).check();
  await page.getByRole('button',{name:'补齐曲库封面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.batch-summary')?.textContent.includes('本轮已完成'));
  const summary=await page.locator('.batch-summary').textContent();assert.match(summary,/3 \/ 3/);assert.match(summary,/已补齐 1/);assert.match(summary,/待确认 1/);assert.match(summary,/未匹配 1/);
  assert.equal(requests.some(query=>query.title==='已有封面'),false,'batch must skip existing covers');
  await page.getByRole('button',{name:/待确认曲目.*选择候选封面/}).click();
  await page.getByRole('button',{name:'选择封面 候选专辑 网易云音乐'}).click();await page.getByRole('button',{name:'使用这张封面'}).click();
  await page.getByText('这张封面已应用并保存在本机',{exact:true}).waitFor();
  assert.equal(await page.locator('audio').getAttribute('src'),resource);
  await page.getByRole('button',{name:'查找封面',exact:true}).click();
  await page.getByRole('group',{name:'候选封面'}).waitFor();assert.equal(requests.at(-1).review,true);assert.equal(requests.at(-1).refresh,true);
  await page.screenshot({path:'screenshots/artwork-studio.png'});
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.locator('.vinyl-player').isVisible(),true,'Escape dismisses studio without leaving playback');
  await page.reload();await page.getByRole('heading',{name:'已有封面',exact:true}).waitFor();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===450);
  assert.equal(await page.locator('.vinyl-label img').evaluate(img=>img.style.transform),'scale(1.3)','composition persists across reload');
  await page.getByRole('button',{name:'封面与构图',exact:true}).click();delayNext=true;
  await page.getByRole('button',{name:'补齐曲库封面',exact:true}).click();
  for(let i=0;i<100&&!delayedResolve;i++)await page.waitForTimeout(10);assert.ok(delayedResolve);
  await page.getByRole('button',{name:'停止补齐'}).click();delayedResolve();
  await page.waitForFunction(()=>document.querySelector('.batch-summary')?.textContent.includes('已停止'));
  await page.getByRole('button',{name:'关闭封面工作室'}).click();
  await page.getByRole('button',{name:'封面与构图',exact:true}).click();
  await page.getByRole('button',{name:'查找封面',exact:true}).click();
  await page.getByRole('button',{name:'选择封面 候选专辑 网易云音乐'}).click();delayCandidate=true;
  await page.getByRole('button',{name:'使用这张封面'}).click();
  for(let i=0;i<100&&!releaseCandidate;i++)await page.waitForTimeout(10);assert.ok(releaseCandidate);
  await page.locator('input[accept=".jpg,.jpeg,.png,.webp"]').setInputFiles('tests/fixtures/alternate-cover.png');
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===128);releaseCandidate();
  await page.getByText('封面已发生变化，请重新确认选择',{exact:true}).waitFor();
  assert.equal(await page.locator('.vinyl-label img').evaluate(img=>img.naturalWidth),128,'late chosen candidate must not replace a newer manual image');
  await page.getByRole('button',{name:'关闭封面工作室'}).click();
  await page.getByRole('button',{name:'返回曲库'}).click();
  assert.equal(await page.getByRole('button',{name:'补齐封面',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  const seed=async target=>{
    await target.goto(origin);await target.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
    await target.evaluate(async bytes=>{const db=await new Promise(resolve=>{const r=indexedDB.open('clear-music-library');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('tracks','readwrite');tx.oncomplete=resolve;tx.objectStore('tracks').put({id:'automatic',title:'准确匹配',artist:'测试歌手',album:'专辑',file:new File([new Uint8Array(bytes)],'准确匹配.mp3',{type:'audio/mpeg'}),duration:24,favorite:false,addedAt:0});});db.close();},audio);
  };
  const automatic=await browser.newPage();await automatic.route('**/api/**',routeApi);await seed(automatic);await automatic.reload();
  await automatic.getByRole('heading',{name:'准确匹配',exact:true}).waitFor();await automatic.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await automatic.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  await automatic.getByRole('button',{name:'封面与构图',exact:true}).click();
  await automatic.waitForFunction(()=>!document.querySelector('.cover-query button')?.disabled);
  assert.equal(await automatic.getByText('正在比对歌曲与专辑信息…',{exact:true}).count(),0,'automatic completion must clear loading even when artwork effect aborts its own request');await automatic.close();
  const failed=await browser.newPage();await failed.route('**/api/**',routeApi);await seed(failed);
  await failed.addInitScript(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value?.artwork)throw new DOMException('test storage full','QuotaExceededError');return put.call(this,value,...args);};});
  await failed.reload();await failed.getByRole('heading',{name:'准确匹配',exact:true}).waitFor();await failed.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await failed.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  await failed.getByRole('button',{name:'封面与构图',exact:true}).click();
  await failed.getByText('封面没有保存成功，请检查存储空间后重试',{exact:true}).waitFor();await failed.close();
  console.log('PASS: padded covers fill the centre, saved crop and original toggle, safe whole-library completion, candidate choice, retry, cancellation and continuous audio');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
