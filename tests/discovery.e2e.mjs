import {chromium} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:950}});
const audio=await readFile('tests/fixtures/微风.mp3');const errors=[];page.on('pageerror',e=>errors.push(e.message));
const remote=i=>({id:String(100+i),source:'netease',title:`海风 ${i}`,artist:'海岸乐队',album:'潮汐',duration:20,format:'mp3'});
const preview={source:'netease',sourceId:'123',sourceUrl:'https://music.163.com/playlist?id=123',name:'海岸来信',tags:['独立'],songs:[remote(1),remote(2),remote(3)],total:3,complete:true,warnings:[]};
let jobs=[],prepared=0,downloadAllowed=true,candidateCalls=0,previewNext=preview,previewDelay=0,radarUnavailable=false,audioReads=0,delayedSong='',delayedOnce=false,releasePrepare;
await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url());const reply=d=>route.fulfill({json:d});
 if(u.pathname==='/api/playlists/preview'){const snapshot=previewNext;if(previewDelay)await new Promise(r=>setTimeout(r,previewDelay));return reply(snapshot);}
 if(u.pathname==='/api/radar/candidates'){candidateCalls++;return reply(radarUnavailable?{songs:[],warnings:['音源连接失败'],unavailable:true}:{songs:Array.from({length:60},(_,i)=>({...remote(20+i),reason:'和你的偏爱相近'})),warnings:[]});}
 if(u.pathname==='/api/songs/prepare'){prepared++;const song=req.postDataJSON().song;let job=jobs.find(j=>j.song.id===song.id);if(!job){job={id:`00000000-0000-4000-8000-${String(prepared).padStart(12,'0')}`,song,received:1024,total:2048,status:downloadAllowed?'completed':'downloading',filename:`海风${song.id}.mp3`,hasLyrics:false};jobs.push(job);}if(song.id===delayedSong&&!delayedOnce){delayedOnce=true;await new Promise(r=>releasePrepare=r);}return reply({job});}
 if(u.pathname==='/api/downloads')return reply({jobs});
 if(u.pathname.endsWith('/audio')){audioReads++;return route.fulfill({body:audio,contentType:'audio/mpeg'});}
 if(/\/(pause|resume|retry|cancel)$/.test(u.pathname)){const parts=u.pathname.split('/'),job=jobs.find(j=>j.id===parts.at(-2));job.status={pause:'paused',resume:downloadAllowed?'completed':'downloading',retry:'completed',cancel:'cancelled'}[parts.at(-1)];return reply({job});}
 if(u.pathname==='/api/sources')return reply({sources:[]});
 return route.fulfill({status:404,json:{error:'无候选封面'}});
});
const click=(name)=>page.getByRole('button',{name,exact:true}).click();
try{
 await page.goto(process.env.PLAYER_URL||'http://127.0.0.1:5173');
 await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=123');await click('读取歌单');
 await page.getByRole('dialog').getByText('海岸来信',{exact:true}).waitFor();await click('导入并下载');
 await page.getByRole('heading',{name:'海岸来信',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="ready"]').length===3,{},{timeout:20000});
 assert.equal(prepared,3);await click('播放 海风 1');await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
 const src=await page.locator('audio').getAttribute('src');
 await click('个人雷达');await page.getByRole('heading',{name:/今天，听见/}).waitFor();
 await click('生成今日雷达');await page.locator('.radar-song').first().waitFor();
 assert.ok(candidateCalls);assert.equal(await page.locator('audio').getAttribute('src'),src);
 await page.getByRole('button',{name:/不感兴趣 海风/}).first().click();
 const count=await page.locator('.radar-song').count();assert.ok(count>0);
 await page.reload();await click('个人雷达');await page.locator('.radar-song').first().waitFor();assert.equal(await page.locator('.radar-song').count(),count);
 await click('海岸来信');assert.equal(await page.locator('.discovery-row').count(),3);
 await click('检查更新');await page.getByText('没有新增歌曲',{exact:false}).waitFor();
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=123');await click('读取歌单');await click('导入并下载');
 assert.equal(await page.locator('.playlist-nav-item').count(),1);assert.equal(prepared,3);
 await click('新建歌单');await page.getByLabel('歌单名称').fill('夜间电台');await click('创建歌单');
 await page.getByRole('heading',{name:'夜间电台',exact:true}).waitFor();await click('添加曲库歌曲');await page.getByRole('dialog').getByRole('button',{name:/添加 海风/}).first().click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('.discovery-row').count(),1);
 await click('删除歌单');await page.getByRole('dialog').getByRole('button',{name:'删除歌单',exact:true}).click();
 await page.getByRole('button',{name:'本地音乐，我的曲库'}).click();assert.equal(await page.locator('.track-row').count(),3);
 // A deliberately removed downloaded track can be explicitly restored through playlist retry.
 await click('移除 海风 2');await click('海岸来信');await page.locator('.discovery-row[data-status="failed"]').waitFor();await click('重试待补齐');await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="ready"]').length===3,{},{timeout:15000});
 // Playlist context, not the whole library, determines the next song.
 await click('海岸来信');await click('播放 海风 1');await click('下一首');await page.waitForFunction(()=>document.querySelector('.mini-info strong').textContent==='海风 2');
 // A late preview must not reappear after the pasted link changes or the dialog closes.
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=123');previewDelay=350;await click('读取歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=456');await page.waitForTimeout(450);assert.equal(await page.locator('.playlist-preview').count(),0);await page.keyboard.press('Escape');previewDelay=0;
 // Pausing survives a complete reload; resuming completes the existing jobs instead of duplicating them.
 downloadAllowed=false;previewNext={...preview,sourceId:'456',name:'暂停恢复',songs:[remote(300),remote(301)],total:2};
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=456');await click('读取歌单');await click('导入并下载');
 await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="downloading"]').length===2);
 await click('暂停下载');const beforeReload=prepared;await page.waitForTimeout(200);await page.reload();await click('暂停恢复');await page.getByRole('button',{name:'继续下载',exact:true}).waitFor();await page.waitForTimeout(1200);assert.equal(prepared,beforeReload);
 downloadAllowed=true;await click('继续下载');await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="ready"]').length===2);
 // A shared recording is one download, and pausing one list cannot stop another active list.
 downloadAllowed=false;previewNext={...preview,sourceId:'901',name:'共享甲',songs:[remote(800)],total:1};
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=901');await click('读取歌单');await click('导入并下载');await page.locator('.discovery-row[data-status="downloading"]').waitFor();
 previewNext={...previewNext,sourceId:'902',name:'共享乙'};await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=902');await click('读取歌单');await click('导入并下载');await page.locator('.discovery-row[data-status="downloading"]').waitFor();await click('暂停下载');await page.waitForTimeout(200);assert.equal(jobs.find(j=>j.song.id===remote(800).id).status,'downloading');
 downloadAllowed=true;await click('继续下载');await page.locator('.discovery-row[data-status="ready"]').waitFor();
 // A deleted list's delayed prepare response cannot cancel the job now shared by another list.
 downloadAllowed=false;delayedSong=remote(801).id;previewNext={...preview,sourceId:'903',name:'延迟甲',songs:[remote(801)],total:1};
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=903');await click('读取歌单');await click('导入并下载');while(!delayedOnce)await page.waitForTimeout(20);
 previewNext={...previewNext,sourceId:'904',name:'延迟乙'};await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=904');await click('读取歌单');await click('导入并下载');await page.locator('.discovery-row[data-status="downloading"]').waitFor();
 await click('延迟甲');await click('删除歌单');await page.getByRole('dialog').getByRole('button',{name:'删除歌单',exact:true}).click();releasePrepare();await page.waitForTimeout(300);assert.equal(jobs.find(j=>j.song.id===remote(801).id).status,'downloading');
 downloadAllowed=true;await click('延迟乙');await click('暂停下载');await click('继续下载');await page.locator('.discovery-row[data-status="ready"]').waitFor();
 // Updating imports only additions and preserves a user-selected name.
 await click('海岸来信');await page.locator('.playlist-title-button').click();await page.getByLabel('歌单名称').fill('保留我的名字');await click('保存名称');
 previewNext={...preview,songs:[...preview.songs,remote(4)],total:4};await click('检查更新');await page.getByRole('dialog',{name:'发现歌单更新'}).waitFor();await click('补入并下载');await page.getByRole('heading',{name:'保留我的名字',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="ready"]').length===4);
 // Long lists reach the real last row and preserve their scroll position across navigation.
 previewNext={...preview,sourceId:'789',name:'长歌单',songs:Array.from({length:70},(_,i)=>remote(i%3+1)),total:70};
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=789');await click('读取歌单');await click('导入并下载');
 await page.locator('.discovery-row').last().scrollIntoViewIfNeeded();const scroll=await page.locator('.page-content').evaluate(e=>e.scrollTop);assert.ok(scroll>1000);
 const last=await page.locator('.discovery-row').last().boundingBox(),dock=await page.locator('.player-bar').boundingBox();assert.ok(last.y+last.height<=dock.y+1);
 await click('个人雷达');await click('长歌单');assert.ok(Math.abs(await page.locator('.page-content').evaluate(e=>e.scrollTop)-scroll)<3);
 // Preference changes are explicit, and keyboard focus stays inside the dialog.
 await click('个人雷达');await click('我的听感');await page.getByLabel('添加偏好标签').fill('爵士');await click('添加标签');await page.getByRole('dialog').getByText('爵士',{exact:true}).waitFor();await page.keyboard.press('Escape');
 const retained=await page.locator('.radar-song').count();radarUnavailable=true;await click('换一批');await page.getByText('网络暂不可用，保留上次雷达结果',{exact:false}).waitFor();assert.equal(await page.locator('.radar-song').count(),retained);radarUnavailable=false;
 // Restarting the service pauses its jobs; an active playlist must resume them automatically.
 downloadAllowed=false;previewNext={...preview,sourceId:'950',name:'缓冲歌单',songs:[remote(1),remote(900),remote(3)],total:3};
 await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=950');await click('读取歌单');await click('导入并下载');await page.locator('.discovery-row[data-status="downloading"]').waitFor();
 jobs.find(j=>j.song.id===remote(900).id).status='paused';await page.reload();await click('缓冲歌单');await page.locator('.discovery-row[data-status="downloading"]').waitFor();assert.equal(jobs.find(j=>j.song.id===remote(900).id).status,'downloading');
 // Selecting C from the queue invalidates the earlier buffering request for B.
 await click('播放 海风 1');await click('下一首');await click('播放队列');await page.locator('.queue-list button').filter({hasText:'海风 3'}).click();await click('关闭播放队列');
 downloadAllowed=true;jobs.find(j=>j.song.id===remote(900).id).status='completed';await page.waitForFunction(()=>document.querySelectorAll('.discovery-row[data-status="ready"]').length===3);await page.waitForTimeout(700);assert.equal(await page.locator('.mini-info strong').innerText(),'海风 3');
 // A late check-update response cannot replace a different playlist's rename dialog.
 await click('保留我的名字');previewNext={...preview,songs:[...preview.songs,remote(999)],total:4};previewDelay=500;await click('检查更新');await click('共享甲');await page.locator('.playlist-title-button').click();await page.getByLabel('歌单名称').fill('暂不保存');await page.waitForTimeout(650);assert.equal(await page.getByRole('dialog').getAttribute('aria-label'),'重命名歌单');await page.keyboard.press('Escape');previewDelay=0;
 // A failed disk write waits for an explicit retry; it does not re-read audio every second.
 await page.evaluate(()=>{window.__originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='tracks')throw new DOMException('quota','QuotaExceededError');return window.__originalPut.apply(this,args);};});
 previewNext={...preview,sourceId:'960',name:'存储重试',songs:[remote(950)],total:1};await click('导入歌单');await page.getByLabel('歌单分享链接').fill('https://music.163.com/playlist?id=960');await click('读取歌单');await click('导入并下载');await page.locator('.discovery-row[data-status="failed"]').waitFor();await page.waitForTimeout(500);const failedReads=audioReads;await page.waitForTimeout(2200);assert.equal(audioReads,failedReads);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__originalPut;});await click('重试待补齐');await page.locator('.discovery-row[data-status="ready"]').waitFor();
 await click('个人雷达');await mkdir('.verification/discovery',{recursive:true});await page.screenshot({path:'.verification/discovery/radar.png',fullPage:true,animations:'disabled'});
 for(const theme of ['light','stage']){await page.evaluate(t=>localStorage.setItem('clear:theme',JSON.stringify(t)),theme);await page.reload();await click('个人雷达');await page.screenshot({path:`.verification/discovery/radar-${theme}.png`,animations:'disabled'});}
 await page.setViewportSize({width:980,height:720});await click('长歌单');await page.locator('.discovery-row').last().scrollIntoViewIfNeeded();const smallLast=await page.locator('.discovery-row').last().boundingBox(),smallDock=await page.locator('.player-bar').boundingBox();assert.ok(smallLast.y+smallLast.height<=smallDock.y+1);
 await page.screenshot({path:'.verification/discovery/playlist-small.png',animations:'disabled'});
 assert.deepEqual(errors,[]);console.log('DISCOVERY_E2E_OK');
}finally{await browser.close();}
