const {app,BrowserWindow,protocol,dialog,shell,session,Tray,Menu,nativeImage,ipcMain}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');

app.setName('澄音 CLEAR');
app.setAppUserModelId('cn.clearplayer.desktop');
const profile=process.env.CLEAR_DESKTOP_PROFILE || path.join(app.getPath('appData'),'ClearPlayer');
app.setPath('userData',profile);
protocol.registerSchemesAsPrivileged([{scheme:'clear',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let window,service,tray,quitting=false;

function readBounds(){try{return JSON.parse(fs.readFileSync(path.join(profile,'window.json'),'utf8'));}catch{return {};}}
function focusWindow(){if(window){if(window.isMinimized())window.restore();window.show();window.focus();}}

if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',focusWindow);
  app.on('window-all-closed',()=>app.quit());
  app.on('activate',focusWindow);
  ipcMain.on('clear-window-action',(event,action)=>{
    if(!window || event.sender!==window.webContents)return;
    if(action==='minimize')window.minimize();
    if(action==='maximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}
    if(action==='close')window.close();
  });
  app.on('will-quit',()=>tray?.destroy());
  app.on('before-quit',event=>{
    if(quitting)return;
    event.preventDefault();quitting=true;
    Promise.resolve(service?.close()).catch(error=>console.error(error)).finally(()=>app.quit());
  });
  app.whenReady().then(async()=>{
    fs.mkdirSync(profile,{recursive:true});
    session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    const {startDesktopService}=await import(pathToFileURL(path.join(__dirname,'service.mjs')).href);
    const {createDesktopProtocol}=await import(pathToFileURL(path.join(__dirname,'protocol.mjs')).href);
    service=await startDesktopService(path.join(profile,'downloads'));
    protocol.handle('clear',createDesktopProtocol({dist:path.join(__dirname,'../dist'),apiOrigin:service.origin}));
    const saved=readBounds();
    window=new BrowserWindow({
      width:Math.max(900,Math.min(Number(saved.width)||1440,2560)),
      height:Math.max(650,Math.min(Number(saved.height)||1000,1600)),
      minWidth:760,minHeight:600,frame:false,
      title:'澄音 CLEAR · 音乐播放器',backgroundColor:'#101922',
      icon:path.join(__dirname,'icon.png'),show:false,autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false},
    });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(({url})=>{
      if(/^https?:\/\//i.test(url))void shell.openExternal(url);
      return {action:'deny'};
    });
    window.webContents.on('will-navigate',(event,url)=>{
      try {const target=new URL(url);if(target.protocol==='clear:'&&target.host==='player')return;}catch{}
      event.preventDefault();
    });
    window.on('close',event=>{
      try {fs.writeFileSync(path.join(profile,'window.json'),JSON.stringify({...window.getNormalBounds(),maximized:window.isMaximized()}));}catch(error){console.error(error);}
      if(!quitting){event.preventDefault();window.hide();}
    });
    window.on('closed',()=>{window=null;});
    window.once('ready-to-show',()=>{if(saved.maximized)window.maximize();window.show();});
    const trayIcon=nativeImage.createFromPath(path.join(__dirname,'icon.png')).resize({width:20,height:20});
    tray=new Tray(trayIcon);
    tray.setToolTip('澄音 CLEAR · 点击打开播放器');
    const control=label=>{if(window)void window.webContents.executeJavaScript(`document.querySelector('button[aria-label="${label}"]')?.click()`).catch(console.error);};
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'显示播放器',click:focusWindow},
      {type:'separator'},
      {label:'播放 / 暂停',click:()=>{if(window)void window.webContents.executeJavaScript("document.querySelector('.play-button')?.click()").catch(console.error);}},
      {label:'上一首',click:()=>control('上一首')},
      {label:'下一首',click:()=>control('下一首')},
      {type:'separator'},
      {label:'退出澄音',click:()=>app.quit()},
    ]));
    tray.on('click',focusWindow);
    tray.on('double-click',focusWindow);
    await window.loadURL('clear://player/');
    console.log('CLEAR_DESKTOP_READY');
  }).catch(error=>{
    console.error(error);
    dialog.showErrorBox('澄音暂时无法启动',`${error.message}\n请保留整个桌面版文件夹，再重新打开澄音播放器。`);
    app.quit();
  });
}
