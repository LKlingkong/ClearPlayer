import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createDesktopProtocol} from '../desktop/protocol.mjs';

test('应用主页和脚本使用正确类型，限制访问打包目录外文件', async () => {
  const dist=await mkdtemp(join(tmpdir(),'clear-desktop-protocol-'));
  await mkdir(join(dist,'assets'));
  await writeFile(join(dist,'index.html'),'<h1>澄音</h1>');
  await writeFile(join(dist,'assets/app.js'),'console.log("ok")');
  const handler=createDesktopProtocol({dist,apiOrigin:'http://127.0.0.1:1'});
  const home=await handler(new Request('clear://player/'));
  assert.equal(home.status,200);
  assert.equal(await home.text(),'<h1>澄音</h1>');
  assert.match(home.headers.get('content-security-policy'),/object-src 'none'/);
  assert.match((await handler(new Request('clear://player/assets/app.js'))).headers.get('content-type'),/javascript/);
  assert.equal((await handler(new Request('clear://other/'))).status,403);
  assert.equal((await handler(new Request('clear://player/..%5Csecret'))).status,403);
  assert.equal((await handler(new Request('clear://player/missing.js'))).status,404);
});

test('API 请求保留方法和正文，只转发给内置音乐服务', async () => {
  let received;
  const server=createServer(async (req,res) => {
    let body='';for await(const chunk of req)body+=chunk;
    received={method:req.method,url:req.url,body,origin:req.headers.origin};
    res.writeHead(202,{'content-type':'application/json'});res.end('{"ok":true}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const apiOrigin=`http://127.0.0.1:${server.address().port}`;
  try {
    const handler=createDesktopProtocol({dist:'.',apiOrigin});
    const response=await handler(new Request('clear://player/api/downloads?x=1',{method:'POST',headers:{'content-type':'application/json'},body:'{"key":"test"}'}));
    assert.equal(response.status,202);
    assert.deepEqual(await response.json(),{ok:true});
    assert.deepEqual(received,{method:'POST',url:'/api/downloads?x=1',body:'{"key":"test"}',origin:apiOrigin});
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
