import {Converter} from 'opencc-js';
const simplify=Converter({from:'t',to:'cn'});
export const normalize=value=>simplify(String(value||'').normalize('NFKC')).toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export const unknownArtist=value=>!value?.trim() || /^(未知歌手|未知艺术家|unknown( artist)?|various artists)$/i.test(value.trim());
const aliases=new Map([
  ['jaychou','周杰伦'],['easonchan','陈奕迅'],['jjlin','林俊杰'],['jolintsai','蔡依林'],
  ['stefaniesun','孙燕姿'],['fayewong','王菲'],['jackycheung','张学友'],['andylau','刘德华'],
  ['gem','邓紫棋'],['davidtao','陶喆'],['leehomwang','王力宏'],['mayday','五月天'],
].map(([a,b])=>[normalize(a),normalize(b)]));
const singer=value=>aliases.get(normalize(value))||normalize(value);
function singers(value){
  return String(value||'').split(/\s*(?:\/|&|、|,|;|，|；|\bfeat\.?|\bft\.?)\s*/i).filter(Boolean).map(part=>{
    const main=part.replace(/[（(][^）)]*[）)]/g,'');
    const names=[main,...[...part.matchAll(/[（(]([^）)]*)[）)]/g)].map(match=>match[1])].map(singer).filter(Boolean);
    return [...new Set(names)];
  });
}
const versions=value=>{
  const text=simplify(String(value||'')).toLowerCase();
  return ['live','remix','cover','instrumental','acoustic','demo','karaoke','remaster'].filter(kind=>({
    live:/\blive\b|现场|演唱会/,remix:/\bremix\b|混音/,cover:/\bcover\b|翻唱/,instrumental:/\binstrumental\b|纯音乐|伴奏/,
    acoustic:/\bacoustic\b|不插电/,demo:/\bdemo\b|小样/,karaoke:/\bkaraoke\b|卡拉ok/,remaster:/\bremaster(?:ed)?\b|重制/,
  }[kind]).test(text)).join(',');
};
const core=value=>normalize(String(value||'').replace(/[（(\[].*?[）)\]]/g,part=>versions(part)?'':part).replace(/\s*[-–—]\s*(?:live|remix|cover|instrumental|acoustic|demo|remastered).*$/i,''));
export function confidence(metadata,item){
  if(normalize(metadata.title)!==normalize(item.title) && core(metadata.title)!==core(item.title))return null;
  const expected=singers(metadata.artist),actual=singers(item.artist);
  const artistMatch=!unknownArtist(metadata.artist) && expected.length===actual.length && expected.every(a=>actual.some(b=>a.some(name=>b.includes(name))));
  const knownAlbum=metadata.album && !/^(未知专辑|unknown( album)?)$/i.test(metadata.album.trim());
  const albumMatch=!knownAlbum || normalize(metadata.album)===normalize(item.album);
  const versionMatch=versions(metadata.title)===versions(item.title) && versions(metadata.album)===versions(item.album);
  const duration=Number(metadata.duration),other=Number(item.duration);
  const durationMatch=!(duration>0 && other>0) || Math.abs(duration-other)<=Math.max(5,duration*0.025);
  return artistMatch && albumMatch && versionMatch && durationMatch?'high':'review';
}
