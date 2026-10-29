import { json, request, form } from './http.mjs';
import { USER_AGENT, httpUrl, mergeLyrics } from './protocol-crypto.mjs';

const API = 'http://yinyueku.cn/api.php';
const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' };
function fields(song) {
  if (song.data) return song.data;
  const [upstream, id, sign = '', lyricId] = String(song.id).split('#');
  return { upstream, id, sign, lyricId: lyricId || id };
}
function options(body, signal) { return { method: 'POST', headers, body: form(body), signal }; }
export const provider = {
  id: 'yinyueku', name: '音乐库',
  async search(query, limit, { signal } = {}) {
    const items = await json(API, options({ types: 'search', count: limit, pages: 1, name: query }, signal));
    if (!Array.isArray(items)) throw new Error('音乐库搜索响应数据格式错误');
    return items.filter(song => song?.id && song.source).slice(0, limit).map(song => ({
      id: [song.source, song.id, song.sign || '', song.lyric_id || song.id].join('#'), source: 'yinyueku', title: song.name || '',
      artist: Array.isArray(song.artist) ? song.artist.filter(Boolean).join('/') : String(song.artist || ''), album: song.album || '',
      duration: 0, format: '', data: { upstream: song.source, id: String(song.id), sign: song.sign || '', lyricId: String(song.lyric_id || song.id) },
    }));
  },
  async resolve(song, { signal } = {}) {
    const data = fields(song);
    if (!data.upstream || !data.id) throw new Error('音乐库歌曲数据缺失，无法获取直链');
    const response = await request(API, options({ types: 'url', id: data.id, source: data.upstream, sign: data.sign }, signal));
    if (!response.ok) throw new Error(`音乐库取链失败（HTTP ${response.status}）`);
    const text = await response.text();
    let value;
    try { value = JSON.parse(text)?.url; } catch { value = text.trim(); }
    const url = httpUrl(value);
    if (!url) throw new Error('音乐库未提供有效下载直链，签名可能已过期');
    return { url };
  },
  async lyrics(song, { signal } = {}) {
    const data = fields(song);
    const result = await json(API, options({ types: 'lyric', id: data.lyricId || data.id, source: data.upstream, song: data.id, sign: data.sign }, signal));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('音乐库歌词响应格式错误');
    if (result.error || result.code && ![0, 200].includes(Number(result.code))) throw new Error(`音乐库歌词失败（${result.message || result.msg || result.code}）`);
    return mergeLyrics(result.lyric || '', result.tlyric || '');
  },
};
