import {useEffect} from 'react';
import type {RefObject} from 'react';
import type {Track} from '../types';
import type {ListeningStat} from '../lib/discovery';
import {measureListening} from '../lib/discovery';
import {songIdentity} from '../../shared/music-identity.mjs';

export function useListening(audioRef:RefObject<HTMLAudioElement|null>,track:Track|undefined,record:(key:string,delta:Partial<ListeningStat>)=>void,enabled:boolean){
 useEffect(()=>{
  const audio=audioRef.current;if(!audio||!track||!enabled)return;
  const key=songIdentity(track);let last=audio.currentTime,wall=performance.now(),seconds=0,pending=0,counted=false,completed=false,finished=false;
  const sample=()=>{
   const now=performance.now(),time=audio.currentTime,delta=measureListening(last,time,!audio.paused&&!audio.seeking,(now-wall)/1000);last=time;wall=now;
   if(delta){seconds+=delta;pending+=delta;if(!counted){record(key,{plays:1,lastPlayed:Date.now()});counted=true;}}
   const length=Number.isFinite(audio.duration)?audio.duration:track.duration;
   if(!completed&&length>0&&seconds>=Math.min(length*.8,240)){record(key,{completed:1});completed=true;}
   if(pending>=10){record(key,{seconds:pending,lastPlayed:Date.now()});pending=0;}
  };
  const flush=()=>{if(pending){record(key,{seconds:pending,lastPlayed:Date.now()});pending=0;}};
  const seek=()=>{last=audio.currentTime;wall=performance.now();};
  const play=()=>{if(finished){seconds=0;counted=false;completed=false;finished=false;}seek();};
  const end=()=>{sample();flush();finished=true;};
  const pause=()=>{flush();seek();};
  audio.addEventListener('timeupdate',sample);audio.addEventListener('seeking',seek);audio.addEventListener('seeked',seek);audio.addEventListener('play',play);audio.addEventListener('pause',pause);audio.addEventListener('ended',end);
  const timer=setInterval(sample,1000);
  return()=>{clearInterval(timer);flush();if(!finished&&!completed&&seconds>=3&&seconds<Math.min(30,(track.duration||180)*.2))record(key,{skips:1});audio.removeEventListener('timeupdate',sample);audio.removeEventListener('seeking',seek);audio.removeEventListener('seeked',seek);audio.removeEventListener('play',play);audio.removeEventListener('pause',pause);audio.removeEventListener('ended',end);};
 },[audioRef,track?.id,enabled,record]);
}
