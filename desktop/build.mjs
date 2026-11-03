import {cp,mkdir,writeFile,readFile,rename,stat} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const runtime=resolve(root,'.verification/electron-runtime');
const output=resolve(root,'desktop-app');
const appRoot=join(output,'resources/app');
await stat(join(runtime,'electron.exe'));
await mkdir(output,{recursive:true});
let runtimeReady=false;
try{await stat(join(output,'澄音播放器.exe'));runtimeReady=true;}catch{}
if(!runtimeReady){
  await cp(runtime,output,{recursive:true});
  await rename(join(output,'electron.exe'),join(output,'澄音播放器.exe'));
}
await mkdir(appRoot,{recursive:true});
for(const name of ['dist','server','shared','desktop','licenses'])await cp(join(root,name),join(appRoot,name),{recursive:true});
for(const name of ['THIRD_PARTY_NOTICES.md'])await cp(join(root,name),join(appRoot,name));
await writeFile(join(appRoot,'package.json'),JSON.stringify({name:'clear-desktop-player',productName:'澄音 CLEAR',version:'1.0.0',main:'desktop/main.cjs',description:'澄音本地音乐播放器'},null,2));
const listing=spawnSync(process.execPath,[join(root,'node_modules/npm/bin/npm-cli.js'),'ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8',windowsHide:true});
// npm can be installed beside Node rather than inside this project.
let packages=listing;
if(listing.status!==0)packages=spawnSync(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/c','npm ls --omit=dev --all --parseable']:['ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8',windowsHide:true});
if(packages.status!==0)throw new Error(packages.stderr||'无法读取生产依赖');
for(const directory of packages.stdout.trim().split(/\r?\n/).slice(1)){
  const part=relative(root,directory);
  if(!part.startsWith('node_modules'))continue;
  await cp(directory,join(appRoot,part),{recursive:true});
}
await cp(join(root,'desktop/README.md'),join(output,'使用说明.txt'));
await cp(join(root,'desktop/icon.ico'),join(output,'澄音.ico'));
const compiler=join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const compiled=spawnSync(compiler,['/nologo','/target:winexe','/codepage:65001','/reference:System.Windows.Forms.dll',`/win32icon:${join(root,'desktop/icon.ico')}`,`/out:${join(root,'ClearPlayer.exe')}`,join(root,'desktop/launcher.cs')],{cwd:root,encoding:'utf8',windowsHide:true});
if(compiled.status!==0)throw new Error(compiled.stdout||compiled.stderr||'无法生成桌面启动入口');
console.log(`DESKTOP_BUILD_OK ${join(output,'澄音播放器.exe')}`);
