import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signalEnergy,smoothEnergy} from '../src/lib/audioEnergy.ts';

test('silence stays still and louder real waveform produces more energy',()=>{
  const silent=new Float32Array(256);
  const quiet=Float32Array.from({length:256},(_,i)=>Math.sin(i*Math.PI/8)*.02);
  const loud=Float32Array.from({length:256},(_,i)=>Math.sin(i*Math.PI/8)*.5);
  assert.equal(signalEnergy(silent),0);
  assert.ok(signalEnergy(quiet)>.01 && signalEnergy(quiet)<.15);
  assert.ok(signalEnergy(loud)>.8 && signalEnergy(loud)<=1);
  assert.equal(signalEnergy(new Float32Array()),0);
});
test('energy smoothing attacks promptly, releases softly and is independent of frame rate',()=>{
  const attack=smoothEnergy(0,1,1/30),release=smoothEnergy(1,0,1/30);
  assert.ok(attack>.2 && attack<1);assert.ok(release>.8 && release<1);
  let fast=0,slow=0;for(let i=0;i<60;i++)fast=smoothEnergy(fast,1,1/60);for(let i=0;i<30;i++)slow=smoothEnergy(slow,1,1/30);
  assert.ok(Math.abs(fast-slow)<.001);
  assert.equal(smoothEnergy(.4,NaN,1/30),0);
});
