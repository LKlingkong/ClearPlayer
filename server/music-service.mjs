import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { downloadAudio } from './downloader.mjs';

function publicSong(song) {
  const {key,id,source,title,artist,album,duration,format}=song;
  return {key,id,source,title,artist,album,duration,format};
}
function publicJob(job) {
  const {id,status,received,total,filename,hasLyrics,error,lyricError,createdAt}=job;
  return {id,song:publicSong(job.song),status,received,total,filename,hasLyrics,error,lyricError,createdAt};
}
function safeName(value) {
  return String(value||'未命名').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,85) || '未命名';
}
function readableError(error) {
  const code=error?.cause?.code || error?.code || '';
  if (/CERT|SSL|TLS/.test(code)) return '下载服务器证书无效，请换一个音源或版本';
  if (error?.name==='TimeoutError') return '下载超时，保留了未完成文件，可以重试';
  if (error?.message==='fetch failed') return '连接下载服务器失败，请检查网络后重试';
  if (/ENOSPC/.test(code)) return '磁盘空间不足，请清理空间后重试';
  return String(error?.message || '下载失败，请重试').slice(0,300);
}
async function withinBudget(run,signal,milliseconds) {
  const deadline=AbortSignal.timeout(milliseconds);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  combined.throwIfAborted();
  let onAbort;
  const aborted=new Promise((_,reject)=>{
    onAbort=()=>reject(signal?.aborted ? signal.reason : new Error('音源响应超时，请稍后重试或切换音源'));
    combined.addEventListener('abort',onAbort,{once:true});
  });
  try{return await Promise.race([run(combined),aborted]);}
  finally{combined.removeEventListener('abort',onAbort);}
}

export class MusicService {
  constructor({directory,providers,allowLocal=false,concurrency=2,searchTimeout=18000}) {
    this.directory=directory;this.providers=new Map(providers.map(p=>[p.id,p]));
    this.allowLocal=allowLocal;this.concurrency=concurrency;this.searchTimeout=searchTimeout;this.catalog=new Map();this.jobs=new Map();
    this.active=new Map();this.pendingWrite=Promise.resolve();this.closing=false;this.controls=new Map();
  }
  async init() {
    await mkdir(this.directory,{recursive:true});
    let saved=[];
    try {saved=JSON.parse(await readFile(join(this.directory,'.history.json'),'utf8'));}
    catch(error) {if(error.code!=='ENOENT') {await rename(join(this.directory,'.history.json'),join(this.directory,`.history-invalid-${Date.now()}.json`)).catch(()=>{});}}
    if(Array.isArray(saved)) for(const job of saved.slice(-200)) {
      if(!/^[a-f0-9-]{36}$/.test(job?.id||'') || !this.providers.has(job?.song?.source)) continue;
      if(job.filename && basename(job.filename)!==job.filename) continue;
      if(!['completed','failed','cancelled','paused'].includes(job.status)) {job.status='paused';job.error='上次下载未完成，点击继续下载';}
      if(job.status==='completed') {
        try {await stat(this.file(job,'audio'));} catch {job.status='failed';job.error='本地音频文件已被移动或删除，请重新下载';}
      }
      this.jobs.set(job.id,job);
    }
  }
  sources(){return [...this.providers.values()].map(({id,name})=>({id,name}));}
  list(){return [...this.jobs.values()].map(publicJob).reverse();}
  get(id){const job=this.jobs.get(id);return job ? publicJob(job) : undefined;}
  async search(query,source='all',limit=20,signal) {
    query=String(query||'').trim();
    if(!query || query.length>150) throw new Error('请输入 1–150 个字的歌曲或歌手');
    const selected=source==='all' ? [...this.providers.values()] : [this.providers.get(source)].filter(Boolean);
    if(!selected.length) throw new Error('请选择有效音源');
    const result=await Promise.allSettled(selected.map(p=>withinBudget(bounded=>p.search(query,limit,{signal:bounded}),signal,this.searchTimeout)));
    const songs=[],warnings=[];
    result.forEach((r,i)=>{
      if(r.status==='rejected'){warnings.push(`${selected[i].name}：${readableError(r.reason)}`);return;}
      for(const song of r.value.slice(0,limit)) {
        if(!song.id || !song.title) continue;
        song.source=selected[i].id;
        song.key=createHash('sha256').update(`${song.source}:${song.id}`).digest('hex').slice(0,32);
        this.catalog.set(song.key,song);songs.push(publicSong(song));
      }
    });
    while(this.catalog.size>2000) this.catalog.delete(this.catalog.keys().next().value);
    return {songs,warnings};
  }
  async create(key,wantLyrics=true) {
    const song=this.catalog.get(key);
    if(!song) throw new Error('搜索结果已过期，请重新搜索后下载');
    const existing=[...this.jobs.values()].find(j=>j.song.key===key && !['failed','cancelled'].includes(j.status));
    if(existing) return publicJob(existing);
    if(this.jobs.size>=200) {
      const oldest=[...this.jobs.values()].find(j=>['completed','cancelled','failed'].includes(j.status));
      if(!oldest) throw new Error('下载任务过多，请等待当前任务完成');
      this.jobs.delete(oldest.id);
    }
    const job={id:randomUUID(),song:structuredClone(song),wantLyrics:wantLyrics!==false,status:'queued',received:0,total:0,hasLyrics:false,createdAt:Date.now()};
    this.jobs.set(job.id,job);await this.persist();this.pump();return publicJob(job);
  }
  file(job,kind) {
    if(kind==='audio' && job.filename && basename(job.filename)===job.filename) return join(this.directory,job.filename);
    if(kind==='lyrics' && job.filename && basename(job.filename)===job.filename) return join(this.directory,job.filename.replace(/\.[^.]+$/,'.lrc'));
    throw new Error('本地文件不可用');
  }
  partial(job){return join(this.directory,job.id+'.part');}
  async persist() {
    const data=JSON.stringify([...this.jobs.values()]);
    this.pendingWrite=this.pendingWrite.catch(()=>{}).then(async()=>{
      const target=join(this.directory,'.history.json');await writeFile(target+'.tmp',data);await rename(target+'.tmp',target);
    });
    return this.pendingWrite;
  }
  pump() {
    if(this.closing) return;
    for(const job of this.jobs.values()) {
      if(this.active.size>=this.concurrency) break;
      if(job.status!=='queued' || this.active.has(job.id)) continue;
      const controller=new AbortController();
      const promise=this.run(job,controller.signal).finally(async()=>{
        this.active.delete(job.id);await this.persist().catch(error=>console.error('下载历史保存失败：',error.message));this.pump();
      });
      this.active.set(job.id,{controller,promise});
    }
  }
  async run(job,signal) {
    const provider=this.providers.get(job.song.source);
    try {
      job.status='resolving';delete job.error;delete job.lyricError;
      const resolved=await withinBudget(bounded=>provider.resolve(job.song,{signal:bounded}),signal,45000);signal.throwIfAborted();
      if(!resolved?.url) throw new Error('未找到可下载的完整音频，请尝试其他音源或版本');
      job.status='downloading';
      const result=await downloadAudio({url:resolved.url,headers:resolved.headers,dest:this.partial(job),signal,expectedDuration:job.song.duration,allowLocal:this.allowLocal,onProgress:(received,total)=>{job.received=received;job.total=total;}});
      signal.throwIfAborted();
      job.filename=`${safeName(job.song.title)} - ${safeName(job.song.artist)} [${job.id.slice(0,8)}].${result.format}`;
      await rename(this.partial(job),this.file(job,'audio'));
      await rm(this.partial(job)+'.json',{force:true});job.received=result.bytes;job.total=result.bytes;job.song.format=result.format;
      if(job.wantLyrics) {
        try {
          const lyrics=await withinBudget(bounded=>provider.lyrics(job.song,{signal:bounded}),signal,12000);
          if(lyrics?.trim()) {await writeFile(this.file(job,'lyrics'),lyrics,'utf8');job.hasLyrics=true;}
          else job.lyricError='此版本暂时没有可用歌词';
        } catch(error) {job.lyricError=readableError(error);}
      }
      // Audio is already safely saved. Cancellation while lyrics are pending must not hide it.
      job.status='completed';
    } catch(error) {
      if(signal.aborted) {job.status=signal.reason?.message==='cancelled'?'cancelled':'paused';}
      else {job.status='failed';job.error=readableError(error);}
    }
  }
  async control(id,action) {
    const before=this.controls.get(id)||Promise.resolve();
    const operation=before.catch(()=>{}).then(()=>this.applyControl(id,action));
    this.controls.set(id,operation);
    try {return await operation;} finally {if(this.controls.get(id)===operation)this.controls.delete(id);}
  }
  async applyControl(id,action) {
    const job=this.jobs.get(id);if(!job) return undefined;
    if(!['pause','resume','cancel','retry'].includes(action)) throw new Error('下载操作无效');
    if(job.status==='completed') return publicJob(job);
    const active=this.active.get(id);
    if(active) {active.controller.abort(new Error(action==='cancel'?'cancelled':'paused'));await active.promise;}
    if(job.status==='completed') return publicJob(job);
    if(action==='pause') job.status='paused';
    if(action==='cancel') {job.status='cancelled';await Promise.all([rm(this.partial(job),{force:true}),rm(this.partial(job)+'.json',{force:true})]);job.received=0;}
    if(action==='resume' || action==='retry') {job.status='queued';delete job.error;}
    await this.persist();this.pump();return publicJob(job);
  }
  async close() {
    this.closing=true;
    for(const {controller} of this.active.values()) controller.abort(new Error('paused'));
    await Promise.allSettled([...this.active.values()].map(a=>a.promise));await this.persist();
  }
}
