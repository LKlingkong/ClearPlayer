import {_electron} from '@playwright/test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdir,mkdtemp,copyFile,readFile} from 'node:fs/promises';

await mkdir('.verification',{recursive:true});await mkdir('screenshots',{recursive:true});
const profile=await mkdtemp(resolve('.verification/golden-profile-'));
const imports=await mkdtemp(resolve('.verification/cover-import-'));
await copyFile('tests/fixtures/微风.mp3',join(imports,'本地封面.mp3'));
await copyFile('tests/fixtures/alternate-cover.png',join(imports,'本地封面.png'));
const env={...process.env,CLEAR_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:resolve('desktop-app/澄音播放器.exe'),env,timeout:30000});
const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const png=(await readFile('tests/fixtures/embedded-cover.png')).toString('base64');
try{
  await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
  await page.addInitScript(({png})=>{
    const original=window.fetch;
    window.coverLookups=[];
    window.fetch=async(input,options)=>{
      if(String(input)==='/api/artwork'){
        const info=JSON.parse(options.body);window.coverLookups.push(info.title);
        await new Promise(resolve=>setTimeout(resolve,info.title==='迟来的封面'?1400:150));
        const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
        return new Response(bytes,{headers:{'Content-Type':'image/png'}});
      }
      return original(input,options);
    };
  },{png});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
  await page.locator('input[type=file]').first().setInputFiles(join(imports,'本地封面.mp3'));
  await page.waitForFunction(()=>document.querySelectorAll('.track-row').length===1);
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===128);
  assert.equal(await page.evaluate(()=>window.coverLookups.length),0,'same-folder native art must be found before networking');
  const bytes=[...await readFile('tests/fixtures/微风.mp3')];
  await page.evaluate(async bytes=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('clear-music-library',2);r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{const tx=db.transaction('tracks','readwrite');tx.oncomplete=resolve;for(const [id,title]of[['auto','晴天'],['race','迟来的封面'],['removed','移除中的封面']])tx.objectStore('tracks').put({id,title,artist:'周杰伦',album:'叶惠美',file:new File([new Uint8Array(bytes)],`${title}.mp3`,{type:'audio/mpeg'}),duration:24,favorite:false,addedAt:Date.now(),lyrics:'[00:00]雨后的光 落在唱片上\n[00:05]听见生活 慢慢回响\n[00:10]每一段旋律 都有温度\n[00:15]让这一刻 留在这里'});});db.close();
  },bytes);
  await page.reload();await page.getByRole('button',{name:'播放 晴天',exact:true}).click();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  const moving=await page.locator('.atmosphere-artwork').evaluate(el=>({animation:getComputedStyle(el).animationName,state:getComputedStyle(el).animationPlayState}));
  assert.equal(moving.state,'running');assert.notEqual(moving.animation,'none');
  const one=await page.locator('.atmosphere-artwork').evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(450);const two=await page.locator('.atmosphere-artwork').evaluate(el=>getComputedStyle(el).transform);assert.notEqual(one,two);
  const beforeHide=await page.locator('audio').evaluate(a=>a.currentTime);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await page.waitForFunction(()=>document.querySelector('.vinyl-player').dataset.moving==='false',null,{timeout:1500});
  await page.waitForTimeout(250);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  assert.ok(await page.locator('audio').evaluate(a=>a.currentTime)>beforeHide,'tray playback keeps advancing while visuals pause');
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();});
  await page.waitForFunction(()=>document.querySelector('.vinyl-player').dataset.moving==='true');
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.atmosphere-artwork')).animationPlayState==='paused');
  assert.equal(await page.locator('.atmosphere-artwork').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.atmosphere-artwork').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.screenshot({path:'screenshots/golden-vinyl.png'});
  await page.getByRole('button',{name:'歌词舞台',exact:true}).click();
  await page.screenshot({path:'screenshots/golden-stage.png'});
  await page.getByRole('button',{name:'黑胶唱片',exact:true}).click();
  for(const theme of ['light','stage']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.screenshot({path:`screenshots/golden-vinyl-${theme}.png`});
  }
  await page.reload();await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  assert.equal(await page.evaluate(()=>window.coverLookups.length),0,'saved cover must survive reopening without another request');
  await page.getByRole('button',{name:'返回曲库'}).click();
  await page.getByRole('button',{name:'播放 迟来的封面',exact:true}).click();
  await page.waitForFunction(()=>window.coverLookups.includes('迟来的封面'));
  await page.locator('input[accept=".jpg,.jpeg,.png,.webp"]').setInputFiles('tests/fixtures/alternate-cover.png');
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.vinyl-label img').evaluate(img=>img.naturalWidth),128,'late online cover must never overwrite a manual replacement');
  await page.getByRole('button',{name:'播放设置',exact:true}).click();
  await page.getByRole('checkbox',{name:'自动联网补全封面'}).uncheck();
  await page.getByRole('button',{name:'关闭播放设置'}).click();
  await page.getByRole('button',{name:'返回曲库'}).click();
  await page.getByRole('button',{name:'播放 移除中的封面',exact:true}).click();
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.coverLookups.includes('移除中的封面')),false);
  await page.reload();await page.getByRole('button',{name:'播放设置',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'自动联网补全封面'}).isChecked(),false);
  await page.getByRole('checkbox',{name:'自动联网补全封面'}).check();
  await page.getByRole('button',{name:'关闭播放设置'}).click();
  await page.waitForFunction(()=>window.coverLookups.includes('移除中的封面'));
  await page.getByRole('button',{name:'移除 移除中的封面',exact:true}).click();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole('button',{name:'播放 移除中的封面',exact:true}).count(),0,'late artwork must not restore a removed song');
  await page.reload();await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);assert.equal(await page.getByRole('button',{name:'播放 移除中的封面',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: native sibling cover, automatic cover/persistence, manual race, uninterrupted audio, moving/paused/reduced-motion atmosphere, saved network preference');
}finally{await app.close();}
