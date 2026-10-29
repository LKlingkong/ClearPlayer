import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { MusicService } from './music-service.mjs';
import { createApiHandler } from './api.mjs';
import { providers } from './providers/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);const dev=args.includes('--dev');
const portIndex=args.indexOf('--port');
const port=Number(portIndex>=0?args[portIndex+1]:process.env.CLEAR_PORT||5173);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('端口需为 1024–65535 的整数');
const origin=`http://127.0.0.1:${port}`;
const origins=[origin,`http://localhost:${port}`];
const music=new MusicService({directory:resolve(root,'downloads'),providers});await music.init();
const api=createApiHandler(music,{origins});
const dist=resolve(root,'dist');let vite;
if(dev) {
  const {createServer:createViteServer}=await import('vite');
  vite=await createViteServer({root,server:{middlewareMode:true,hmr:{host:'127.0.0.1'}},appType:'spa'});
} else {
  try {await stat(resolve(dist,'index.html'));}
  catch {console.error('请先运行 npm run build，或双击 start-player.cmd。');process.exit(1);}
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try {
    if(!origins.includes(`http://${req.headers.host}`)) {res.writeHead(403);res.end('Only the local player can access this service.');return;}
    if(await api(req,res)) return;
    if(vite) {vite.middlewares(req,res);return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,origin).pathname);} catch {res.writeHead(400);res.end();return;}
    if(pathname.includes('\0')||pathname.includes('\\')){res.writeHead(400);res.end();return;}
    let file=resolve(dist,'.'+pathname);
    if(!file.startsWith(dist+sep)){file=resolve(dist,'index.html');}
    let info;
    try {info=await stat(file);if(!info.isFile()) throw new Error();}
    catch {if(extname(pathname)){res.writeHead(404);res.end();return;}file=resolve(dist,'index.html');info=await stat(file);}
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':info.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(error){console.error(error.message);if(!res.headersSent)res.writeHead(500);res.end('播放器服务暂时不可用，请重新打开。');}
});
server.on('error',async error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已在使用，请关闭之前打开的播放器。`:error.message);await vite?.close();await music.close();process.exit(1);});
server.listen(port,'127.0.0.1',()=>{
  console.log(`澄音播放器：${origin}\n下载文件保存在项目的 downloads 文件夹。关闭窗口即可停止服务。`);
  if(args.includes('--open')) {
    if(process.platform==='win32') spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{detached:true,stdio:'ignore',windowsHide:true}).unref();
    else spawn(process.platform==='darwin'?'open':'xdg-open',[origin],{detached:true,stdio:'ignore'}).unref();
  }
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;server.close();await music.close();await vite?.close();server.closeAllConnections();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
