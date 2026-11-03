import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runArtworkBatch} from '../src/lib/artworkBatch.ts';

test('batch artwork skips existing covers, runs sequentially and reports review/missing without stopping',async()=>{
  let active=0,peak=0;const visited=[],progress=[];
  const result=await runArtworkBatch([{id:'a'},{id:'has',artwork:new Blob(['x'])},{id:'b'},{id:'c'}],async track=>{
    active++;peak=Math.max(peak,active);visited.push(track.id);await new Promise(resolve=>setTimeout(resolve,2));active--;return track.id==='a'?'filled':track.id==='b'?'review':'missing';
  },{signal:new AbortController().signal,delay:0,onProgress:value=>progress.push(value.done)});
  assert.deepEqual(visited,['a','b','c']);assert.equal(peak,1);
  assert.deepEqual([result.total,result.done,result.filled,result.review,result.missing],[3,3,1,1,1]);
  assert.deepEqual(progress,[0,1,2,3]);
});
test('cancelled batch never starts remaining lookups and errors are counted separately',async()=>{
  const controller=new AbortController(),visited=[];
  const result=await runArtworkBatch([{id:'a'},{id:'b'},{id:'c'}],async track=>{visited.push(track.id);if(track.id==='a')throw new Error('offline');controller.abort();return 'skipped';},{signal:controller.signal,delay:0});
  assert.deepEqual(visited,['a','b']);assert.equal(result.errors,1);assert.equal(result.done,1);assert.equal(result.cancelled,true);
});
