const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('clearDesktop',Object.freeze({
  minimize:()=>ipcRenderer.send('clear-window-action','minimize'),
  maximize:()=>ipcRenderer.send('clear-window-action','maximize'),
  close:()=>ipcRenderer.send('clear-window-action','close'),
  findArtwork:file=>{
    const path=webUtils.getPathForFile(file);
    return path?ipcRenderer.invoke('clear-local-artwork',path):Promise.resolve(null);
  },
  onVisibility:callback=>{
    if(typeof callback!=='function')return()=>{};
    const listener=(_event,visible)=>callback(visible===true);
    ipcRenderer.on('clear-window-visibility',listener);
    ipcRenderer.send('clear-window-visibility-request');
    return()=>ipcRenderer.removeListener('clear-window-visibility',listener);
  },
}));
