import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,channel:'msedge'});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
await page.emulateMedia({reducedMotion:'reduce'});
await page.goto('http://127.0.0.1:5173');
await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
await mkdir('screenshots',{recursive:true});
await page.screenshot({path:'screenshots/empty.png'});
await page.locator('input[type=file]').first().setInputFiles(['tests/fixtures/微风.mp3','tests/fixtures/微风.lrc','tests/fixtures/夜航.mp3']);
await page.getByRole('heading',{name:'微风',exact:true}).waitFor();
for (const [theme,label] of [['glass','雾蓝玻璃'],['light','浅色唱片室'],['stage','极简舞台']]) {
  await page.getByRole('button',{name:'外观预设'}).click();
  await page.locator('.theme-dialog').getByRole('button',{name:new RegExp(label)}).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:`screenshots/${theme}.png`});
}
await page.getByRole('button',{name:'外观预设'}).click();
await page.screenshot({path:'screenshots/themes.png'});
await page.keyboard.press('Escape');
await page.setViewportSize({width:390,height:844});
await page.waitForTimeout(400);
await page.screenshot({path:'screenshots/mobile.png'});
await page.getByRole('button',{name:'播放设置',exact:true}).click();
await page.screenshot({path:'screenshots/mobile-settings.png'});
console.log(await page.evaluate(() => ({width:innerWidth,documentWidth:document.documentElement.scrollWidth,sidebarRight:document.querySelector('.sidebar').getBoundingClientRect().right})));
await browser.close();
