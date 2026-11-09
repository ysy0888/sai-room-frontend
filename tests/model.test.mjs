import test from 'node:test';
import assert from 'node:assert/strict';
import {validSnapshot,acceptSnapshot,fillSurface,tiltedSurface,orientationSlope,advanceSpring,occupancyLabel} from '../src/motion/model.ts';
const first={count:7,referenceCapacity:15,observedAt:'2026-11-09T05:00:00Z',sequence:4};
test('invalid, duplicate and out-of-order readings never replace confirmed data',()=>{
 for(const change of [{count:-1},{count:2.5},{referenceCapacity:0},{sequence:4},{sequence:3},{sequence:5,observedAt:'2026-11-09T04:00:00Z'}])assert.equal(acceptSnapshot(first,{...first,...change}),first);
 assert.equal(validSnapshot({...first,observedAt:'unknown'}),false);assert.equal(acceptSnapshot(first,{...first,count:18,sequence:5}).count,18);
});
test('fill area follows count; empty, full and excess are bounded',()=>{assert.equal(fillSurface(0),276);assert.equal(fillSurface(1),0);assert.equal(fillSurface(1.2),0);for(let i=1;i<=100;i++)assert.ok(fillSurface(i/100)<fillSurface((i-1)/100));});
test('tilted liquid preserves area at 3%, 20%, 47%, 73%, 97%',()=>{
 for(const ratio of [.03,.2,.47,.73,.97])for(const slope of [-.36,-.15,.15,.36]){
 const y=tiltedSurface(ratio,slope);let area=0,total=0;
 for(let i=0;i<2000;i++){const x=(i+.5)*264/2000,edge=Math.min(x,264-x),inset=edge>=76?0:76-Math.sqrt(76**2-(76-edge)**2),bottom=276-inset;total+=bottom-inset;area+=Math.max(0,Math.min(bottom-inset,bottom-y-slope*(x-132)));}
 assert.ok(Math.abs(area/total-ratio)<.001,`${ratio},${slope}: ${area/total}`);
 }});
test('spring settles after large jumps and dropped frames',()=>{let s={position:0,velocity:0};for(let i=0;i<180;i++)s=advanceSpring(s,1,i%8===0?3:1/60);assert.ok(Math.abs(s.position-1)<.0001);assert.ok(Number.isFinite(s.velocity));});
test('status copy reports occupancy, not an invented trend',()=>{assert.equal(occupancyLabel(0,15),'감지 인원 없음');assert.equal(occupancyLabel(3,15),'여유');assert.equal(occupancyLabel(7,15),'보통');assert.equal(occupancyLabel(11,15),'혼잡');assert.equal(occupancyLabel(18,15),'기준 인원 초과');});
test('sensor projection is stable flat, bounded, and changes with rotation',()=>{assert.equal(orientationSlope(0,0),0);assert.ok(Math.abs(orientationSlope(60,0))<1e-9);assert.ok(orientationSlope(60,20)<0);assert.ok(orientationSlope(60,-20)>0);assert.ok(Math.abs(orientationSlope(30,80))<=.36);assert.notEqual(orientationSlope(60,20,90),orientationSlope(60,20,0));});
