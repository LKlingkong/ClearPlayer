import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findArtworkBounds} from '../src/lib/artworkGeometry.ts';

function pixels(width,height,paint) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(paint(x,y),(y*width+x)*4);
  return data;
}
const subject=(x,y)=>[60+x%130,45+y%150,105+(x+y)%90,255];
const full={x:0,y:0,width:600,height:600};

test('removes the observed 75 px black side padding from a 600 px album cover',()=>{
  const data=pixels(600,600,(x,y)=>x<75||x>=525?[0,0,0,255]:subject(x,y));
  assert.deepEqual(findArtworkBounds(data,600,600),{x:75,y:0,width:450,height:600});
});
test('accepts a one pixel left/right padding difference',()=>{
  const data=pixels(600,600,(x,y)=>x<74||x>=525?[2,2,2,255]:subject(x,y));
  assert.deepEqual(findArtworkBounds(data,600,600),{x:74,y:0,width:451,height:600});
});
test('recognizes JPEG-tinted black padding beside a partly dark album scene',()=>{
  // 192 px browser sampling of a 600 px JPEG: the last padding column has
  // low amplitude chroma bleed; 39% of content rows are dark clothing/background.
  const data=pixels(192,192,(x,y)=>{
    if(x<24||x>=168)return x===23||x===168?[10+(y%3),0,2,255]:[0,0,0,255];
    return y<117?[45,80,100,255]:[5,5,5,255];
  });
  assert.deepEqual(findArtworkBounds(data,192,192),{x:24,y:0,width:144,height:192});
});
test('uses a strong opposite straight edge to confirm padding beside a shadowed scene',()=>{
  const data=pixels(192,192,(x,y)=>{
    if(x<24||x>=168)return [4,0,0,255];
    if(x<96)return y<50?[80,55,30,255]:y<111?[22,15,10,255]:[5,2,1,255];
    return y<145?[75,90,110,255]:[8,5,4,255];
  });
  assert.deepEqual(findArtworkBounds(data,192,192),{x:24,y:0,width:144,height:192});
});
test('keeps dark artwork with sparse markings when neither edge confirms a straight subject boundary',()=>{
  const data=pixels(192,192,(x,y)=>{
    if(x<24||x>=168)return [4,0,0,255];
    return y<50?[80,55,30,255]:y<111?[22,15,10,255]:[5,2,1,255];
  });
  assert.deepEqual(findArtworkBounds(data,192,192),{x:0,y:0,width:192,height:192});
});
test('removes white horizontal padding without stretching the subject',()=>{
  const data=pixels(600,600,(x,y)=>y<60||y>=540?[253,253,253,255]:subject(x,y));
  assert.deepEqual(findArtworkBounds(data,600,600),{x:0,y:60,width:600,height:480});
});
test('recognizes fully transparent symmetric padding',()=>{
  const data=pixels(600,600,(x,y)=>x<60||x>=540?[53,24,67,0]:subject(x,y));
  assert.deepEqual(findArtworkBounds(data,600,600),{x:60,y:0,width:480,height:600});
});
test('keeps monochrome images and normal dark photography intact',()=>{
  for(const paint of [()=>[0,0,0,255],()=>[255,255,255,255],()=>[0,0,0,0],(x,y)=>[x%30,y%25,(x+y)%35,255],
    (x,y)=>{const v=5+Math.floor(Math.min(x,599-x)/12);return [v,v,v,255];}]) {
    assert.deepEqual(findArtworkBounds(pixels(600,600,paint),600,600),full);
  }
});
test('does not crop content or lettering interrupting an apparent border',()=>{
  const data=pixels(600,600,(x,y)=>{
    if(x<75||x>=525)return y>=210&&y<235&&((x>=25&&x<60)||(x>=540&&x<575))?[220,220,220,255]:[0,0,0,255];
    return subject(x,y);
  });
  assert.deepEqual(findArtworkBounds(data,600,600),full);
});
test('rejects one-sided padding, different border colors and oversized margins',()=>{
  for(const paint of [(x,y)=>x<75?[0,0,0,255]:subject(x,y),
    (x,y)=>x<75?[0,0,0,255]:x>=525?[255,255,255,255]:subject(x,y),
    (x,y)=>x<180||x>=420?[0,0,0,255]:subject(x,y)]) {
    assert.deepEqual(findArtworkBounds(pixels(600,600,paint),600,600),full);
  }
});
test('preserves unpadded image dimensions used by existing cover fixtures',()=>{
  for(const [width,height] of [[256,256],[128,128],[320,200]]) {
    assert.deepEqual(findArtworkBounds(pixels(width,height,subject),width,height),{x:0,y:0,width,height});
  }
});
