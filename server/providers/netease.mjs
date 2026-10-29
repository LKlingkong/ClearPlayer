import { json } from './http.mjs';
import { USER_AGENT, weapiBody, mergeLyrics, httpUrl, thirdPartyResolve } from './protocol-crypto.mjs';

const headers = { 'User-Agent': USER_AGENT, Referer: 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' };
async function call(path, payload, signal) {
  const result = await json('https://music.163.com/weapi/' + path + '?csrf_token=', { method: 'POST', headers, body: weapiBody(payload), signal });
  if (Number(result?.code) !== 200) throw new Error(`网易云接口失败（${result?.code ?? '响应格式错误'}）`);
  return result;
}
export const provider = {
  id: 'netease', name: '网易云音乐',
  async search(query, limit, { signal } = {}) {
    const result = await call('search/get', { s: query, type: '1', limit: String(limit), offset: '0' }, signal);
    const songs = result.result?.songs;
    if (!songs && Number(result.result?.songCount) === 0) return [];
    if (!Array.isArray(songs)) throw new Error('网易云搜索响应格式错误');
    return songs.filter(song => song?.id && song.name).slice(0, limit).map(song => ({
      id: String(song.id), source: 'netease', title: song.name,
      artist: (song.artists || song.ar || []).map(artist => artist.name).filter(Boolean).join('/'),
      album: (song.album || song.al)?.name || '', duration: Number(song.duration || song.dt || 0) / 1000, format: 'mp3',
    }));
  },
  async resolve(song, { signal } = {}) {
    const third = await thirdPartyResolve('netease', song.id, { signal });
    if (third) return third;
    const result = await call('song/enhance/player/url/v1', { ids: JSON.stringify([Number(song.id)]), level: 'exhigh', encodeType: 'mp3' }, signal);
    const item = result.data?.find(item => String(item.id) === String(song.id));
    const url = httpUrl(item?.url);
    if (!url) throw new Error(`网易云未提供可下载直链（${item?.code ?? '可能需要账号权限或资源已失效'}）`);
    return { url, headers: { Referer: headers.Referer, 'User-Agent': USER_AGENT } };
  },
  async lyrics(song, { signal } = {}) {
    const result = await call('song/lyric', { id: String(song.id), lv: '-1', kv: '-1', tv: '-1', csrf_token: '' }, signal);
    return mergeLyrics(result.lrc?.lyric || '', result.tlyric?.lyric || '');
  },
};
