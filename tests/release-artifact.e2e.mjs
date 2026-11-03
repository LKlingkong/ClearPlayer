import assert from 'node:assert/strict';
import {readFile,mkdtemp,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {_electron} from '@playwright/test';

const root=resolve('.'),releaseRoot=join(root,'.verification/releases');
const build=JSON.parse(await readFile(join(releaseRoot,'latest-build.json'),'utf8'));
for(const path of [build.zip,build.portable,build.checksums])assert.ok(resolve(path).startsWith(releaseRoot+sep),'release paths must stay inside the project release folder');
const version=JSON.parse(await readFile('package.json','utf8')).version;assert.equal(build.version,version);
const hash=createHash('sha256');for await(const chunk of createReadStream(build.zip))hash.update(chunk);const sha256=hash.digest('hex');
assert.equal(sha256,build.sha256);assert.ok((await readFile(build.checksums,'utf8')).startsWith(sha256+'  '));
const verification=await mkdtemp(join(releaseRoot,'verify-')),literal=value=>"'"+value.replaceAll("'","''")+"'",name=`ClearPlayer-v${version}-win-x64`;
const command=`Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead(${literal(build.zip)})
try {
  if($archive.Entries.Count -lt 30){throw 'Incomplete archive'}
  $bad=$archive.Entries | Where-Object { $_.FullName -match '(^|/)(downloads|IndexedDB|Cache|\\.verification|\\.env)(/|$)|(^|/)debug\\.log$' }
  if($bad){throw 'Local data found in release archive'}
  if(!($archive.Entries | Where-Object {$_.FullName -eq ${literal(name+'/ClearPlayer.exe')}})){throw 'Launcher missing'}
  if(!($archive.Entries | Where-Object {$_.FullName -eq ${literal(name+'/desktop-app/澄音播放器.exe')}})){throw 'Desktop runtime missing'}
  Write-Output ('ARCHIVE_FILES='+$archive.Entries.Count)
}finally{$archive.Dispose()}
[IO.Compression.ZipFile]::ExtractToDirectory(${literal(build.zip)},${literal(verification)})`;
const extracted=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8'});
assert.equal(extracted.status,0,extracted.stderr||extracted.stdout);
const portable=join(verification,name),appRoot=join(portable,'desktop-app/resources/app');
assert.equal(JSON.parse(await readFile(join(appRoot,'package.json'),'utf8')).version,version);
assert.deepEqual(await readFile(join(appRoot,'dist/index.html')),await readFile('dist/index.html'));
assert.deepEqual(await readFile(join(appRoot,'server/artwork.mjs')),await readFile('server/artwork.mjs'));
assert.deepEqual(await readFile(join(appRoot,'server/discovery.mjs')),await readFile('server/discovery.mjs'));
assert.deepEqual(await readFile(join(appRoot,'shared/music-identity.mjs')),await readFile('shared/music-identity.mjs'));
assert.deepEqual(await readFile(join(portable,'ClearPlayer.exe')),await readFile('ClearPlayer.exe'));
for(const file of ['LICENSE','LICENSES.chromium.html','resources/app/THIRD_PARTY_NOTICES.md','resources/app/node_modules/opencc-js/LICENSE'])assert.ok((await stat(join(portable,'desktop-app',file))).isFile());
const executablePath=join(portable,'desktop-app/澄音播放器.exe');
const binary=await readFile(executablePath);assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c)+4),0x8664,'runtime must be Windows x64');
const env={...process.env,CLEAR_DESKTOP_PROFILE:join(verification,'test-profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath,env,timeout:30000}),page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/专辑封面.mp3');
  await page.getByRole('heading',{name:'封面之歌',exact:true}).waitFor();await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
  await page.getByRole('button',{name:'打开播放界面',exact:true}).click();await page.getByRole('button',{name:'封面与构图',exact:true}).click();
  await page.getByRole('slider',{name:'封面缩放'}).fill('1.1');await page.getByRole('button',{name:'保存构图',exact:true}).click();await page.getByText('封面构图已保存',{exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭封面工作室'}).click();assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  await page.getByRole('button',{name:'返回曲库',exact:true}).click();
  assert.ok((await page.locator('.sidebar-version').innerText()).includes(version));
  await page.getByRole('button',{name:'新建歌单',exact:true}).click();await page.getByLabel('歌单名称').fill('发布验证');await page.getByRole('button',{name:'创建歌单',exact:true}).click();
  await page.getByRole('heading',{name:'发布验证',exact:true}).waitFor();await page.getByRole('button',{name:'添加曲库歌曲',exact:true}).click();await page.getByRole('button',{name:'添加 封面之歌',exact:true}).click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.discovery-row[data-status="ready"]').count(),1);assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  await page.getByRole('button',{name:'个人雷达',exact:true}).click();await page.getByRole('heading',{name:/今天，听见/}).waitFor();
  await page.getByRole('button',{name:'导入歌单',exact:true}).click();await page.getByLabel('歌单分享链接').waitFor();await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  const launcher=spawn(join(portable,'ClearPlayer.exe'),[],{env,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{launcher.once('exit',resolve);launcher.once('error',reject);});
  await app.evaluate(async({BrowserWindow})=>{for(let i=0;i<40;i++){if(BrowserWindow.getAllWindows()[0].isVisible())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Portable launcher did not restore the player');});
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);assert.deepEqual(errors,[]);
}finally{await app.close();}
console.log(extracted.stdout.trim());console.log(JSON.stringify({result:'PASS release ZIP: clean content, checksum, extracted Windows x64 startup, local playback, artwork studio, personal radar, playlist management, shared dependency and portable launcher',bytes:build.bytes,sha256}));
