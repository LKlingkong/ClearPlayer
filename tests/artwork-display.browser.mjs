import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from '@playwright/test';

const fixture = `<!doctype html><html><head><style>
#root{width:200px;height:200px;overflow:hidden;border-radius:50%}.artwork{width:100%;height:100%;object-fit:cover}
</style></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {Artwork} from '/src/components/Artwork.tsx';
const root=createRoot(document.getElementById('root'));
window.renderArtwork=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(Artwork,props)));
window.clearArtwork=()=>root.render(null);
window.artworkReady=true;
</script></body></html>`;
const server=await createServer({configFile:false,plugins:[react(),{
  name:'isolated-artwork-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(req.url?.split('?')[0]!=='/__artwork-display')return next();
    res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__artwork-display',fixture));
  });}
}],optimizeDeps:{entries:[],include:['react','react-dom/client','react/jsx-dev-runtime']},
server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
let browser;
try {
  await server.listen();
  const port=server.httpServer.address().port;
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage();
  const origin=`http://127.0.0.1:${port}`;
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(()=>{
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),decode=window.createImageBitmap.bind(window);
    window.activeArtworkUrls=new Set();window.artworkDecodes=0;
    URL.createObjectURL=blob=>{const url=create(blob);window.activeArtworkUrls.add(url);return url;};
    URL.revokeObjectURL=url=>{window.activeArtworkUrls.delete(url);revoke(url);};
    window.createImageBitmap=async blob=>{
      window.artworkDecodes++;
      if(window.pauseArtworkDecode){window.pauseArtworkDecode=false;await new Promise(resolve=>window.releaseArtworkDecode=resolve);}
      return decode(blob);
    };
  });
  await page.goto(`${origin}/__artwork-display`);
  await page.waitForFunction(()=>window.artworkReady);
  await page.evaluate(async()=>{
    const make=async(width,height,padded)=>{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
      ctx.fillStyle='#6090c0';ctx.fillRect(padded?75:0,0,padded?450:width,height);
      ctx.fillStyle='#c09060';ctx.fillRect(padded?75:0,height/2,padded?450:width,height/2);
      return new Promise(resolve=>canvas.toBlob(resolve));
    };
    window.paddedArtwork=await make(600,600,true);window.plainArtwork=await make(128,128,false);
    window.slowArtwork=await make(256,256,false);window.brokenArtwork=new Blob(['not an image']);
    window.originalArtworkSize=window.paddedArtwork.size;
    window.renderArtwork({blob:window.paddedArtwork,autoTrim:true});
  });
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===450);
  assert.equal(await page.locator('.artwork').evaluate(img=>img.naturalHeight),600);
  assert.equal(await page.evaluate(()=>window.artworkDecodes),1,'StrictMode must share cached image processing');
  assert.equal(await page.evaluate(()=>window.paddedArtwork.size===window.originalArtworkSize),true);

  await page.evaluate(()=>window.renderArtwork({blob:window.paddedArtwork}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===600);
  await page.evaluate(()=>window.renderArtwork({blob:window.paddedArtwork,autoTrim:true,fit:{zoom:2,x:0,y:100,trim:false}}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===600);
  assert.deepEqual(await page.locator('.artwork').evaluate(img=>({position:img.style.objectPosition,origin:img.style.transformOrigin,scale:img.style.transform})),
    {position:'0% 100%',origin:'0% 100%',scale:'scale(2)'});
  await page.evaluate(()=>window.renderArtwork({blob:window.paddedArtwork,autoTrim:true}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===450);
  assert.equal(await page.evaluate(()=>window.artworkDecodes),1,'re-enabling trim must reuse the cropped bytes');

  await page.evaluate(()=>window.renderArtwork({blob:window.plainArtwork,autoTrim:true}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===128);
  await page.evaluate(()=>{window.pauseArtworkDecode=true;window.renderArtwork({blob:window.slowArtwork,autoTrim:true});});
  await page.waitForFunction(()=>Boolean(window.releaseArtworkDecode));
  await page.evaluate(()=>window.renderArtwork({blob:window.plainArtwork,autoTrim:true}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.naturalWidth===128);
  await page.evaluate(async()=>{window.releaseArtworkDecode();await new Promise(resolve=>setTimeout(resolve,50));});
  assert.equal(await page.locator('.artwork').evaluate(img=>img.naturalWidth),128,'a stale decode must never replace the current cover');
  await page.evaluate(()=>window.renderArtwork({blob:window.brokenArtwork,autoTrim:true}));
  await page.waitForFunction(()=>window.artworkDecodes===4&&document.querySelector('.artwork')?.complete&&document.querySelector('.artwork')?.naturalWidth===0);
  assert.match(await page.locator('.artwork').getAttribute('src'),/^blob:/,'decode failures retain the original image source');
  await page.evaluate(()=>window.renderArtwork({}));
  await page.waitForFunction(()=>document.querySelector('.artwork')?.getAttribute('src')==='/artwork.svg'&&window.activeArtworkUrls.size===0);
  await page.evaluate(()=>window.clearArtwork());
  await page.waitForFunction(()=>!document.querySelector('.artwork')&&window.activeArtworkUrls.size===0);
  // Optional local diagnostic image, supplied explicitly; never reads app profiles.
  for(let argument=2;argument<process.argv.length;argument++) {
    const preserve=process.argv[argument]==='--keep';
    const path=process.argv[preserve?++argument:argument];
    const bytes=await readFile(path);
    const bounds=await page.evaluate(async data=>{
      const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/jpeg'});
      const bitmap=await createImageBitmap(blob),sample=document.createElement('canvas');
      sample.width=sample.height=192;const ctx=sample.getContext('2d');ctx.imageSmoothingEnabled=false;
      ctx.drawImage(bitmap,0,0,192,192);bitmap.close();
      const {findArtworkBounds}=await import('/src/lib/artworkGeometry.ts');
      const bounds=findArtworkBounds(ctx.getImageData(0,0,192,192).data,192,192);
      window.renderArtwork({blob,autoTrim:true});return bounds;
    },bytes.toString('base64'));
    assert.deepEqual(bounds,preserve?{x:0,y:0,width:192,height:192}:{x:24,y:0,width:144,height:192});
    await page.waitForFunction(width=>document.querySelector('.artwork')?.naturalWidth===width,preserve?600:450);
    assert.equal(await page.locator('.artwork').evaluate(img=>img.naturalHeight),600);
    await page.evaluate(()=>window.clearArtwork());
    await page.waitForFunction(()=>window.activeArtworkUrls.size===0);
    console.log(`PASS supplied JPEG (${path}): ${JSON.stringify(bounds)}; display ${preserve?600:450}×600`);
  }
  console.log('PASS artwork display: real canvas crop, original restore, fit, cache, StrictMode, stale decode, fallback and URL cleanup');
} finally {
  await browser?.close();
  await server.close();
}
