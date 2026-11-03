import type {Track} from '../types';
import {fileStem} from './library';

export async function validArtwork(blob:Blob):Promise<boolean>{
  if(!blob.size || blob.size>20*1024*1024)return false;
  try{const image=await createImageBitmap(blob);const valid=image.width>0&&image.height>0&&image.width<=10000&&image.height<=10000;image.close();return valid;}catch{return false;}
}

export async function localArtwork(track:Track,files:File[]=[]):Promise<Blob|undefined>{
  const pictures=files.filter(file=>/\.(jpe?g|png|webp)$/i.test(file.name));
  for(const stem of [fileStem(track.file.name),'cover','folder','front']){
    const cover=pictures.find(file=>fileStem(file.name)===stem);
    if(cover && await validArtwork(cover))return cover;
  }
  try{
    const cover=await window.clearDesktop?.findArtwork(track.file);
    if(cover){const blob=new Blob([new Uint8Array(cover.bytes)],{type:cover.type});if(await validArtwork(blob))return blob;}
  }catch{/* Imported or restored blobs may have no native path. */}
}
