import {Converter} from 'opencc-js/t2cn';
const simplify=Converter({from:'tw',to:'cn'});
const names=new Map();
export const normalizeName=value=>{const text=String(value||'');if(names.has(text))return names.get(text);const name=simplify(text.normalize('NFKC')).toLowerCase().replace(/&amp;/g,'&').replace(/[\p{P}\p{Z}\p{S}]/gu,'');names.set(text,name);if(names.size>15000)names.delete(names.keys().next().value);return name;};
const versions=[['live',/\blive\b|现场|演唱会|演唱會|巡演|实况/i],['instrumental',/instrumental|伴奏|纯音乐|純音樂|off\s*vocal/i],['remix',/remix|混音|重新混音/i],['demo',/\bdemo\b|小样|小樣/i],['acoustic',/acoustic|不插电|不插電/i],['cover',/\bcover\b|翻唱/i],['speed',/sped\s*up|slowed|加速|降速|慢速/i]];
export const versionOf=song=>versions.filter(([,re])=>re.test(song?.title||'')).map(([name])=>name).join(',');
export function songIdentity(song){return `${normalizeName(song.title)}|${normalizeName(song.artist)}|${versionOf(song)}`;}
export function platformIdentity(song){const source=song.onlineSource||song.source,id=song.onlineId||song.id;if(!source||source==='local'||!id)return '';return `${source}:${source==='qq'?String(id).split('#')[0]:String(id)}`;}
export function recordingMatch(a,b){
 if(!a?.title||!b?.title||!a?.artist||!b?.artist||/未知歌手|unknown/i.test(a.artist+b.artist))return false;
 if(normalizeName(a.title)!==normalizeName(b.title)||normalizeName(a.artist)!==normalizeName(b.artist)||versionOf(a)!==versionOf(b))return false;
 if(a.duration>0&&b.duration>0&&Math.abs(a.duration-b.duration)>Math.max(6,Math.min(a.duration,b.duration)*.04))return false;
 return true;
}
