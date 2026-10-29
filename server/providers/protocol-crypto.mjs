// Protocol constants and transformations ported from LenoMusic (Apache-2.0).
import { createCipheriv } from 'node:crypto';
import { json, request, form } from './http.mjs';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const MODULUS = BigInt('0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
const SECOND_KEY = 'xYz9Kq2LmN8pR4sT';
function modularPower(value, power, modulus) {
  let result = 1n;
  while (power > 0n) {
    if (power & 1n) result = result * value % modulus;
    value = value * value % modulus;
    power >>= 1n;
  }
  return result;
}
const encryptedKey = modularPower(BigInt('0x' + Buffer.from([...SECOND_KEY].reverse().join('')).toString('hex')), 65537n, MODULUS).toString(16).padStart(256, '0');
function aesBase64(text, key) {
  const cipher = createCipheriv('aes-128-cbc', key, '0102030405060708');
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
export function weapiBody(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return form({ params: aesBase64(aesBase64(text, '0CoJUm6Qyw8W8jud'), SECOND_KEY), encSecKey: encryptedKey });
}

function lyricTime(tag) {
  const match = tag.match(/^\[(\d+):(\d{2})(?:\.(\d+))?\]$/);
  if (!match) return null;
  return Number(match[1]) * 60000 + Number(match[2]) * 1000 + Math.round(Number('0.' + (match[3] || '0')) * 1000);
}
export function mergeLyrics(original = '', translation = '') {
  if (!original) return '';
  const translated = new Map();
  for (const line of translation.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*((?:\[\d+:\d{2}(?:\.\d+)?\])+)(.*)$/);
    if (!match?.[2]?.trim()) continue;
    for (const tag of match[1].match(/\[[^\]]+\]/g)) translated.set(lyricTime(tag), match[2]);
  }
  const lines = [];
  for (const line of original.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)) {
    lines.push(line);
    const match = line.match(/^\s*((?:\[\d+:\d{2}(?:\.\d+)?\])+)/);
    for (const tag of match?.[1].match(/\[[^\]]+\]/g) || []) {
      if (translated.has(lyricTime(tag))) lines.push(tag + translated.get(lyricTime(tag)));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function httpUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point <= 0x10ffff && point > 0 ? String.fromCodePoint(point) : whole;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
  });
}

const NETEASE_LEVELS = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'];
const QQ_QUALITIES = [14, 13, 12, 11, 10, 9];
let quotaDate = '';
async function tryJson(url, { signal } = {}) {
  signal?.throwIfAborted();
  try { return await json(url, { signal, timeout: 8000, headers: { 'User-Agent': USER_AGENT } }); }
  catch (error) { if (signal?.aborted) throw error; return null; }
}
async function meting(server, id, br, { signal } = {}) {
  signal?.throwIfAborted();
  const endpoint = 'https://api.baka.plus/meting/?' + form({ server, type: 'url', id, br });
  try {
    const response = await request(endpoint, { signal, timeout: 8000, redirect: 'manual', headers: { 'User-Agent': USER_AGENT } });
    let url = response.status >= 300 && response.status < 400 ? httpUrl(response.headers.get('location')) : '';
    if (!url && response.ok && /json|text\/plain/i.test(response.headers.get('content-type') || '')) {
      // Some instances label their JSON as plain text. Keep the response bounded
      // even if an instance unexpectedly streams a whole audio file instead.
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) {
        try {
          while (size <= 65536) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
      }
      if (size <= 65536) {
        try { url = httpUrl(JSON.parse(Buffer.concat(chunks).toString('utf8')).url); } catch { /* Not a JSON link. */ }
      }
    }
    if (response.body && !response.bodyUsed) await response.body.cancel();
    return url && url !== endpoint ? { url } : null;
  } catch (error) { if (signal?.aborted) throw error; return null; }
}
// Only called at download time: search never consumes a third-party quota.
export async function thirdPartyResolve(source, id, options = {}) {
  if (source === 'netease') {
    const today = new Date().toISOString().slice(0, 10);
    if (quotaDate !== today) {
      for (const level of NETEASE_LEVELS) {
        const data = await tryJson('https://music.qinglvai.top/api/index.php?' + form({ route: '/music/url', id, level, use: 'play', source: 'netease' }), options);
        if (Number(data?.code) === 42903) { quotaDate = today; break; }
        const url = Number(data?.code) === 0 && httpUrl(data?.data?.song?.url);
        if (url) return { url };
      }
    }
    const data = await tryJson('https://musicapi.haitangw.net/music/wy.php?' + form({ id, level: 'jymaster', type: 'json' }), options);
    const url = httpUrl(data?.data?.url);
    return url ? { url } : null;
  }
  if (source === 'qq') {
    for (const quality of QQ_QUALITIES) {
      const data = await tryJson('https://api.vkeys.cn/music/tencent/song/link?' + form({ mid: id, quality }), options);
      const url = httpUrl(data?.data?.url);
      if (url) return { url };
    }
    return meting('tencent', id, '999000', options);
  }
  if (source === 'kugou') {
    for (const br of ['2000', '999000']) {
      const result = await meting('kugou', id, br, options);
      if (result) return result;
    }
  }
  return null;
}
