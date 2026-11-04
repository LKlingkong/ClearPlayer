import {cp,mkdir,mkdtemp,readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('发布版本号无效');
if(process.platform!=='win32')throw new Error('请在 Windows 上打包桌面便携版');
const name=`ClearPlayer-v${version}-win-x64`;
const releases=join(root,'.verification/releases');await mkdir(releases,{recursive:true});
const run=await mkdtemp(join(releases,'release-')),portable=join(run,name),desktop=join(portable,'desktop-app');
await mkdir(desktop,{recursive:true});
await cp(join(root,'ClearPlayer.exe'),join(portable,'ClearPlayer.exe'));
// Reuse the verified runtime, excluding local logs and the merged application directory.
for(const entry of await readdir(join(root,'desktop-app'),{withFileTypes:true})){
  if(entry.name==='resources'||/\.log$/i.test(entry.name))continue;
  await cp(join(root,'desktop-app',entry.name),join(desktop,entry.name),{recursive:true});
}
const source=join(root,'desktop-app/resources/app'),target=join(desktop,'resources/app');
await mkdir(target,{recursive:true});
for(const entry of await readdir(source,{withFileTypes:true})){
  if(entry.name==='dist'||/\.log$/i.test(entry.name))continue;
  await cp(join(source,entry.name),join(target,entry.name),{recursive:true});
}
// Vite's clean output avoids shipping obsolete chunks from incremental local builds.
await cp(join(root,'dist'),join(target,'dist'),{recursive:true});
await cp(join(root,'desktop/README.md'),join(portable,'使用说明.txt'));
await cp(join(root,'THIRD_PARTY_NOTICES.md'),join(portable,'THIRD_PARTY_NOTICES.md'));
await cp(join(root,'CHANGELOG.md'),join(portable,'CHANGELOG.md'));
const zip=join(run,`${name}.zip`),literal=value=>"'"+value.replaceAll("'","''")+"'";
const command=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base=${literal(portable)}
$archive=[IO.Compression.ZipFile]::Open(${literal(zip)},[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach($file in [IO.Directory]::EnumerateFiles($base,'*',[IO.SearchOption]::AllDirectories)){
    $entry=${literal(name+'/')}+$file.Substring($base.Length+1).Replace([char]92,[char]47)
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file,$entry,[IO.Compression.CompressionLevel]::Optimal)
  }
}finally{$archive.Dispose()}`;
const zipped=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8'});
if(zipped.status!==0)throw new Error(zipped.stderr||zipped.stdout||'无法创建发布压缩包');
const hash=createHash('sha256');for await(const chunk of createReadStream(zip))hash.update(chunk);
const sha256=hash.digest('hex'),checksums=join(run,'SHA256SUMS.txt');await writeFile(checksums,`${sha256}  ${name}.zip\n`);
await writeFile(join(releases,'latest-build.json'),JSON.stringify({version,portable,zip,checksums,sha256,bytes:(await stat(zip)).size},null,2));
console.log(JSON.stringify({version,zip,checksums,sha256,bytes:(await stat(zip)).size}));
