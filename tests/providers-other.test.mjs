import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';

const reply = (data, options) => new Response(JSON.stringify(data), options);
async function fixtureFetch(t, handle) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handle(new URL(url), options);
  t.after(() => { globalThis.fetch = original; });
}
function decryptWeapi(body) {
  const params = new URLSearchParams(body).get('params');
  const decode = (text, key) => {
    const cipher = createDecipheriv('aes-128-cbc', key, '0102030405060708');
    return Buffer.concat([cipher.update(text, 'base64'), cipher.final()]).toString();
  };
  return JSON.parse(decode(decode(params, 'xYz9Kq2LmN8pR4sT'), '0CoJUm6Qyw8W8jud'));
}

test('NetEase encryption matches upstream independently derived golden vector', async () => {
  const { weapiBody } = await import('../server/providers/protocol-crypto.mjs');
  const body = new URLSearchParams(weapiBody({ a: 1 }));
  assert.equal(body.get('params'), 'YAwRl+G2bY1p+OPVaNP5X8s9Uhpi3XTuYj7MQLpJqic=');
  assert.equal(body.get('encSecKey'), '140045a002b91307e676d6ffa2aeb6db1ebf4fb93efbb4b5bcb4130cbbf58f0492d8beae356e0797f638618aff2b6874c4cc55ccc3c150c63d7acb1f3219533599ff220fe2c0c8d2e0fc04e3d8b0a1734028169acee3d66f14eb41453b746236c6ed368f7de91ab749474d540f5744497849353f7dc2c05d4461fdb9b5de86d2');
});

test('NetEase search sends old weapi endpoint and normalizes both song schemas without quota calls', async t => {
  await fixtureFetch(t, (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://music.163.com/weapi/search/get');
    assert.equal(options.headers.Referer, 'https://music.163.com/');
    assert.deepEqual(decryptWeapi(options.body), { s: 'a"\\晴天', type: '1', limit: '2', offset: '0' });
    return reply({ code: 200, result: { songs: [
      { id: 1, name: '晴天', artists: [{ name: '甲' }, { name: '乙' }], album: { name: '专辑' }, duration: 212345 },
      { id: 2, name: '夜曲', ar: [{ name: '丙' }], al: { name: '单曲' }, dt: 120000 },
    ] } });
  });
  const { provider } = await import('../server/providers/netease.mjs');
  const songs = await provider.search('a"\\晴天', 2);
  assert.deepEqual(songs.map(({ id, title, artist, album, duration, source }) => ({ id, title, artist, album, duration, source })), [
    { id: '1', title: '晴天', artist: '甲/乙', album: '专辑', duration: 212.345, source: 'netease' },
    { id: '2', title: '夜曲', artist: '丙', album: '单曲', duration: 120, source: 'netease' },
  ]);
});

test('NetEase quota exhaustion falls back to official ID-matched URL, preserving actual mp3', async t => {
  await fixtureFetch(t, (url, options) => {
    if (url.hostname === 'music.qinglvai.top') {
      assert.equal(url.searchParams.get('level'), 'jymaster');
      return reply({ code: 42903, msg: 'quota' });
    }
    if (url.hostname === 'musicapi.haitangw.net') return reply({ data: { url: 'None' } });
    assert.equal(url.pathname, '/weapi/song/enhance/player/url/v1');
    assert.deepEqual(decryptWeapi(options.body), { ids: '[42]', level: 'exhigh', encodeType: 'mp3' });
    return reply({ code: 200, data: [{ id: 99, url: 'https://cdn.example/wrong.mp3' }, { id: 42, url: 'https://cdn.example/song.mp3?token=a' }] });
  });
  const { provider } = await import('../server/providers/netease.mjs');
  assert.equal((await provider.resolve({ id: '42' })).url, 'https://cdn.example/song.mp3?token=a');
});

test('NetEase lyric translations match numeric timestamps and preserve metadata', async t => {
  await fixtureFetch(t, (url, options) => {
    assert.equal(url.pathname, '/weapi/song/lyric');
    assert.equal(decryptWeapi(options.body).id, '42');
    return reply({ code: 200, lrc: { lyric: '[ti:歌]\n[00:01.00]hello\n[00:02.000]world\n' }, tlyric: { lyric: '[00:01.000]你好\n[00:02.00]世界' } });
  });
  const { provider } = await import('../server/providers/netease.mjs');
  assert.equal((await provider.lyrics({ id: '42' })).replace(/^\uFEFF/, ''), '[ti:歌]\r\n[00:01.00]hello\r\n[00:01.00]你好\r\n[00:02.000]world\r\n[00:02.000]世界\r\n');
});

test('QQ sends valid QIMEI and song mid, falls back from FLAC to official mp3', async t => {
  await fixtureFetch(t, (url, options) => {
    if (url.hostname === 'api.vkeys.cn') return reply({ code: 404 });
    if (url.hostname === 'api.baka.plus') return new Response(null, { status: 502 });
    assert.equal(url.href, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
    const body = JSON.parse(options.body);
    assert.match(body.comm.QIMEI36, /^[a-z0-9]{36}$/i);
    const search = body['music.search.SearchCgiService.DoSearchForQQMusicMobile'];
    if (search) {
      assert.equal(body.comm.ct, 11);
      assert.equal(search.param.query, '晴天');
      assert.equal(search.param.num_per_page, 1);
      return reply({ code: 0, 'music.search.SearchCgiService.DoSearchForQQMusicMobile': { code: 0, data: { body: { item_song: [
        { mid: 'songmid', name: '晴天', singer: [{ name: '歌手' }], album: { name: '专辑', mid: 'albumWRONG' }, interval: 180, file: { media_mid: 'mediaWRONG', size_flac: 1000000, size_320mp3: 100000 }, pay: { pay_down: 0 } },
      ] } } } });
    }
    assert.equal(body.comm.ct, 19);
    const param = body['music.vkey.GetVkey.UrlGetVkey'].param;
    assert.deepEqual(param.songmid, ['songmid']);
    const filename = param.filename[0];
    if (filename === 'F000songmid.flac') return reply({ code: 0, 'music.vkey.GetVkey.UrlGetVkey': { code: 0, data: { sip: ['https://qq.example/'], midurlinfo: [{ purl: '' }] } } });
    assert.equal(filename, 'M800songmid.mp3');
    return reply({ code: 0, 'music.vkey.GetVkey.UrlGetVkey': { code: 0, data: { sip: ['https://qq.example/'], midurlinfo: [{ purl: 'M800songmid.mp3?vkey=abc' }] } } });
  });
  const { provider } = await import('../server/providers/qq.mjs');
  const [song] = await provider.search('晴天', 1);
  assert.equal(song.title, '晴天');
  assert.equal(song.format, 'flac');
  assert.equal((await provider.resolve(song)).url, 'https://qq.example/M800songmid.mp3?vkey=abc');
});

test('QQ lyric endpoint uses song mid and decodes base64 UTF-8 and HTML entities', async t => {
  await fixtureFetch(t, (url, options) => {
    assert.equal(url.searchParams.get('songmid'), 'songmid');
    assert.equal(options.headers.Referer, 'https://y.qq.com/portal/player.html');
    return reply({ retcode: 0, lyric: Buffer.from('[00:01.00]你 &amp; 我\n').toString('base64') });
  });
  const { provider } = await import('../server/providers/qq.mjs');
  assert.match(await provider.lyrics({ id: 'songmid#F000' }), /你 & 我/);
});

test('Yinyueku carries signed fields losslessly and delays signed resolve until download', async t => {
  await fixtureFetch(t, (url, options) => {
    assert.equal(url.href, 'http://yinyueku.cn/api.php');
    const body = new URLSearchParams(options.body);
    if (body.get('types') === 'search') {
      assert.equal(body.get('name'), '晴天');
      assert.equal(body.get('count'), '1');
      return reply([{ id: '42', url_id: 'url42', lyric_id: 'lyric42', source: 'netease', name: '晴天', artist: ['甲', '乙'], album: '专辑', sign: 'a+b/c=' }]);
    }
    assert.equal(body.get('source'), 'netease');
    assert.equal(body.get('sign'), 'a+b/c=');
    if (body.get('types') === 'url') {
      assert.equal(body.get('id'), '42');
      return reply({ url: 'https://cdn.example/song.FLAC?token=1' });
    }
    assert.equal(body.get('id'), 'lyric42');
    assert.equal(body.get('song'), '42');
    return reply({ lyric: '[00:01.00]hello', tlyric: '[00:01.000]你好' });
  });
  const { provider } = await import('../server/providers/yinyueku.mjs');
  const [song] = await provider.search('晴天', 1);
  assert.equal(song.artist, '甲/乙');
  assert.equal(song.duration, 0);
  assert.equal(song.format, '');
  assert.equal((await provider.resolve(song)).url, 'https://cdn.example/song.FLAC?token=1');
  assert.match(await provider.lyrics(song), /\[00:01.00\]你好/);
});

test('Yinyueku rejects non-http placeholders and malformed search schema', async t => {
  await fixtureFetch(t, () => reply({ url: 'None' }));
  const { provider } = await import('../server/providers/yinyueku.mjs');
  await assert.rejects(provider.resolve({ id: 'netease#42#sign#42' }), /直链|地址|URL/);
  await assert.rejects(provider.search('x', 1), /响应|数据|格式/);
});

test('QQ upstream business errors surface instead of looking like no search results', async t => {
  await fixtureFetch(t, () => reply({ code: 0, 'music.search.SearchCgiService.DoSearchForQQMusicMobile': { code: 2001 } }));
  const { provider } = await import('../server/providers/qq.mjs');
  await assert.rejects(provider.search('x', 1), /2001/);
});

test('third-party QQ resolution uses supported quality and does not report bogus URLs', async t => {
  await fixtureFetch(t, url => {
    assert.equal(url.hostname, 'api.vkeys.cn');
    assert.equal(url.searchParams.get('mid'), 'mid42');
    assert.equal(url.searchParams.get('quality'), '14');
    return reply({ code: 200, data: { url: 'https://cdn.example/master.flac?signature=1' } });
  });
  const { thirdPartyResolve } = await import('../server/providers/protocol-crypto.mjs');
  assert.equal((await thirdPartyResolve('qq', 'mid42')).url, 'https://cdn.example/master.flac?signature=1');
});

test('QQ retries transient device throttling and returns recovered search data', async t => {
  let attempts = 0;
  await fixtureFetch(t, () => {
    attempts++;
    return reply(attempts === 1
      ? { code: 0, 'music.search.SearchCgiService.DoSearchForQQMusicMobile': { code: 2001 } }
      : { code: 0, 'music.search.SearchCgiService.DoSearchForQQMusicMobile': { code: 0, data: { body: { item_song: [{ mid: 'recovered', name: '恢复', file: { size_128mp3: 123 }, interval: 12 }] } } } });
  });
  const { provider } = await import('../server/providers/qq.mjs');
  assert.equal((await provider.search('恢复', 1))[0].title, '恢复');
});

test('translated lyrics keep all timestamps when the original line has repeated tags', async () => {
  const { mergeLyrics } = await import('../server/providers/protocol-crypto.mjs');
  assert.equal(mergeLyrics('[00:01.00][00:02.00]hello', '[00:01.000][00:02.000]你好'), '\uFEFF[00:01.00][00:02.00]hello\r\n[00:01.00]你好\r\n[00:02.00]你好\r\n');
});

test('baka redirect resolution never downloads the redirected media while resolving', async t => {
  await fixtureFetch(t, (url, options) => {
    assert.equal(url.hostname, 'api.baka.plus');
    assert.equal(url.searchParams.get('server'), 'kugou');
    assert.equal(url.searchParams.get('id'), 'aBcD');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://cdn.example/song.flac' } });
  });
  const { thirdPartyResolve } = await import('../server/providers/protocol-crypto.mjs');
  assert.equal((await thirdPartyResolve('kugou', 'aBcD')).url, 'https://cdn.example/song.flac');
});

test('cancelled third-party resolution propagates abort without attempting fallback sources', async t => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled by user'));
  await fixtureFetch(t, () => { assert.fail('aborted operation made a network request'); });
  const { thirdPartyResolve } = await import('../server/providers/protocol-crypto.mjs');
  await assert.rejects(thirdPartyResolve('qq', 'mid', { signal: controller.signal }), /cancelled by user/);
});

test('baka accepts a JSON link served as plain text without treating the API URL as media', async t => {
  await fixtureFetch(t, () => reply({ url: 'https://cdn.example/song.mp3' }));
  const { thirdPartyResolve } = await import('../server/providers/protocol-crypto.mjs');
  assert.equal((await thirdPartyResolve('kugou', 'hash')).url, 'https://cdn.example/song.mp3');
});

test('baka rejects error responses even if they advertise a Location header', async t => {
  await fixtureFetch(t, () => new Response(null, { status: 500, headers: { location: 'https://cdn.example/error.mp3' } }));
  const { thirdPartyResolve } = await import('../server/providers/protocol-crypto.mjs');
  assert.equal(await thirdPartyResolve('kugou', 'hash'), null);
});
