import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

const response = (data, init) => new Response(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data, init);
async function withFetch(fn, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('Kuwo custom DES agrees with upstream golden blocks and mandatory extra padding', async () => {
  const { encryptQuery } = await import('../server/providers/kuwo-des.mjs');
  for (const [input, expected] of [
    ['A', 'lRB6F4cFq24='], ['ABCDEFG', 'c728gu5BkTk='],
    ['ABCDEFGH', 'oPA67H8m9vRqY0iIU+Qd0Q=='], ['ABCDEFGHI', 'oPA67H8m9vSBuxSWuOFBNQ=='],
    ['0123456789abcdef', 'dH2+2xud1kpIPHpNmEyB+2pjSIhT5B3R'],
  ]) assert.equal(encryptQuery(input), expected);
});

test('Kuwo search encodes keywords and picks the largest playable standard format', async () => {
  const { provider } = await import('../server/providers/kuwo.mjs');
  await withFetch(async (url) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'www.kuwo.cn');
    assert.equal(u.searchParams.get('all'), '青衣 & 风');
    assert.equal(u.searchParams.get('rn'), '2');
    return response({ abslist: [null, { SONGNAME: 'invalid' }, {
      MUSICRID: 'MUSIC_123', SONGNAME: '青衣', ARTIST: '歌手', ALBUM: '专辑', DURATION: '245',
      MINFO: 'level:s,format:flac,size:24Mb;level:h,format:mp3,size:999.06Kb;level:z,format:zp,size:zpMb',
      N_MINFO: 'format:mflac,size:90Mb',
    }] });
  }, async () => {
    const songs = await provider.search('青衣 & 风', 2);
    assert.deepEqual(songs.map(({ data, ...song }) => song), [{ id: '123', source: 'kuwo', title: '青衣', artist: '歌手', album: '专辑', duration: 245, format: 'flac' }]);
  });
});

test('Kuwo official resolve uses its encrypted query and falls from flac to mp3', async () => {
  const { provider } = await import('../server/providers/kuwo.mjs');
  const { decryptQuery } = await import('../server/providers/kuwo-des.mjs');
  const formats = [];
  await withFetch(async (url, opts) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'mobi.kuwo.cn');
    assert.equal(opts.headers['User-Agent'], 'okhttp/3.10.0');
    const plain = decryptQuery(u.searchParams.get('q'));
    assert.match(plain, /&rid=123$/);
    formats.push(new URLSearchParams(plain).get('format'));
    return response(formats.length === 1 ? '' : 'format=mp3\nurl=http://cdn.kuwo.cn/test.mp3?bitrate$320&format$mp3');
  }, async () => assert.equal((await provider.resolve({ id: '123' })).url, 'http://cdn.kuwo.cn/test.mp3?bitrate'));
  assert.deepEqual(formats, ['flac', 'mp3']);
});

test('Kuwo lyrics decodes the compressed GB18030 body and sends the required referer', async () => {
  const { provider } = await import('../server/providers/kuwo.mjs');
  await withFetch(async (url, opts) => {
    const u = new URL(url);
    const encoded = Buffer.from(decodeURIComponent(u.search.slice(1)), 'base64');
    const plain = Buffer.from(encoded.map((b, i) => b ^ Buffer.from('yeelion')[i % 7])).toString();
    assert.equal(plain, 'user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_123');
    assert.equal(opts.headers.Referer, 'http://www.kuwo.cn/');
    return response(Buffer.concat([Buffer.from('tp=content\r\npath=1\r\n\r\n'), deflateSync(Buffer.concat([Buffer.from('[00:01.00]'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3])]))]));
  }, async () => assert.equal(await provider.lyrics({ id: '123' }), '[00:01.00]你好'));
});

test('Kugou search keeps case sensitive hashes and chooses free audio tiers', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async url => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('keyword'), 'Hello & 音乐');
    return response({ status: 1, data: { info: [{ hash: 'BaseHash', sqhash: 'FlacHash', sqfilesize: 5000000, pay_type_sq: 0, price_sq: 0, sqprivilege: 0, songname: 'Hello', singername: 'Singer', album_name: 'Album', duration: 120 }, { hash: 'PaidHash', filesize: 6000000, pay_type: 1, songname: 'Paid', duration: 80 }] } });
  }, async () => {
    const songs = await provider.search('Hello & 音乐', 2);
    assert.deepEqual(songs.map(({ data, ...song }) => song), [
      { id: 'FlacHash', source: 'kugou', title: 'Hello', artist: 'Singer', album: 'Album', duration: 120, format: 'flac' },
      { id: 'PaidHash', source: 'kugou', title: 'Paid', artist: '', album: '', duration: 80, format: '' },
    ]);
  });
});

test('Kugou resolve signs the exact case hash and reads mp3Url rather than url', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async url => {
    const u = new URL(url);
    assert.equal(u.hostname, 'trackercdn.kugou.com');
    assert.equal(u.searchParams.get('hash'), 'AbC123');
    assert.equal(u.searchParams.get('key'), '5a98dba06f49499283e804d1c87b055f');
    return response({ status: 1, mp3Url: ['', 'https://cdn.kugou.com/song.flac'] });
  }, async () => assert.deepEqual(await provider.resolve({ id: 'AbC123' }), { url: 'https://cdn.kugou.com/song.flac' }));
});

test('Kugou lyrics exchanges candidate accesskey and preserves UTF8 lyric text', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async url => {
    const u = new URL(url);
    if (u.hostname === 'krcs.kugou.com') {
      assert.equal(u.searchParams.get('keyword'), 'Hello - Singer');
      assert.equal(u.searchParams.get('hash'), 'AbC123');
      assert.equal(u.searchParams.get('duration'), '120');
      return response({ candidates: [{ id: '9', accesskey: 'key&value' }] });
    }
    assert.equal(u.searchParams.get('accesskey'), 'key&value');
    assert.equal(u.searchParams.get('fmt'), 'lrc');
    return response({ status: 200, content: Buffer.from('\ufeff[ti:Hello]\n[00:01.20]你好世界').toString('base64') });
  }, async () => assert.equal(await provider.lyrics({ id: 'AbC123', title: 'Hello', artist: 'Singer', duration: 120 }), '\ufeff[ti:Hello]\n[00:01.20]你好世界'));
});

test('Kugou search falls back from invalid mobile TLS to the verified web route', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  const hosts = [];
  await withFetch(async url => {
    const u = new URL(url);
    hosts.push(u.hostname);
    if (u.hostname === 'mobilecdn.kugou.com') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } });
    assert.equal(u.hostname, 'songsearch.kugou.com');
    assert.equal(u.searchParams.get('keyword'), 'Hello');
    return response({ status: 1, data: { lists: [{ FileHash: 'WebBase', FileSize: 4000, PayType: 0, Price: 0, Privilege: 0, SQFileHash: 'WebSq', SQFileSize: 8000, SQPayType: 3, SQPrice: 200, SQPrivilege: 10, SongName: 'Hello', SingerName: 'Singer', AlbumName: 'Album', Duration: 123 }] } });
  }, async () => {
    const songs = await provider.search('Hello', 1);
    assert.deepEqual(songs.map(({ data, ...song }) => song), [{ id: 'WebBase', source: 'kugou', title: 'Hello', artist: 'Singer', album: 'Album', duration: 123, format: 'mp3' }]);
  });
  assert.deepEqual(hosts, ['mobilecdn.kugou.com', 'songsearch.kugou.com']);
});

test('Kugou third party resolve reads redirects without downloading the target audio', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async (url, options) => {
    const u = new URL(url);
    if (u.hostname === 'trackercdn.kugou.com') return response({ status: 2, mp3Url: [] });
    assert.equal(u.hostname, 'api.baka.plus');
    assert.equal(options.redirect, 'manual');
    assert.equal(u.searchParams.get('server'), 'kugou');
    return new Response(null, { status: 302, headers: { location: 'https://cdn.kugou.com/free.flac' } });
  }, async () => assert.deepEqual(await provider.resolve({ id: 'FreeHash' }), { url: 'https://cdn.kugou.com/free.flac' }));
});

test('Kuwo skips error responses even if their text contains a download URL', async () => {
  const { provider } = await import('../server/providers/kuwo.mjs');
  await withFetch(async url => {
    const u = new URL(url);
    if (u.hostname === 'mobi.kuwo.cn') return response('url=https://wrong.invalid/error.mp3', { status: 403 });
    if (u.hostname === 'music.nxinxz.com') return response({ data: { url: 'https://cdn.kuwo.cn/real.mp3' } });
    throw new Error('Unexpected request');
  }, async () => assert.deepEqual(await provider.resolve({ id: '123' }), { url: 'https://cdn.kuwo.cn/real.mp3' }));
});

test('Kugou refuses Location headers attached to upstream error responses', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async url => new URL(url).hostname === 'trackercdn.kugou.com'
    ? response({ status: 2 }) : response('', { status: 503, headers: { location: 'https://wrong.invalid/error.mp3' } }),
  async () => assert.rejects(provider.resolve({ id: 'NoAccess' }), /酷狗暂时无法提供/));
});

test('Kugou preserves actionable TLS error if its verified fallback also fails', async () => {
  const { provider } = await import('../server/providers/kugou.mjs');
  await withFetch(async () => { throw Object.assign(new Error('TLS error'), { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }); },
  async () => assert.rejects(provider.search('Hello', 1), /安全证书无效/));
});

test('Cancelling a provider request does not start additional fallback requests', async () => {
  const { provider: kuwo } = await import('../server/providers/kuwo.mjs');
  const { provider: kugou } = await import('../server/providers/kugou.mjs');
  for (const provider of [kuwo, kugou]) {
    const controller = new AbortController();
    let calls = 0;
    await withFetch(async () => {
      calls++;
      controller.abort(new Error('cancelled by user'));
      throw controller.signal.reason;
    }, async () => assert.rejects(provider.resolve({ id: '123' }, { signal: controller.signal }), /cancelled by user/));
    assert.equal(calls, 1);
  }
});
