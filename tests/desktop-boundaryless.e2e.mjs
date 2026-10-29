import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
await mkdir('.verification',{recursive:true});
const profile=await mkdtemp(resolve('.verification/boundaryless-profile-'));
const env={...process.env,CLEAR_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const desktop=await _electron.launch({executablePath:resolve('desktop-app/澄音播放器.exe'),env,timeout:30000});
const page=await desktop.firstWindow();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
  const audio=[...await readFile('tests/fixtures/微风.mp3')];
  await page.evaluate(async bytes=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clear-music-library',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('tracks','readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      for(let i=1;i<=60;i++)tx.objectStore('tracks').put({id:`long-${i}`,title:`歌曲 ${String(i).padStart(2,'0')}`,artist:'曲库滚动验证',album:'完整收藏',file:new File([new Uint8Array(bytes)],`歌曲${i}.mp3`,{type:'audio/mpeg'}),duration:24,favorite:false,addedAt:i});
    });db.close();
  },audio);
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.track-row').length===60);
  for(const [width,height] of [[1440,1000],[1100,700],[800,600]]) {
    await desktop.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
    await page.waitForTimeout(150);
    const scrollArea=await page.locator('.page-content').boundingBox();
    await page.mouse.move(scrollArea.x+Math.min(200,scrollArea.width/2),scrollArea.y+Math.min(100,scrollArea.height/2));
    await page.mouse.wheel(0,100000);
    await page.waitForTimeout(250);
    const geometry=await page.locator('.track-row').last().evaluate(el=>{
      const row=el.getBoundingClientRect(),dock=document.querySelector('.player-bar').getBoundingClientRect();
      return {top:row.top,bottom:row.bottom,dockTop:dock.top,height:innerHeight,scroll:document.scrollingElement.scrollTop};
    });
    assert.ok(geometry.top>=0 && geometry.bottom<=geometry.dockTop-4,`窗口 ${width}x${height} 的最后一首被遮挡：${JSON.stringify(geometry)}`);
    await page.getByRole('button',{name:'播放 歌曲 60',exact:true}).click();
    await page.getByRole('heading',{name:'歌曲 60',exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'播放队列',exact:true}).click();
  const queue=await page.locator('.queue-list').boundingBox();
  await page.mouse.move(queue.x+queue.width/2,queue.y+Math.min(80,queue.height/2));
  await page.mouse.wheel(0,100000);await page.waitForTimeout(200);
  assert.ok(await page.locator('.queue-list>button').last().evaluate(el=>{const row=el.getBoundingClientRect(),box=el.parentElement.getBoundingClientRect();return row.top>=box.top&&row.bottom<=box.bottom;}),'播放队列最后一首应完整可见');
  await page.locator('.queue-list>button').last().click();
  await page.getByRole('button',{name:'关闭播放队列'}).click();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));
  await page.screenshot({path:'screenshots/boundaryless-library.png'});
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/专辑封面.mp3');
  await page.getByRole('button',{name:'播放 封面之歌',exact:true}).click();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  const cover=page.locator('.vinyl-label img');
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  const source=await cover.getAttribute('src');assert.ok(source.startsWith('blob:'));
  const embedded=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('clear-music-library',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const track=await new Promise(resolve=>{const r=db.transaction('tracks').objectStore('tracks').get(JSON.parse(localStorage.getItem('clear:current')));r.onsuccess=()=>resolve(r.result);});
    db.close();return [...new Uint8Array(await track.artwork.arrayBuffer())];
  });
  const hash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(hash(Buffer.from(embedded)),hash(await readFile('tests/fixtures/embedded-cover.png')));
  assert.equal(await page.getByRole('button',{name:'更换专辑封面',exact:true}).count(),1);
  const before=await page.locator('audio').evaluate(a=>a.currentTime);
  await page.locator('input[accept=".jpg,.jpeg,.png,.webp"]').setInputFiles('tests/fixtures/alternate-cover.png');
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===128);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  assert.ok(await page.locator('audio').evaluate(a=>a.currentTime)>=before);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:'screenshots/boundaryless-vinyl.png'});
  await page.getByRole('button',{name:'最小化窗口',exact:true}).click();
  await desktop.evaluate(async({BrowserWindow})=>{for(let i=0;i<30;i++){if(BrowserWindow.getAllWindows()[0].isMinimized())return;await new Promise(r=>setTimeout(r,100));}throw new Error('未最小化');});
  const launcher=spawn(resolve('ClearPlayer.exe'),[],{env,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{launcher.on('exit',resolve);launcher.on('error',reject);});
  await page.waitForTimeout(350);
  await page.getByRole('button',{name:'关闭到托盘',exact:true}).click();
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: 60 首曲库在三种窗口尺寸滚动到末尾并播放，内嵌与自选专辑封面，更新封面不断音，无边界窗口控件');
} finally {await desktop.close();}
