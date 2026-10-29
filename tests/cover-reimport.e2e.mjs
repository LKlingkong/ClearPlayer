import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const audio=await readFile('tests/fixtures/专辑封面.mp3');
const job={id:'cover-reimport',song:{key:'cover-song',id:'cover',source:'fixture',title:'封面回归',artist:'CLEAR',album:'封面测试',duration:24,format:'mp3'},status:'completed',received:audio.length,total:audio.length,filename:'封面回归.mp3',hasLyrics:false};
let audioReads=0;
await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/sources')return route.fulfill({json:{sources:[{id:'fixture',name:'测试源'}]}});
  if(url.pathname==='/api/downloads')return route.fulfill({json:{jobs:[job]}});
  if(url.pathname.endsWith('/audio')){audioReads++;return route.fulfill({body:audio,contentType:'audio/mpeg'});}
  return route.fulfill({status:404,json:{error:'not found'}});
});
try{
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading',{name:'封面回归',exact:true}).waitFor();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===256);
  await page.locator('input[accept=".jpg,.jpeg,.png,.webp"]').setInputFiles('tests/fixtures/alternate-cover.png');
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===128);
  await page.getByRole('button',{name:'返回曲库'}).click();
  await page.getByRole('button',{name:'在线找歌',exact:true}).click();
  const task=page.getByRole('article',{name:'下载任务 封面回归'});
  await task.getByRole('button',{name:'再次加入曲库'}).click();
  await page.waitForFunction(()=>document.querySelector('.online-import-status')?.textContent==='已加入曲库');
  assert.equal(audioReads,2);
  await page.getByRole('button',{name:/本地音乐/}).click();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  assert.equal(await page.locator('.vinyl-label img').evaluate(img=>img.naturalWidth),128,'重新加入曲库必须保留用户选择的专辑封面');
  await page.reload();
  await page.getByRole('heading',{name:'封面回归',exact:true}).waitFor();
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.vinyl-label img')?.naturalWidth===128);
  console.log('PASS: 音频有内嵌封面时，再次加入曲库与刷新仍保留用户手动选择的封面');
}finally{await browser.close();}
