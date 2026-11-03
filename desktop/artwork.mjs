import {readdir,realpath,stat,readFile} from 'node:fs/promises';
import {dirname,basename,extname,join} from 'node:path';
import {artworkType} from '../server/artwork.mjs';

// Only sibling artwork of an imported audio file; never return a filesystem path.
export async function findLocalArtwork(audioPath){
  try{
    if(typeof audioPath!=='string' || !/\.(mp3|flac|m4a|ogg|wav)$/i.test(audioPath))return null;
    const audio=await realpath(audioPath);if(!(await stat(audio)).isFile())return null;
    const directory=dirname(audio),stem=basename(audio,extname(audio)).toLowerCase();
    const entries=await readdir(directory,{withFileTypes:true});
    const candidates=entries.filter(entry=>entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name));
    for(const name of [stem,'cover','folder','front']){
      for(const entry of candidates.filter(entry=>basename(entry.name,extname(entry.name)).toLowerCase()===name)){
        const file=await realpath(join(directory,entry.name));if(dirname(file)!==directory)continue;
        const info=await stat(file);if(!info.isFile() || info.size===0 || info.size>20*1024*1024)continue;
        const bytes=await readFile(file);const type=artworkType(bytes);if(type)return {bytes:new Uint8Array(bytes),type};
      }
    }
  }catch{/* A missing or inaccessible sibling cover must never prevent music import. */}
  return null;
}
