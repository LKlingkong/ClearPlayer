export type ArtworkOutcome='filled'|'review'|'missing'|'error'|'skipped';
export interface ArtworkBatchProgress{total:number;done:number;filled:number;review:number;missing:number;errors:number;cancelled:boolean;items:{id:string;status:ArtworkOutcome}[]}
export const emptyArtworkProgress=():ArtworkBatchProgress=>({total:0,done:0,filled:0,review:0,missing:0,errors:0,cancelled:false,items:[]});
export async function runArtworkBatch<T extends{id:string;artwork?:Blob}>(tracks:T[],lookup:(track:T,signal:AbortSignal)=>Promise<ArtworkOutcome>,options:{signal:AbortSignal;delay?:number;onProgress?:(progress:ArtworkBatchProgress)=>void}):Promise<ArtworkBatchProgress>{
  const pending=tracks.filter(track=>!track.artwork),progress={...emptyArtworkProgress(),total:pending.length};
  const publish=()=>options.onProgress?.({...progress,items:[...progress.items]});publish();
  for(const track of pending){
    if(options.signal.aborted)break;
    let status:ArtworkOutcome;
    try{status=await lookup(track,options.signal);}catch{status='error';}
    if(options.signal.aborted)break;
    progress.done++;progress.items.push({id:track.id,status});
    if(status==='filled')progress.filled++;if(status==='review')progress.review++;if(status==='missing')progress.missing++;if(status==='error')progress.errors++;
    publish();
    if(options.delay!==0 && progress.done<pending.length && !options.signal.aborted)await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);options.signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,options.delay??400);options.signal.addEventListener('abort',done,{once:true});
    });
  }
  progress.cancelled=options.signal.aborted;return {...progress,items:[...progress.items]};
}
