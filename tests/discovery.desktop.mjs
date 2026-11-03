import {_electron} from '@playwright/test';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('.verification/discovery',{recursive:true});
const profile=await mkdtemp(resolve('.verification/discovery-desktop-')),env={...process.env,CLEAR_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:resolve('desktop-app/澄音播放器.exe'),env,timeout:30000}),page=await app.firstWindow(),errors=[];
page.on('pageerror',e=>errors.push(e.message));const png=await readFile('tests/fixtures/embedded-cover.png');
const song={source:'qq',id:'fixture#M500',title:'公开歌单示例',artist:'歌手',album:'专辑',duration:200,artworkUrl:'https://y.gtimg.cn/music/photo_new/T002R300x300M000fixture.jpg'};
// The clear: scheme is served by Electron's protocol handler, outside browser HTTP routing.
// Replace the protocol bridge's localhost responses, keeping renderer CSP and real audio intact.
await app.evaluate((_electron,{song,png})=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const u=new URL(typeof input==='string'?input:input.url||String(input));
  if(u.hostname!=='127.0.0.1'||!u.pathname.startsWith('/api/'))return original(input,options);
  const json=(data,status=200)=>Response.json(data,{status});
  if(u.pathname==='/api/playlists/preview')return json({source:'qq',sourceId:'123',sourceUrl:'https://y.qq.com/n/ryqq/playlist/123',name:'桌面歌单',cover:'https://qpic.y.qq.com/music_cover/fixture/300',tags:['独立'],songs:[song],total:1,complete:true,warnings:[]});
  if(u.pathname==='/api/discovery/cover')return new Response(new Uint8Array(png),{headers:{'Content-Type':'image/png'}});
  if(u.pathname==='/api/songs/prepare')return json({error:'示例音源暂不可用，可稍后重试'},400);
  if(u.pathname==='/api/radar/candidates')return json({songs:[{...song,id:'new#M500',title:'下一首心动',reason:'和你收藏的歌曲听感相近'}],warnings:[]});
  if(u.pathname==='/api/downloads')return json({jobs:[]});
  if(u.pathname==='/api/sources')return json({sources:[]});
  return json({error:'无封面'},404);
 };
},{song,png:Array.from(png)});

try{
 await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
 await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/微风.mp3');await page.getByRole('heading',{name:'微风',exact:true}).waitFor();await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);const source=await page.locator('audio').getAttribute('src');
 await page.getByRole('button',{name:'导入歌单',exact:true}).click();await page.getByLabel('歌单分享链接').fill('https://y.qq.com/n/ryqq/playlist/123');await page.getByRole('button',{name:'读取歌单',exact:true}).click();await page.getByRole('button',{name:'导入并下载',exact:true}).click();await page.getByRole('heading',{name:'桌面歌单',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.playlist-art img')?.naturalWidth>0);assert.match(await page.locator('.playlist-art img').getAttribute('src'),/^\/api\/discovery\/cover/);assert.equal(await page.locator('audio').getAttribute('src'),source);assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
 await page.getByRole('button',{name:'个人雷达',exact:true}).click();await page.getByRole('button',{name:'生成今日雷达',exact:true}).click();await page.locator('.radar-song').first().waitFor();
 await page.getByRole('button',{name:'我的听感',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('audio').getAttribute('src'),source);
 await page.screenshot({path:'.verification/discovery/desktop-radar.png',animations:'disabled'});assert.deepEqual(errors,[]);console.log('DESKTOP_DISCOVERY_CSP_PLAYBACK_OK');
}finally{await app.close();}
