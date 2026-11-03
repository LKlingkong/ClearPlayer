export function signalEnergy(samples:Float32Array):number{
  if(!samples.length)return 0;
  let squares=0;for(const value of samples)squares+=value*value;
  return Math.min(1,Math.sqrt(squares/samples.length)*3.4);
}
export function smoothEnergy(previous:number,target:number,seconds:number):number{
  if(!Number.isFinite(target)||!Number.isFinite(previous))return 0;
  const ratio=1-Math.exp(-Math.max(0,seconds)/(target>previous ? .065 : .38));
  return Math.max(0,Math.min(1,previous+(target-previous)*ratio));
}

// Analyse a silent side branch of captureStream. The player's original output is untouched.
export class AudioEnergyMeter{
  private audio:HTMLAudioElement;
  private context?:AudioContext;
  private analyser?:AnalyserNode;
  private source?:MediaStreamAudioSourceNode;
  private stream?:MediaStream;
  private samples=new Float32Array(1024);
  private active=false;
  private energy=0;
  private onPlaying=()=>{if(this.active)this.attach();};
  private onLoad=()=>{this.releaseStream();this.energy=0;};
  private onTrack=()=>this.connectStream();
  constructor(audio:HTMLAudioElement){this.audio=audio;audio.addEventListener('playing',this.onPlaying);audio.addEventListener('loadstart',this.onLoad);}
  start(){
    this.active=true;
    try{
      if(!this.context){
        this.context=new AudioContext({latencyHint:'playback'});
        this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;
        const silent=this.context.createGain();silent.gain.value=0;
        this.analyser.connect(silent);silent.connect(this.context.destination);
      }
      void this.context.resume().catch(()=>{});this.attach();
    }catch{/* Unsupported capture or audio analysis must never stop normal playback. */}
  }
  private attach(){
    if(this.stream || !this.context || !this.analyser || this.audio.paused)return;
    try{
      const audio=this.audio as HTMLAudioElement&{captureStream?:()=>MediaStream};
      this.stream=audio.captureStream?.();
      this.stream?.addEventListener('addtrack',this.onTrack);this.connectStream();
    }catch{this.releaseStream();}
  }
  private connectStream(){
    if(this.source || !this.stream || !this.context || !this.analyser || !this.stream.getAudioTracks().some(track=>track.readyState==='live'))return;
    try{this.source=this.context.createMediaStreamSource(this.stream);this.source.connect(this.analyser);}catch{/* A late track can be retried on the next playing event. */}
  }
  read(seconds:number):number{
    let target=0;
    if(this.active && this.analyser && this.context?.state==='running' && !this.audio.paused && !this.audio.ended){
      this.analyser.getFloatTimeDomainData(this.samples);target=signalEnergy(this.samples);
    }
    this.energy=smoothEnergy(this.energy,target,seconds);return this.energy;
  }
  private releaseStream(){
    this.source?.disconnect();this.source=undefined;
    this.stream?.removeEventListener('addtrack',this.onTrack);
    for(const track of this.stream?.getTracks()||[])track.stop();
    this.stream=undefined;
  }
  stop(){this.active=false;this.energy=0;this.releaseStream();void this.context?.suspend().catch(()=>{});}
  dispose(){this.stop();this.audio.removeEventListener('playing',this.onPlaying);this.audio.removeEventListener('loadstart',this.onLoad);void this.context?.close().catch(()=>{});}
}
