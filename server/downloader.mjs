import { open, readFile, writeFile, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { parseFile } from 'music-metadata';

const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
function privateAddress(value) {
  const ip=value.toLowerCase();
  // URL canonicalization converts mapped IPv4 into hex; reject the whole family.
  if(ip.startsWith('::ffff:')) return true;
  if (isIP(ip)===4) {
    const [a,b]=ip.split('.').map(Number);
    return a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127);
  }
  return ip==='::' || ip==='::1' || /^(fc|fd|fe[89ab])/.test(ip);
}
export async function validateRemoteUrl(value, allowLocal=false) {
  let url;
  try { url=new URL(value); } catch {throw new Error('音频下载地址无效');}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('音频下载地址无效');
  if (!allowLocal) {
    const host=url.hostname.replace(/^\[|\]$/g,'');
    if (host==='localhost' || host.endsWith('.localhost') || privateAddress(host)) throw new Error('音频地址不能指向本地网络');
    const addresses=isIP(host) ? [{address:host}] : await lookup(host,{all:true});
    if (!addresses.length || addresses.some(({address})=>privateAddress(address))) throw new Error('音频地址不能指向本地网络');
  }
  return url.href;
}
function signature(bytes) {
  if (bytes.subarray(0,3).toString()==='ID3' || (bytes[0]===255 && (bytes[1]&0xe0)===0xe0)) return 'mp3';
  if (bytes.subarray(0,4).toString()==='fLaC') return 'flac';
  if (bytes.subarray(0,4).toString()==='OggS') return 'ogg';
  if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WAVE') return 'wav';
  if (bytes.subarray(4,8).toString()==='ftyp') return 'm4a';
  return '';
}
async function validateAudio(path,expectedDuration=0) {
  const file=await open(path,'r');
  let prefix;
  try {prefix=Buffer.alloc(32);await file.read(prefix,0,32,0);} finally {await file.close();}
  const format=signature(prefix);
  if (!format) throw new Error('返回内容不是有效音频，可能是过期链接或错误网页');
  let metadata;
  try {metadata=await parseFile(path,{duration:true,skipCovers:true});}
  catch {throw new Error('音频格式或时长无法验证，请换一个版本重试');}
  if (!metadata.format.container || !(metadata.format.duration>0) || metadata.format.hasVideo) throw new Error('音频格式或时长无法验证，请换一个版本重试');
  // ADTS AAC shares the MPEG sync prefix; it must never acquire an .mp3 suffix.
  if(format==='mp3' && (metadata.format.container!=='MPEG' || !/Layer 3/.test(metadata.format.codec||''))) throw new Error('音频实际格式暂不支持，请换一个版本重试');
  if(expectedDuration>=60 && metadata.format.duration<expectedDuration*0.75 && expectedDuration-metadata.format.duration>20) throw new Error('音源只返回了试听片段或不完整音频，请换一个版本');
  return format;
}
async function fetchPinned(value,headers,signal) {
  const url=new URL(value);const host=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length || addresses.some(({address})=>privateAddress(address))) throw new Error('音频地址不能指向本地网络');
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
      headers,signal,agent:false,
      // Pin the addresses that were checked, rather than resolving again at connection time.
      lookup:(_hostname,options,done)=>options.all ? done(null,addresses) : done(null,addresses[0].address,addresses[0].family),
    },incoming=>{
      const body=[204,205,304].includes(incoming.statusCode)?null:Readable.toWeb(incoming);
      resolve(new Response(body,{status:incoming.statusCode,headers:incoming.headers}));
      if(!body)incoming.resume();
    });
    request.on('error',reject);request.end();
  });
}
async function fetchAudio(url,headers,signal,allowLocal) {
  let current=url;
  for(let hop=0;hop<6;hop++) {
    current=await validateRemoteUrl(current,allowLocal);
    const response=allowLocal ? await fetch(current,{headers,signal,redirect:'manual'}) : await fetchPinned(current,headers,signal);
    if ([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');await response.body?.cancel();
      if (!location) throw new Error('音频跳转地址无效');
      current=new URL(location,current).href;continue;
    }
    return response;
  }
  throw new Error('音频下载跳转次数过多');
}

export async function downloadAudio({url,headers={},dest,signal,onProgress=()=>{},allowLocal=false,expectedDuration=0}) {
  signal?.throwIfAborted();
  let existing=0, previous={};
  try {existing=(await stat(dest)).size;previous=JSON.parse(await readFile(dest+'.json','utf8'));} catch {existing=0;}
  // Without a validator it is safer to restart than join two different recordings.
  let offset=existing && (previous.etag || previous.lastModified) ? existing : 0;
  const requestHeaders={...headers};
  if (offset) {requestHeaders.Range=`bytes=${offset}-`;requestHeaders['If-Range']=previous.etag || previous.lastModified;}
  const timeout=AbortSignal.timeout(180000);
  const combined=signal ? AbortSignal.any([signal,timeout]) : timeout;
  const response=await fetchAudio(url,requestHeaders,combined,allowLocal);
  if (response.status===416) {
    const total=Number(/^bytes \*\/(\d+)$/.exec(response.headers.get('content-range')||'')?.[1]);
    await response.body?.cancel();
    if (offset>0 && total===offset && previous.total===total) {
      return {path:dest,bytes:offset,format:await validateAudio(dest,expectedDuration)};
    }
    throw new Error('续传范围与远端音频长度不一致，请重试');
  }
  if (![200,206].includes(response.status)) {await response.body?.cancel();throw new Error(`音频下载失败（HTTP ${response.status}），请重试或换一个版本`);}
  const type=response.headers.get('content-type') || '';
  if (/text\/|json|xml|html/i.test(type)) {await response.body?.cancel();throw new Error('下载地址返回了网页而不是音频');}
  let total=0;
  if (response.status===200) {offset=0;total=Number(response.headers.get('content-length'))||0;}
  else {
    const parts=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
    if (!parts || Number(parts[1])!==offset || Number(parts[2])<offset || Number(parts[2])>=Number(parts[3]) || (offset && previous.total && Number(parts[3])!==previous.total)) {
      await response.body?.cancel();throw new Error('音频续传响应范围不正确');
    }
    total=Number(parts[3]);
    const etag=response.headers.get('etag');
    if (offset && previous.etag && etag && previous.etag!==etag) {await response.body?.cancel();throw new Error('音频在续传期间发生变化，请重新下载');}
  }
  if (total>MAX_AUDIO_BYTES || offset>MAX_AUDIO_BYTES) {await response.body?.cancel();throw new Error('音频超过 256 MB，请选择较小的版本');}
  await writeFile(dest+'.json',JSON.stringify({url,total,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')}));
  const file=await open(dest,offset?'a':'w');
  let received=offset;
  try {
    onProgress(received,total);
    if (!response.body) throw new Error('音频响应为空');
    for await (const chunk of response.body) {
      combined.throwIfAborted();
      received+=chunk.byteLength;
      if (received>MAX_AUDIO_BYTES || (total && received>total)) throw new Error('音频下载长度异常');
      await file.write(chunk);onProgress(received,total);
    }
  } finally {await file.close();}
  combined.throwIfAborted();
  if (!received || (total && received!==total)) throw new Error('音频下载不完整，请重试续传');
  return {path:dest,bytes:received,format:await validateAudio(dest,expectedDuration)};
}
