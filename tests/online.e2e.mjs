import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Only the remote service boundary is replaced; playback, files and IndexedDB stay real.
const browser = await chromium.launch({headless:true, channel:'msedge'});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const audio = await readFile('tests/fixtures/微风.mp3');
const song = {key:'fixture:one',source:'fixture',id:'one',title:'海边来信',artist:'海岸乐队',album:'潮汐',duration:12,format:'mp3'};
let jobs = [];
let searches = 0;
let audioReads = 0;
let failSearch = false;
let delayAudio;
let audioRequestStarted;
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url());
  const reply = data => route.fulfill({json:data});
  if (url.pathname === '/api/sources') return reply({sources:[{id:'fixture',name:'测试音源'}]});
  if (url.pathname === '/api/search') {
    searches++;
    if (searches === 1) assert.equal(url.searchParams.get('source'),'fixture');
    if (failSearch) return route.fulfill({status:502,json:{error:'音源暂时无法连接，请稍后重试'}});
    return reply({songs:url.searchParams.get('q') === '空' ? [] : [song],warnings:[{source:'other',message:'另一音源暂不可用'}]});
  }
  if (url.pathname === '/api/downloads' && req.method() === 'POST') {
    assert.deepEqual(req.postDataJSON(),{key:song.key,lyrics:true});
    const job = {id:'job-one',song,status:'downloading',received:512,total:1024,filename:'海边来信.mp3',hasLyrics:false,error:null,lyricError:null};
    jobs=[job]; return reply({job});
  }
  if (url.pathname === '/api/downloads') return reply({jobs});
  if (url.pathname.endsWith('/audio')) {
    audioReads++;
    audioRequestStarted?.();
    if (delayAudio) await delayAudio;
    return route.fulfill({body:audio,contentType:'audio/mpeg'});
  }
  if (url.pathname.endsWith('/lyrics')) return route.fulfill({body:'[00:00]海边的来信\n[00:05]潮水送来你的声音',contentType:'text/plain'});
  const action = url.pathname.split('/').pop();
  const states = {pause:'paused',resume:'downloading',cancel:'cancelled',retry:'downloading'};
  if (states[action]) {jobs[0]={...jobs[0],status:states[action]}; return reply({job:jobs[0]});}
  return route.fulfill({status:404,json:{error:'找不到任务'}});
});
try {
  await page.goto(process.env.PLAYER_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/夜航.mp3');
  await page.getByRole('heading',{name:'夜航',exact:true}).waitFor();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  const originalSource = await page.locator('audio').getAttribute('src');
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await page.getByRole('button',{name:'显示歌词',exact:true}).click();
  assert.equal(await page.locator('.vinyl-lyrics .lyrics-panel').isVisible(),true,'online view must open visible lyrics instead of an empty immersive screen');
  assert.equal(await page.locator('audio').getAttribute('src'),originalSource);
  assert.equal(await page.locator('audio').evaluate(a => a.paused),false);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await page.getByLabel('选择音源').selectOption('fixture');
  await page.getByPlaceholder('输入歌名、歌手或专辑').fill('海边');
  await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.getByRole('heading',{name:'海边来信',exact:true}).waitFor();
  assert.ok(await page.getByText('另一音源暂不可用',{exact:false}).count());
  assert.equal(searches,1);
  await page.getByRole('button',{name:'下载 海边来信'}).click();
  const task = page.getByRole('article',{name:'下载任务 海边来信'});
  await task.getByRole('button',{name:'暂停下载'}).click();
  await task.getByText('已暂停',{exact:true}).waitFor();
  await task.getByRole('button',{name:'继续下载'}).click();
  await task.getByRole('button',{name:'取消下载'}).click();
  await task.getByText('已取消',{exact:true}).waitFor();
  await task.getByRole('button',{name:'重新下载'}).click();
  let releaseAudio;
  delayAudio = new Promise(resolve => releaseAudio=resolve);
  jobs[0]={...jobs[0],status:'completed',received:audio.length,total:audio.length,hasLyrics:true};
  await page.waitForFunction(() => document.querySelector('.online-task')?.textContent.includes('已完成'));
  // A local import during an online import must not be dropped or overwritten.
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/微风.mp3');
  releaseAudio(); delayAudio=undefined;
  await task.getByText('已加入曲库',{exact:true}).waitFor();
  assert.equal(await page.locator('audio').getAttribute('src'),originalSource);
  assert.equal(await page.locator('audio').evaluate(a => a.paused),false);
  assert.equal(await task.getByRole('link',{name:'保存音频'}).getAttribute('href'),'/api/downloads/job-one/audio');
  assert.equal(await task.getByRole('link',{name:'保存歌词'}).getAttribute('href'),'/api/downloads/job-one/lyrics');
  await page.getByRole('button',{name:/本地音乐/}).click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3);
  assert.ok(await page.getByRole('button',{name:'播放 海边来信',exact:true}).count());
  await page.getByRole('button',{name:'播放 海边来信',exact:true}).click();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.getByRole('button',{name:'海边的来信',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回曲库'}).click();
  assert.ok(await page.locator('.track-meta').getByText('海岸乐队 · 潮汐').count());
  await page.getByRole('button',{name:'移除 海边来信'}).click();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 2);
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await task.getByText('已加入曲库',{exact:true}).waitFor();
  assert.equal(audioReads,1,'completed job is imported once across reloads even after track removal');
  await task.getByRole('button',{name:'再次加入曲库'}).click();
  await page.getByRole('button',{name:/本地音乐/}).click();
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3);
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  // Removing the same song after reimport starts must win, including persisted storage.
  let releaseReimport;
  delayAudio = new Promise(resolve => releaseReimport=resolve);
  const reimportStarted = new Promise(resolve => audioRequestStarted=resolve);
  await task.getByRole('button',{name:'再次加入曲库'}).click();
  await reimportStarted;
  await page.getByRole('button',{name:/本地音乐/}).click();
  await page.getByRole('button',{name:'移除 海边来信'}).click();
  releaseReimport(); delayAudio=undefined;audioRequestStarted=undefined;
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.online-task')?.textContent.includes('正在加入曲库…'));
  await page.getByRole('button',{name:/本地音乐/}).click();
  assert.equal(await page.locator('.track-row').count(),2,'removing a song must invalidate its pending reimport');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  assert.equal(await page.locator('.track-row').count(),2,'the later removal must persist across reload');
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await page.getByPlaceholder('输入歌名、歌手或专辑').fill('空');
  await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.getByText('没有找到歌曲，试试其他关键词或音源').waitFor();
  failSearch=true;
  await page.getByRole('button',{name:'搜索歌曲',exact:true}).click();
  await page.getByText('音源暂时无法连接，请稍后重试',{exact:true}).waitFor();
  for (const name of ['浅色唱片室','极简舞台','雾蓝玻璃']) {
    await page.getByRole('button',{name:'外观预设'}).click();
    await page.getByRole('button',{name:new RegExp(name)}).click();
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A failed receipt write must abort the audio write as well, then allow retry.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.blockImportReceipt = true;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'downloadImports' && window.blockImportReceipt) throw new DOMException('Storage full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  jobs = [{...jobs[0],id:'job-storage',song:{...song,title:'重试收藏'}}];
  const failedImport = page.getByRole('article',{name:'下载任务 重试收藏'});
  await failedImport.getByText('尚未加入曲库',{exact:true}).waitFor();
  const persistedAfterFailure = await page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => {const request=indexedDB.open('clear-music-library',2);request.onsuccess=() => resolve(request.result);request.onerror=() => reject(request.error);});
    const track = await new Promise(resolve => {const request=db.transaction('tracks').objectStore('tracks').get('download:job-storage');request.onsuccess=() => resolve(request.result);});
    const receipt = await new Promise(resolve => {const request=db.transaction('downloadImports').objectStore('downloadImports').get('job-storage');request.onsuccess=() => resolve(request.result);});
    db.close(); return {track:!!track,receipt:!!receipt};
  });
  assert.deepEqual(persistedAfterFailure,{track:false,receipt:false});
  await page.evaluate(() => window.blockImportReceipt=false);
  await failedImport.getByRole('button',{name:'重试加入曲库'}).click();
  await failedImport.getByText('已加入曲库',{exact:true}).waitFor();
  await page.screenshot({path:'screenshots/online-mobile.png',fullPage:true});
  const mobileSource = await page.locator('audio').getAttribute('src');
  // The compact layout hides this footer control; exercise its mobile handler directly.
  await page.locator('.transport-controls [aria-label="显示歌词"]').dispatchEvent('click');
  assert.equal(await page.locator('.vinyl-lyrics .lyrics-panel').isVisible(),true,'the mobile lyrics handler must leave the online section');
  assert.equal(await page.locator('audio').getAttribute('src'),mobileSource);
  await page.getByRole('button',{name:'返回曲库'}).click();
  await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'screenshots/online-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: online search, warnings, task controls, serial import, metadata/LRC, persistent receipt, reimport removal race, online lyrics navigation, errors and mobile/themes');
} finally {await browser.close();}

