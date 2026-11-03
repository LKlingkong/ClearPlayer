export interface SongMetadata {title:string;artist:string;duration?:number;album?:string}
export function normalizeName(value:unknown):string;
export function versionOf(song:SongMetadata):string;
export function songIdentity(song:SongMetadata):string;
export function recordingMatch(a:SongMetadata,b:SongMetadata):boolean;
