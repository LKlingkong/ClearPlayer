// Adapted from LenoMusic's kugou_core / kugou_lyric / thirdparty (Apache-2.0).
import { createHash } from 'node:crypto';
import { request, json } from './http.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36';
const opts = signal => ({ signal, headers: { 'User-Agent': UA } });
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const link = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
function tier(song, hash, size, pay, price, privilege) {
  return text(song[hash]) && Number(song[size]) > 0 && !Number(song[pay] ?? 0) && !Number(song[price] ?? 0) && !Number(song[privilege] ?? 0);
}
function checkAbort(signal, error) { if (signal?.aborted || error?.name === 'AbortError') throw error; }

export const provider = {
  id: 'kugou', name: '酷狗音乐',
  async search(query, limit, { signal } = {}) {
    const url = new URL('https://mobilecdn.kugou.com/api/v3/search/song');
    url.search = new URLSearchParams({ format: 'json', keyword: query, page: '1', pagesize: String(limit), showtype: '1' }).toString();
    let rows;
    let mobileError;
    try {
      const payload = await json(url, opts(signal));
      if (!Array.isArray(payload?.data?.info)) throw new Error('酷狗搜索接口返回异常，请稍后重试。');
      rows = payload.data.info;
    } catch (error) { checkAbort(signal, error); mobileError = error; }
    if (!rows) {
      try {
        // Public Web search was verified with TLS enabled; it uses capitalized fields.
        const fallback = new URL('https://songsearch.kugou.com/song_search_v2');
        fallback.search = new URLSearchParams({ format: 'json', keyword: query, platform: 'WebFilter', page: '1', pagesize: String(limit) }).toString();
        const payload = await json(fallback, opts(signal));
        if (!Array.isArray(payload?.data?.lists)) throw new Error('酷狗备用搜索接口返回异常。');
        rows = payload.data.lists.filter(s => s && typeof s === 'object').map(s => ({
          hash: s.FileHash, filesize: s.FileSize, pay_type: s.PayType, price: s.Price, privilege: s.Privilege,
          sqhash: s.SQFileHash, sqfilesize: s.SQFileSize, pay_type_sq: s.SQPayType, price_sq: s.SQPrice, sqprivilege: s.SQPrivilege,
          '320hash': s.HQFileHash, '320filesize': s.HQFileSize, pay_type_320: s.HQPayType, price_320: s.HQPrice, '320privilege': s.HQPrivilege,
          songname: s.SongName, singername: s.SingerName, album_name: s.AlbumName, duration: s.Duration,
        }));
      } catch (error) {
        checkAbort(signal, error);
        throw new Error(`酷狗搜索暂不可用：${mobileError.message}；备用接口：${error.message}`, { cause: error });
      }
    }
    return rows.filter(s => s && text(s.hash)).slice(0, limit).map(s => {
      let id = text(s.hash);
      let format = '';
      if (tier(s, 'sqhash', 'sqfilesize', 'pay_type_sq', 'price_sq', 'sqprivilege')) { id = text(s.sqhash); format = 'flac'; }
      else if (tier(s, '320hash', '320filesize', 'pay_type_320', 'price_320', '320privilege')) { id = text(s['320hash']); format = 'mp3'; }
      else if (tier(s, 'hash', 'filesize', 'pay_type', 'price', 'privilege')) format = 'mp3';
      return { id, source: 'kugou', title: text(s.songname), artist: text(s.singername), album: text(s.album_name), duration: Math.max(0, Number(s.duration) || 0), format };
    });
  },
  async resolve(song, { signal } = {}) {
    let lastError;
    try {
      const url = new URL('https://trackercdn.kugou.com/i/v2/');
      const key = createHash('md5').update(`${song.id}kgcloudv2`).digest('hex');
      url.search = new URLSearchParams({ cdnBackup: '1', behavior: 'download', pid: '1', cmd: '21', appid: '1001', hash: song.id, key }).toString();
      const data = await json(url, opts(signal));
      if (Number(data?.status) === 1 && Array.isArray(data.mp3Url)) {
        const direct = data.mp3Url.map(link).find(Boolean);
        if (direct) return { url: direct };
      }
    } catch (error) { checkAbort(signal, error); lastError = error; }
    for (const br of ['2000', '999000']) {
      try {
        const url = new URL('https://api.baka.plus/meting/');
        url.search = new URLSearchParams({ server: 'kugou', type: 'url', id: song.id, br }).toString();
        const response = await request(url, { ...opts(signal), redirect: 'manual' });
        let direct = response.status >= 300 && response.status < 400 ? link(response.headers.get('location')) : '';
        if (!direct && response.ok) {
          const body = await response.text();
          if (body.trim().startsWith('{')) direct = link(JSON.parse(body)?.url);
        } else await response.body?.cancel();
        if (direct && direct !== String(url)) return { url: direct };
      } catch (error) { checkAbort(signal, error); lastError = error; }
    }
    throw new Error(`酷狗暂时无法提供该歌曲的下载地址，可能需要付费或接口已失效。${lastError ? ` ${lastError.message}` : ''}`);
  },
  async lyrics(song, { signal } = {}) {
    const search = new URL('https://krcs.kugou.com/search');
    search.search = new URLSearchParams({ ver: '1', man: 'yes', client: 'mobi', keyword: `${song.title} - ${song.artist}`, duration: String(song.duration || 0), hash: song.id }).toString();
    const data = await json(search, opts(signal));
    const candidate = data?.candidates?.find(c => c?.id && c?.accesskey);
    if (!candidate) return '';
    const download = new URL('https://lyrics.kugou.com/download');
    download.search = new URLSearchParams({ ver: '1', client: 'pc', id: String(candidate.id), accesskey: candidate.accesskey, fmt: 'lrc', charset: 'utf8' }).toString();
    const payload = await json(download, opts(signal));
    if (Number(payload?.status) !== 200 || typeof payload.content !== 'string') return '';
    const lrc = Buffer.from(payload.content, 'base64').toString('utf8');
    return /\[\d{1,3}:\d{2}(?:[.:]\d+)?\]/.test(lrc) ? lrc : '';
  },
};
