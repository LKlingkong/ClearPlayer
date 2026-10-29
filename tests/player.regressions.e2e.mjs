import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true,channel:'msedge'});
const failures = [];
const setup = async (mobile = false) => {
  const page = await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  await page.locator('input[type=file]').first().setInputFiles(['tests/fixtures/微风.mp3','tests/fixtures/夜航.mp3']);
  await page.getByRole('heading',{name:'微风',exact:true}).waitFor();
  return page;
};
const cases = [
  ['浅色预设正文保持可读对比度', async () => {
    const page = await setup();
    await page.getByRole('button',{name:'外观预设'}).click();
    await page.getByRole('button',{name:/浅色唱片室/}).click();
    await page.keyboard.press('Escape');
    const contrast = await page.evaluate(() => {
      const luminance = value => {const rgb = value.match(/\d+/g).slice(0,3).map(Number).map(n => {const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
      const foreground = luminance(getComputedStyle(document.querySelector('h1')).color);
      const background = luminance(getComputedStyle(document.querySelector('.app-shell')).backgroundColor);
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    });
    assert.ok(contrast >= 4.5, `正文对比度 ${contrast.toFixed(2)}`);
  }],
  ['刷新保留选中的歌曲', async () => {
    const page = await setup();
    await page.getByRole('button',{name:'下一首'}).click();
    await page.getByRole('heading',{name:'夜航',exact:true}).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 2);
    assert.equal(await page.getByRole('heading',{name:'夜航',exact:true}).count(),1);
  }],
  ['主播放键和切歌记录最近播放', async () => {
    const page = await setup();
    await page.getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
    await page.getByRole('button',{name:'下一首'}).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
    await page.getByRole('button',{name:/最近播放/}).click();
    assert.equal(await page.locator('.track-row').count(),2);
  }],
  ['手机可调整播放模式和音量', async () => {
    const page = await setup(true);
    const settings = page.getByRole('button',{name:'播放设置',exact:true});
    assert.equal(await settings.count(),1);
    await settings.click();
    await page.getByRole('slider',{name:'设置音量',exact:true}).fill('0.23');
    assert.equal(await page.locator('audio').evaluate(a => a.volume),.23);
    await page.locator('.playback-settings').getByRole('button',{name:'单曲循环',exact:true}).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('clear:mode'))),'repeat');
  }],
  ['异步导入不覆盖同时进行的收藏和移除', async () => {
    const page = await setup();
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function() {
        if (this.name === '微风.lrc') return new Promise(resolve => {window.releaseImport = () => original.call(this).then(resolve);});
        return original.call(this);
      };
    });
    await page.locator('input[type=file]').nth(1).setInputFiles('tests/fixtures/微风.lrc');
    await page.getByRole('button',{name:'收藏当前歌曲',exact:true}).click();
    await page.getByRole('button',{name:'移除 夜航'}).click();
    await page.evaluate(() => window.releaseImport());
    await page.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
    assert.equal(await page.locator('.track-row').count(),1);
    assert.equal(await page.getByRole('button',{name:'取消收藏当前歌曲',exact:true}).count(),1);
  }],
];
for (const [name, run] of cases) {
  try {await run(); console.log(`PASS: ${name}`);} catch(error) {failures.push(name); console.error(`FAIL: ${name}: ${error.message}`);}
}
await browser.close();
assert.deepEqual(failures,[]);
