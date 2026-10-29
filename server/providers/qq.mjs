import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { json, form } from './http.mjs';
import { USER_AGENT, httpUrl, mergeLyrics, decodeEntities, thirdPartyResolve } from './protocol-crypto.mjs';

// Public fallback from upstream qq_crypto.leno; registration is rejected by the upstream service.
const QIMEI36 = '6c9d3cd110abca9b16311cee10001e717614';
const API = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const SEARCH = 'music.search.SearchCgiService.DoSearchForQQMusicMobile';
const VKEY = 'music.vkey.GetVkey.UrlGetVkey';
const headers = { 'User-Agent': USER_AGENT, Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com', 'Content-Type': 'application/json' };
const tiers = [['F000', 'flac', 'size_flac'], ['M800', 'mp3', 'size_320mp3'], ['O600', 'ogg', 'size_192ogg'], ['M500', 'mp3', 'size_128mp3']];
async function call(key, ct, param, signal) {
  const split = key.lastIndexOf('.');
  const result = await json(API, { method: 'POST', headers, signal, body: JSON.stringify({
    comm: { ct, cv: 13020508, v: 13020508, QIMEI36, tmeAppID: 'qqmusic', format: 'json', inCharset: '-utf-8', outCharset: '-utf-8', uid: '3931641530' },
    [key]: { module: key.slice(0, split), method: key.slice(split + 1), param },
  }) });
  if (Number(result?.code ?? 0) !== 0 || Number(result?.[key]?.code ?? 0) !== 0) {
    const code = result?.[key]?.code || result?.code;
    const error = new Error(`QQ 音乐接口失败（${code}）`);
    error.code = Number(code);
    throw error;
  }
  if (!result?.[key]?.data) throw new Error('QQ 音乐接口响应格式错误');
  return result[key].data;
}
function parts(song) {
  const [mid, prefix = 'M500'] = String(song.id).split('#');
  return { mid, prefix: prefix || 'M500' };
}
export const provider = {
  id: 'qq', name: 'QQ 音乐',
  async search(query, limit, { signal } = {}) {
    let items;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = await call(SEARCH, 11, { searchid: String(BigInt(Date.now()) * 1000000n + BigInt(randomInt(1000000))), query, search_type: 0, num_per_page: limit, page_num: 1, highlight: 1, grp: 1 }, signal);
        items = data.body?.item_song;
        if (!Array.isArray(items)) throw new Error('QQ 音乐搜索响应格式错误，可能触发限流');
        if (items.length || attempt === 3) break;
      } catch (error) {
        if (error.code !== 2001 || attempt === 3) throw error;
      }
      await sleep(300 * 2 ** attempt, undefined, { signal });
    }
    return items.filter(song => song?.mid && song.name).slice(0, limit).map(song => {
      const tier = tiers.find(tier => Number(song.file?.[tier[2]]) > 0) || ['M500', 'mp3'];
      return { id: song.mid + '#' + tier[0], source: 'qq', title: song.name,
        artist: (song.singer || []).map(artist => artist.name).filter(Boolean).join('/'),
        album: song.album?.name || '', duration: Number(song.interval || 0), format: tier[1],
        data: { paid: Number(song.pay?.pay_down || 0) !== 0 },
      };
    });
  },
  async resolve(song, { signal } = {}) {
    const { mid, prefix } = parts(song);
    const third = await thirdPartyResolve('qq', mid, { signal });
    if (third) return third;
    for (const wanted of [...new Set([prefix, 'M800', 'M500'])]) {
      const extension = tiers.find(tier => tier[0] === wanted)?.[1] || 'mp3';
      const data = await call(VKEY, 19, { guid: '1000000000', songmid: [mid], songtype: [0], uin: '0', loginflag: 1, platform: '20', filename: [wanted + mid + '.' + extension] }, signal);
      const purl = data.midurlinfo?.find(info => info.purl)?.purl;
      if (!purl || !data.sip?.[0]) continue;
      const url = httpUrl(new URL(purl, data.sip[0]).href);
      if (url) return { url, headers: { Referer: headers.Referer, 'User-Agent': USER_AGENT } };
    }
    throw new Error('QQ 音乐未提供可下载直链，可能需要账号权限或资源已失效');
  },
  async lyrics(song, { signal } = {}) {
    const { mid } = parts(song);
    const result = await json('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?' + form({ songmid: mid, format: 'json', g_tk: 5381, loginUin: 0, hostUin: 0, inCharset: 'utf8', outCharset: 'utf-8', notice: 0, platform: 'yqq', needNewCode: 0 }), { signal, headers: { 'User-Agent': USER_AGENT, Referer: 'https://y.qq.com/portal/player.html' } });
    if (Number(result?.retcode) !== 0) throw new Error(`QQ 音乐歌词接口失败（${result?.retcode ?? '响应格式错误'}）`);
    return mergeLyrics(decodeEntities(Buffer.from(result.lyric || '', 'base64').toString('utf8')), decodeEntities(Buffer.from(result.trans || '', 'base64').toString('utf8')));
  },
};
