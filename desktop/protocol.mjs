import {readFile, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const security={
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options':'nosniff',
};

export function createDesktopProtocol({dist,apiOrigin}) {
  const root=resolve(dist);
  return async function handle(request) {
    try {
      const url=new URL(request.url);
      if(url.protocol!=='clear:' || url.host!=='player')return new Response('Forbidden',{status:403});
      let pathname;
      try {pathname=decodeURIComponent(url.pathname);} catch {return new Response('Invalid path',{status:400});}
      if(pathname.includes('\\') || pathname.includes('\0'))return new Response('Forbidden',{status:403});
      if(pathname.startsWith('/api/')) {
        const headers=new Headers({'Origin':apiOrigin});
        if(request.headers.has('content-type'))headers.set('content-type',request.headers.get('content-type'));
        const options={method:request.method,headers,signal:request.signal,redirect:'error'};
        if(!['GET','HEAD'].includes(request.method))options.body=await request.text();
        const response=await fetch(new URL(url.pathname+url.search,apiOrigin),options);
        return new Response(response.body,{status:response.status,headers:response.headers});
      }
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      let file=resolve(root,'.'+pathname);
      if(file!==root && !file.startsWith(root+sep))return new Response('Forbidden',{status:403});
      if(file===root)file=resolve(root,'index.html');
      try {if(!(await stat(file)).isFile())throw new Error('Not a file');}
      catch {if(extname(pathname))return new Response('Not found',{status:404});file=resolve(root,'index.html');}
      return new Response(request.method==='HEAD'?null:await readFile(file),{headers:{...security,'Content-Type':types[extname(file)]||'application/octet-stream'}});
    } catch(error) {
      if(request.signal.aborted)return new Response(null,{status:499});
      console.error('Desktop request failed:',error.message);
      return Response.json({error:'播放器暂时无法读取此内容，请重试'},{status:500});
    }
  };
}
