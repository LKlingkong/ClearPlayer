import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {ReactiveParticles} from './ReactiveParticles';

export function PlaybackAtmosphere({artwork,audioRef,active}:{artwork?:Blob;audioRef:RefObject<HTMLAudioElement|null>;active:boolean}){
  const [layers,setLayers]=useState<{current:string;previous:string}>({current:'',previous:''});
  const current=useRef(''),urls=useRef(new Set<string>()),timers=useRef(new Set<number>());
  useEffect(()=>{
    const previous=current.current;
    const next=artwork?URL.createObjectURL(artwork):'';
    if(next)urls.current.add(next);
    current.current=next;setLayers({current:next,previous});
    const timer=window.setTimeout(()=>{
      if(previous){URL.revokeObjectURL(previous);urls.current.delete(previous);}
      setLayers(value=>value.previous===previous?{...value,previous:''}:value);
      timers.current.delete(timer);
    },1800);timers.current.add(timer);
  },[artwork]);
  useEffect(()=>()=>{for(const timer of timers.current)clearTimeout(timer);for(const url of urls.current)URL.revokeObjectURL(url);timers.current.clear();urls.current.clear();current.current='';},[]);
  return <div className="playback-atmosphere" aria-hidden="true">
    <div className="atmosphere-wash"/>
    <div className="atmosphere-artwork">
      {layers.previous&&<img key={layers.previous} className="atmosphere-cover departing" src={layers.previous} alt=""/>}
      {layers.current&&<img key={layers.current} className="atmosphere-cover arriving" src={layers.current} alt=""/>}
    </div>
    <div className="atmosphere-light atmosphere-light-one"/><div className="atmosphere-light atmosphere-light-two"/>
    <div className="atmosphere-ribbon ribbon-one"/><div className="atmosphere-ribbon ribbon-two"/>
    <div className="atmosphere-music-glow"/>
    <ReactiveParticles audioRef={audioRef} active={active}/>
    <div className="atmosphere-veil"/>
  </div>;
}
