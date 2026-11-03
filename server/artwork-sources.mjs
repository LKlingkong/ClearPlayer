// Search only official endpoints; callers enforce response limits and timeouts.
const apple=country=>({
  source:'Apple Music',label:`Apple Music (${country})`,
  async search(metadata,json){
    const url=new URL('https://itunes.apple.com/search');
    url.search=new URLSearchParams({term:[metadata.title,metadata.artist].filter(Boolean).join(' '),entity:'song',country,limit:'12'}).toString();
    const data=await json(url.href);
    return (Array.isArray(data.results)?data.results:[]).slice(0,12).map(item=>({title:item.trackName,artist:item.artistName,album:item.collectionName,url:item.artworkUrl100,duration:item.trackTimeMillis/1000}));
  },
});
const netease={source:'网易云音乐',label:'网易云音乐',async search(metadata,json){
  const data=await json('https://music.163.com/api/cloudsearch/pc',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:'https://music.163.com/'},
    body:new URLSearchParams({s:[metadata.title,metadata.artist].filter(Boolean).join(' '),type:'1',limit:'12',offset:'0'}).toString(),
  });
  if(data.code && data.code!==200)throw new Error('搜索暂不可用');
  return (Array.isArray(data.result?.songs)?data.result.songs:[]).slice(0,12).map(item=>({title:item.name,artist:(item.ar||item.artists||[]).map(a=>a.name).join(' / '),album:(item.al||item.album)?.name,url:(item.al||item.album)?.picUrl,duration:(item.dt||item.duration)/1000}));
}};
const qq={source:'QQ 音乐',label:'QQ 音乐',async search(metadata,json){
  const data=await json('https://u.y.qq.com/cgi-bin/musicu.fcg',{
    method:'POST',headers:{'Content-Type':'application/json',Referer:'https://y.qq.com/',Origin:'https://y.qq.com','User-Agent':'Mozilla/5.0'},
    body:JSON.stringify({comm:{ct:11,cv:13020508,v:13020508,QIMEI36:'6c9d3cd110abca9b16311cee10001e717614',tmeAppID:'qqmusic',format:'json',inCharset:'-utf-8',outCharset:'-utf-8',uid:'3931641530'},req:{module:'music.search.SearchCgiService',method:'DoSearchForQQMusicMobile',param:{query:[metadata.title,metadata.artist].filter(Boolean).join(' '),searchid:String(BigInt(Date.now())*1000000n),search_type:0,num_per_page:12,page_num:1,highlight:0,grp:1}}}),
  });
  if(data.code || data.req?.code)throw new Error('搜索暂不可用');
  const songs=data.req?.data?.body?.item_song||data.req?.data?.body?.song?.list;
  return (Array.isArray(songs)?songs:[]).slice(0,12).map(item=>({title:item.name,artist:(item.singer||[]).map(a=>a.name).join(' / '),album:item.album?.name,
    url:/^[a-zA-Z0-9]{1,80}$/.test(item.album?.mid||'')?`https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`:undefined,duration:item.interval}));
}};
// Regions are sequential, so a batch cannot fan out into a regional request storm.
export const artworkSources=[apple('cn'),apple('hk'),netease,qq,apple('tw'),apple('us'),apple('jp')];
