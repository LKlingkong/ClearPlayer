export {};
declare global {
  interface Window {
    clearDesktop?: {minimize:()=>void;maximize:()=>void;close:()=>void;findArtwork:(file:File)=>Promise<{bytes:Uint8Array;type:string}|null>;onVisibility:(callback:(visible:boolean)=>void)=>()=>void};
  }
}
