import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLyrics, lyricIndex } from '../src/lib/lyrics.ts';
import { fileStem, nextTrackId, formatTime, readLyricFile } from '../src/lib/library.ts';

test('offset 和多个时间标签正确展开', () => {
  const result = parseLyrics('[00:05.50][00:01.2]风吹过\n[offset:-200]\n[00:00]开始');
  assert.deepEqual(result.lines, [{time:.2,text:'开始'}, {time:1.4,text:'风吹过'}, {time:5.7,text:'风吹过'}]);
});
test('LRC 正 offset 让歌词提前，负 offset 延后', () => {
  assert.equal(parseLyrics('[offset:1000]\n[00:10]风').lines[0].time, 9);
  assert.equal(parseLyrics('[offset:-1000]\n[00:10]风').lines[0].time, 11);
});
test('TXT 不生成虚假的同步时间', () => {
  assert.deepEqual(parseLyrics('一\n\n二'), {synced:false,lines:[{time:null,text:'一'},{time:null,text:'二'}]});
});
test('当前歌词在边界时间正确切换', () => {
  const { lines } = parseLyrics('[00:01]一\n[00:02]二');
  assert.deepEqual([0,1,1.99,2,100].map(t => lyricIndex(lines,t)), [-1,0,0,1,1]);
});
test('损坏时间戳和元数据不会成为歌词', () => {
  assert.deepEqual(parseLyrics('[ar:歌手]\n[99:99]损坏').lines, []);
});
test('路径和扩展名大小写不影响同名匹配', () => {
  assert.equal(fileStem('C:\\Music\\Song.MP3'), 'song');
  assert.equal(fileStem('song.lrc'), 'song');
});
test('顺序播放到末尾停止，手动下一首回到第一首', () => {
  assert.equal(nextTrackId(['a','b'], 'b', 'order', true), null);
  assert.equal(nextTrackId(['a','b'], 'b', 'order', false), 'a');
});
test('单曲循环只作用于自动结束，随机避免立即重复', () => {
  assert.equal(nextTrackId(['a','b'], 'a', 'repeat', true), 'a');
  assert.equal(nextTrackId(['a','b'], 'a', 'repeat', false), 'b');
  assert.equal(nextTrackId(['a','b'], 'a', 'shuffle', true), 'b');
  assert.equal(nextTrackId([], null, 'shuffle', true), null);
});
test('无效和负数时间正确兜底', () => {
  assert.equal(formatTime(Infinity), '0:00');
  assert.equal(formatTime(-4), '0:00');
  assert.equal(formatTime(125.9), '2:05');
});
test('UTF-8 歌词正常读取', async () => {
  assert.equal(await readLyricFile(new File(['风吹过'], 'test.lrc')), '风吹过');
});

test('逐字时间标记不出现在歌词正文，包含用户报告的负时长标记',()=>{
  assert.deepEqual(parseLyrics('[00:01.80]<1800,-1800>还<1800,300>在<2100,400>听\n[00:05.00]<5000,200,0>你<5200,300,0>好'),{synced:true,lines:[{time:1.8,text:'还在听'},{time:5,text:'你好'}]});
});
test('增强 LRC 与毫秒逐字歌词保留行同步并清除逐字时间',()=>{
  assert.deepEqual(parseLyrics('[00:01.00]<00:01.00>你<00:01.50>好<00:02.00>\n[3000,2000](3000,500,0)风(3500,500,0)吹过'),{synced:true,lines:[{time:1,text:'你好'},{time:3,text:'风吹过'}]});
});
test('歌词清洗保留普通尖括号、数字和歌词中的括号文字',()=>{
  assert.deepEqual(parseLyrics('[00:01]I <3 you <again> (2024)\n[00:02]还<1800,-1800>在'),{synced:true,lines:[{time:1,text:'I <3 you <again> (2024)'},{time:2,text:'还在'}]});
  assert.deepEqual(parseLyrics('<1800,-1800>还在这里\n我喜欢 (live) 的声音'),{synced:false,lines:[{time:null,text:'还在这里'},{time:null,text:'我喜欢 (live) 的声音'}]});
});
