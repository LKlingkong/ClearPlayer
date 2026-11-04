import {normalizeName,recordingMatch,songIdentity,platformIdentity} from '../../shared/music-identity.mjs';
import type {Track} from '../types';
export interface SongRef {id:string;source:string;title:string;artist:string;album:string;duration:number;key?:string;format?:string;tags?:string[];artworkUrl?:string;reason?:string;seed?:string;unavailable?:boolean;relation?:'similar'|'style'|'playlist'|'artist'}
export interface PlaylistEntry extends SongRef {uid:string;localId?:string;jobId?:string;status?:'pending'|'preparing'|'queued'|'downloading'|'paused'|'ready'|'failed';error?:string;attempts?:number;restore?:boolean}
export interface PersonalPlaylist {id:string;name:string;entries:PlaylistEntry[];source?:string;sourceId?:string;sourceUrl?:string;cover?:string;tags?:string[];createdAt:number;updatedAt:number;paused:boolean;description?:string;total?:number}
export interface PlaylistPreview {name:string;source:string;sourceId:string;sourceUrl:string;cover?:string;tags:string[];songs:SongRef[];total:number;complete:boolean;warnings:string[]}
export interface ListeningStat {seconds:number;plays:number;completed:number;skips:number;lastPlayed:number}
export type ListeningStats=Record<string,ListeningStat>;
export interface Preferences {exploration:number;tags:string[];disliked:string[];hiddenArtists:string[];liked?:string[]}
export interface RadarSong extends SongRef {localId?:string;reason:string}
export interface RadarSnapshot {day:string;batch:number;songs:RadarSong[];warnings:string[];generatedAt:number;exploration:number;recallVersion?:number;newCount?:number}
export interface DiscoveryState {playlists:PersonalPlaylist[];stats:ListeningStats;preferences:Preferences;radar?:RadarSnapshot;version:1}
export const initialDiscovery=():DiscoveryState=>({version:1,playlists:[],stats:{},preferences:{exploration:70,tags:[],disliked:[],hiddenArtists:[]}});
export const dayKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function prioritizeEntries<T extends SongRef>(entries:T[],keys:Set<string>):T[]{return [...entries].sort((a,b)=>Number(keys.has(songIdentity(b)))-Number(keys.has(songIdentity(a))));}
export function measureListening(previous:number,current:number,playing:boolean,elapsed:number){const delta=current-previous;return playing&&delta>0&&delta<=Math.max(1.5,elapsed+0.7)?Math.min(delta,Math.max(0,elapsed)+.2):0;}
export function mergePlaylist<T extends {name:string;entries:PlaylistEntry[]}>(playlist:T,preview:{songs:SongRef[]}):T{
 const seen=new Set(playlist.entries.map(e=>`${e.source}:${e.id}`));
 const additions=preview.songs.filter(s=>{const key=`${s.source}:${s.id}`;if(seen.has(key))return false;seen.add(key);return true;}).map(s=>({...s,uid:crypto.randomUUID(),status:'pending' as const}));
 const recovered=new Map(preview.songs.filter(s=>!s.unavailable).map(s=>[`${s.source}:${s.id}`,s]));
 const entries=playlist.entries.map(e=>{const song=recovered.get(`${e.source}:${e.id}`);return e.unavailable&&song?{...e,...song,uid:e.uid,unavailable:false,status:'pending' as const,error:undefined,jobId:undefined}:e;});
 return {...playlist,entries:[...entries,...additions]};
}
export function buildTaste(tracks:Pick<Track,'title'|'artist'|'album'|'duration'|'id'|'favorite'|'tags'|'onlineSource'|'onlineId'>[],stats:ListeningStats,tags:string[]){
 const scored=tracks.map(t=>({track:t,weight:(t.favorite?6:0)+Math.min(8,(stats[songIdentity(t)]?.seconds||0)/180)+Math.min(5,stats[songIdentity(t)]?.completed||0)-Math.min(8,(stats[songIdentity(t)]?.skips||0)*2)})).sort((a,b)=>b.weight-a.weight);
 const artists=new Set<string>(),distinct=scored.filter(x=>{const a=normalizeName(x.track.artist);if(artists.has(a))return false;artists.add(a);return true;});
 const selected=[...distinct,...scored.filter(x=>!distinct.includes(x))].slice(0,6);
 return {seeds:selected.map(x=>x.track),tags:[...new Set([...tags,...scored.slice(0,12).flatMap(x=>x.track.tags||[])])].slice(0,12)};
}
function jitter(value:string){let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0)/4294967296;}
export function rankRadar(candidates:SongRef[],tracks:Track[],stats:ListeningStats,prefs:Preferences,seed:string,count=30):RadarSong[]{
 const blocked=new Set(prefs.disliked),artists=new Set(prefs.hiddenArtists.map(normalizeName));
 const seen=new Set<string>();
 const allowed=(s:SongRef)=>!blocked.has(songIdentity(s))&&!artists.has(normalizeName(s.artist));
 const favoriteArtists=new Set(tracks.filter(t=>t.favorite).map(t=>normalizeName(t.artist)));
 const knownIds=new Set(tracks.map(platformIdentity).filter(Boolean));
 const news=candidates.filter(s=>{const id=songIdentity(s);if(!allowed(s)||seen.has(id)||knownIds.has(platformIdentity(s))||tracks.some(t=>recordingMatch(t,s))||stats[id]?.seconds>10)return false;seen.add(id);return true;}).map(s=>({...s,reason:s.reason||`循着${s.seed?`「${s.seed}」`:'你的偏好'}发现的声音`}))
 .sort((a,b)=>{const weights={similar:4,playlist:3,style:2,artist:0};const score=(s:SongRef)=>(s.relation?weights[s.relation]:2)+(favoriteArtists.has(normalizeName(s.artist))?.2:0)+jitter(seed+songIdentity(s));return score(b)-score(a);});
 const olds=tracks.filter(t=>allowed({...t,source:'local'})).map(t=>({id:t.id,source:'local',title:t.title,artist:t.artist,album:t.album,duration:t.duration,localId:t.id,tags:t.tags,reason:t.favorite?'你的偏爱，值得重听':'从曲库里重新遇见'}))
 .sort((a,b)=>{const score=(s:RadarSong)=>jitter(seed+s.id)*5-(Date.now()-(stats[songIdentity(s)]?.lastPlayed||0)<3600000?8:0);return score(b)-score(a);});
 const newCount=Math.round(count*Math.max(0,Math.min(100,prefs.exploration))/100),oldCount=count-newCount;
 const artistCounts=new Map<string,number>(),selected:typeof news=[],rest:typeof news=[];
 for(const s of news){const a=normalizeName(s.artist);if((artistCounts.get(a)||0)<3){selected.push(s);artistCounts.set(a,(artistCounts.get(a)||0)+1);}else rest.push(s);}
 const n=[...selected,...rest].slice(0,newCount),o=olds.slice(0,oldCount),result:RadarSong[]=[];
 while(n.length||o.length){for(let i=0;i<2&&n.length;i++)result.push(n.shift()!);if(o.length)result.push(o.shift()!);if(!n.length){result.push(...o);break;}}
 return result;
}
