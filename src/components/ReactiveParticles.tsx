import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {AudioEnergyMeter} from '../lib/audioEnergy';

interface Particle{x:number;y:number;size:number;speed:number;phase:number;gold:boolean}
export function ReactiveParticles({audioRef,active}:{audioRef:RefObject<HTMLAudioElement|null>;active:boolean}){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const meter=useRef<AudioEnergyMeter|null>(null);
  const particles=useRef<Particle[]>([]);
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const query=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches);
    query.addEventListener('change',change);return()=>query.removeEventListener('change',change);
  },[]);
  useEffect(()=>()=>{meter.current?.dispose();meter.current=null;},[]);
  useEffect(()=>{
    const canvas=canvasRef.current,context=canvas?.getContext('2d');if(!canvas||!context)return;
    const atmosphere=canvas.closest<HTMLElement>('.playback-atmosphere');
    let frame=0,last=0,width=0,height=0,elapsed=0;
    const resize=()=>{
      width=canvas.clientWidth;height=canvas.clientHeight;
      const ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));context.setTransform(ratio,0,0,ratio,0,0);
      if(!particles.current.length)particles.current=Array.from({length:Math.max(38,Math.min(90,Math.round(width*height/18000)))},()=>({x:Math.random(),y:Math.random(),size:.65+Math.random()*1.7,speed:6+Math.random()*15,phase:Math.random()*Math.PI*2,gold:Math.random()<.72}));
    };
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    const draw=(delta:number,energy:number)=>{
      context.clearRect(0,0,width,height);elapsed+=delta;
      for(const particle of particles.current){
        particle.y-=delta*particle.speed*(.85+energy*3.3)/Math.max(height,1);
        particle.x+=Math.sin(elapsed*.3+particle.phase)*delta*(5+energy*12)/Math.max(width,1);
        if(particle.y<-.02){particle.y=1.02;particle.x=Math.random();}
        const x=particle.x*width,y=particle.y*height,size=particle.size*(1+energy*.9);
        const alpha=(.25+energy*.6)*(.65+.35*Math.sin(elapsed*.6+particle.phase));
        if(energy>.12){context.strokeStyle=particle.gold?`rgba(222,190,126,${alpha*.24})`:`rgba(151,219,219,${alpha*.2})`;context.lineWidth=Math.max(.4,size*.4);context.beginPath();context.moveTo(x,y);context.lineTo(x-Math.sin(elapsed*.3+particle.phase)*energy*8,y+energy*14);context.stroke();}
        context.fillStyle=particle.gold?`rgba(222,190,126,${alpha})`:`rgba(151,219,219,${alpha})`;
        context.beginPath();context.arc(x,y,size,0,Math.PI*2);context.fill();
        if(particle.size>1.9){context.fillStyle=`rgba(232,207,153,${alpha*.13})`;context.beginPath();context.arc(x,y,size*3.8,0,Math.PI*2);context.fill();}
      }
    };
    if(active&&!reduced){
      if(!meter.current&&audioRef.current)meter.current=new AudioEnergyMeter(audioRef.current);
      meter.current?.start();
      const tick=(now:number)=>{
        frame=requestAnimationFrame(tick);
        if(last && now-last<1000/30)return;
        const delta=last?Math.min((now-last)/1000,.1):1/30;last=now;
        const energy=meter.current?.read(delta)||0;
        atmosphere?.style.setProperty('--audio-energy',energy.toFixed(3));draw(delta,energy);
      };frame=requestAnimationFrame(tick);
    }else{meter.current?.stop();atmosphere?.style.setProperty('--audio-energy','0');if(!reduced)draw(0,0);else context.clearRect(0,0,width,height);}
    return()=>{cancelAnimationFrame(frame);observer.disconnect();meter.current?.stop();atmosphere?.style.setProperty('--audio-energy','0');};
  },[active,reduced,audioRef]);
  return <canvas ref={canvasRef} className="reactive-particles" aria-hidden="true"/>;
}
