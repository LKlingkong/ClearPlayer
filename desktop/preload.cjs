const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('clearDesktop',Object.freeze({
  minimize:()=>ipcRenderer.send('clear-window-action','minimize'),
  maximize:()=>ipcRenderer.send('clear-window-action','maximize'),
  close:()=>ipcRenderer.send('clear-window-action','close'),
}));
