import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAudio, validateRemoteUrl } from '../server/downloader.mjs';

async function fixture(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'clear-download-test-'));
  try { await run(`http://127.0.0.1:${server.address().port}`, join(dir, 'audio.part')); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive:true, force:true}); }
}
const audio = await readFile(new URL('./fixtures/微风.mp3', import.meta.url));

test('audio download writes exact bytes and detects real MP3', async () => {
  await fixture((_req,res) => {res.writeHead(200, {'Content-Length':audio.length,'Content-Type':'audio/mpeg','ETag':'"fixture-v1"'}); res.end(audio);}, async (url,dest) => {
    const result = await downloadAudio({url, dest, allowLocal:true});
    assert.equal(result.format, 'mp3'); assert.equal(result.bytes, audio.length);
    assert.deepEqual(await readFile(dest), audio);
  });
});
test('HTTP 200 HTML error is never accepted as music', async () => {
  await fixture((_req,res) => {res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>expired audio link</html>');}, async (url,dest) => {
    await assert.rejects(downloadAudio({url,dest,allowLocal:true}), /音频|网页|格式/);
  });
});
test('a short preview is not accepted as the declared full-length song', async () => {
  await fixture((_req,res)=>{res.writeHead(200,{'Content-Length':audio.length,'Content-Type':'audio/mpeg'});res.end(audio);},async(url,dest)=>{
    await assert.rejects(downloadAudio({url,dest,allowLocal:true,expectedDuration:180}),/试听|时长|完整/);
  });
});
test('resume appends only the requested range of the same validated resource', async () => {
  let range;
  await fixture((req,res) => {range=req.headers.range;const start=1024;res.writeHead(206,{'ETag':'"fixture-v1"','Content-Length':audio.length-start,'Content-Range':`bytes ${start}-${audio.length-1}/${audio.length}`});res.end(audio.subarray(start));}, async (url,dest) => {
    await writeFile(dest,audio.subarray(0,1024));
    await writeFile(dest+'.json',JSON.stringify({etag:'"fixture-v1"',total:audio.length,url}));
    const result = await downloadAudio({url,dest,allowLocal:true});
    assert.equal(range,'bytes=1024-');assert.equal(result.bytes,audio.length);assert.deepEqual(await readFile(dest),audio);
  });
});
test('mismatched Content-Range is rejected instead of corrupting partial audio', async () => {
  await fixture((_req,res) => {res.writeHead(206,{'Content-Range':`bytes 0-${audio.length-1}/${audio.length}`,'ETag':'"fixture-v1"'});res.end(audio);}, async (url,dest) => {
    await writeFile(dest,audio.subarray(0,1024));await writeFile(dest+'.json',JSON.stringify({etag:'"fixture-v1"',total:audio.length,url}));
    await assert.rejects(downloadAudio({url,dest,allowLocal:true}), /续传|范围/);
    assert.deepEqual(await readFile(dest),audio.subarray(0,1024));
  });
});
test('416 does not turn an oversized partial into a completed song', async () => {
  await fixture((_req,res) => {res.writeHead(416,{'Content-Range':'bytes */10'});res.end();}, async (url,dest) => {
    await writeFile(dest,audio.subarray(0,1024));await writeFile(dest+'.json',JSON.stringify({etag:'"fixture-v1"',total:audio.length,url}));
    await assert.rejects(downloadAudio({url,dest,allowLocal:true}), /续传|长度|范围/);
  });
});
test('range ignored by server restarts the partial instead of appending', async () => {
  await fixture((_req,res) => {res.writeHead(200,{'Content-Length':audio.length,'ETag':'"fixture-v2"'});res.end(audio);}, async (url,dest) => {
    await writeFile(dest,audio.subarray(0,1024));await writeFile(dest+'.json',JSON.stringify({etag:'"fixture-v1"',total:audio.length,url}));
    await downloadAudio({url,dest,allowLocal:true});assert.deepEqual(await readFile(dest),audio);
  });
});
test('untrusted local URLs are rejected by normal download path', async () => {
  await assert.rejects(downloadAudio({url:'http://127.0.0.1:1/private',dest:'unused.part'}), /地址|本地|网络/);
});
test('IPv4-mapped IPv6 loopback and LAN cannot bypass remote URL checks', async () => {
  await assert.rejects(validateRemoteUrl('http://[::ffff:127.0.0.1]/audio'), /本地|地址/);
  await assert.rejects(validateRemoteUrl('http://[::ffff:c0a8:101]/audio'), /本地|地址/);
});
