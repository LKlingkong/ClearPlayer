import {createServer} from 'node:http';
import {MusicService} from '../server/music-service.mjs';
import {createApiHandler} from '../server/api.mjs';
import {providers} from '../server/providers/index.mjs';

export async function startDesktopService(directory) {
  const music=new MusicService({directory,providers});
  await music.init();
  let handler;
  const server=createServer(async(req,res)=>{
    try {if(!(await handler(req,res))){res.writeHead(404);res.end();}}
    catch(error){console.error(error);if(!res.headersSent)res.writeHead(500);res.end();}
  });
  try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
  catch(error){await music.close();throw error;}
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createApiHandler(music,{origins:[origin]});
  let closing;
  return {origin,close(){
    if(!closing)closing=(async()=>{
      server.closeAllConnections();
      await new Promise(resolve=>server.close(resolve));
      await music.close();
    })();
    return closing;
  }};
}
