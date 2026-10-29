// Adapted from LenoMusic's kuwo_core / kuwo_lyric (Apache-2.0).
import { inflateSync } from 'node:zlib';
import { request, json } from './http.mjs';
import { encryptQuery } from './kuwo-des.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36';
const formats = new Set(['mp3', 'flac', 'm4a', 'ogg', 'wav']);
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const link = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
function bestFormat(minfo) {
  let best = -1;
  let result = '';
  for (const level of text(minfo).split(';')) {
    const fields = Object.fromEntries(level.split(',').map(field => field.split(':').map(s => s.trim())));
    const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b)$/i.exec(fields.size ?? '');
    const size = match ? Number(match[1]) * ({ b: 1, kb: 1024, mb: 1048576, gb: 1073741824 })[match[2].toLowerCase()] : -1;
    const format = (fields.format ?? '').toLowerCase();
    if (formats.has(format) && size > best) { result = format; best = size; }
  }
  return result;
}
function options(signal, headers = {}) { return { signal, headers: { 'User-Agent': UA, ...headers } }; }
function checkAbort(signal, error) { if (signal?.aborted || error?.name === 'AbortError') throw error; }

export const provider = {
  id: 'kuwo', name: '酷我音乐',
  async search(query, limit, { signal } = {}) {
    const url = new URL('http://www.kuwo.cn/search/searchMusicBykeyWord');
    url.search = new URLSearchParams({ vipver: '1', client: 'kt', ft: 'music', cluster: '0', strategy: '2012', encoding: 'utf8', rformat: 'json', mobi: '1', issubtitle: '1', show_copyright_off: '1', pn: '0', rn: String(limit), all: query }).toString();
    const payload = await json(url, options(signal));
    if (!Array.isArray(payload?.abslist)) throw new Error('酷我搜索接口返回异常，请稍后重试。');
    return payload.abslist.filter(s => s && text(s.MUSICRID)).slice(0, limit).map(s => ({
      id: text(s.MUSICRID).replace(/^MUSIC_/, ''), source: 'kuwo', title: text(s.SONGNAME), artist: text(s.ARTIST), album: text(s.ALBUM), duration: Math.max(0, Number(s.DURATION) || 0), format: bestFormat(s.MINFO),
    }));
  },
  async resolve(song, { signal } = {}) {
    let lastError;
    for (const format of ['flac', 'mp3']) {
      try {
        const plain = `user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format=${format}&rid=${song.id}`;
        const url = `http://mobi.kuwo.cn/mobi.s?f=kuwo&q=${encodeURIComponent(encryptQuery(plain))}`;
        const response = await request(url, options(signal, { 'User-Agent': 'okhttp/3.10.0' }));
        if (!response.ok) { await response.body?.cancel(); continue; }
        const body = await response.text();
        for (const line of body.split(/\r?\n/)) {
          if (!line.trim().startsWith('url=')) continue;
          const url = link(line.trim().slice(4).split(/[$\s]/)[0]);
          if (url) return { url };
        }
      } catch (error) { checkAbort(signal, error); lastError = error; }
    }
    for (const base of ['http://music.nxinxz.com/kw.php', 'https://musicapi.haitangw.net/music/kw.php']) {
      try {
        const url = new URL(base);
        url.search = new URLSearchParams({ id: song.id, level: 'lossless', type: 'json' }).toString();
        const data = await json(url, options(signal));
        const direct = link(data?.data?.url);
        if (direct) return { url: direct };
      } catch (error) { checkAbort(signal, error); lastError = error; }
    }
    throw new Error(`酷我暂时无法提供该歌曲的下载地址，可能需要付费或接口已失效。${lastError ? ` ${lastError.message}` : ''}`);
  },
  async lyrics(song, { signal } = {}) {
    const plain = Buffer.from(`user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${song.id}`);
    const key = Buffer.from('yeelion');
    const encrypted = Buffer.from(plain.map((b, i) => b ^ key[i % key.length])).toString('base64').replaceAll('+', '%2B');
    const response = await request(`http://newlyric.kuwo.cn/newlyric.lrc?${encrypted}`, options(signal, { Referer: 'http://www.kuwo.cn/' }));
    if (!response.ok) throw new Error(`酷我歌词接口暂不可用（HTTP ${response.status}）`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.subarray(0, 10).toString().toLowerCase().startsWith('tp=content')) return '';
    let index = body.indexOf('\r\n\r\n');
    let skip = 4;
    if (index < 0) { index = body.indexOf('\n\n'); skip = 2; }
    if (index < 0) return '';
    try {
      return new TextDecoder('gb18030').decode(inflateSync(body.subarray(index + skip), { maxOutputLength: 2 * 1024 * 1024 }));
    } catch { return ''; }
  },
};
