export type ConnectionState = 'live' | 'stale' | 'offline' | 'loading' | 'error';
export type Material = 'glass' | 'frost' | 'ceramic';
export type OccupancySnapshot = { count: number; referenceCapacity: number; observedAt: string; sequence: number };
export type RGB = readonly [number, number, number];
export const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
export function validSnapshot(value: unknown): value is OccupancySnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<OccupancySnapshot>;
  return Number.isInteger(v.count) && v.count! >= 0 && v.count! <= 10000 && Number.isInteger(v.referenceCapacity) && v.referenceCapacity! > 0 && v.referenceCapacity! <= 10000 && typeof v.observedAt === 'string' && Number.isFinite(Date.parse(v.observedAt)) && Number.isSafeInteger(v.sequence) && v.sequence! >= 0;
}
export function acceptSnapshot(previous: OccupancySnapshot | null, incoming: unknown): OccupancySnapshot | null {
  if (!validSnapshot(incoming)) return previous;
  if (previous && (incoming.sequence <= previous.sequence || Date.parse(incoming.observedAt) < Date.parse(previous.observedAt))) return previous;
  return incoming;
}
export function occupancyLabel(count: number, capacity: number) {
  if (count === 0) return '감지 인원 없음';
  const r = count / capacity;
  return r < .4 ? '여유' : r < .7 ? '보통' : r < 1 ? '혼잡' : r === 1 ? '기준 인원 도달' : '기준 인원 초과';
}
export function occupancyTone(ratio: number): RGB {
  const stops: readonly [number, RGB][] = [[0,[158,181,222]],[.45,[147,163,204]],[.72,[179,151,189]],[1,[216,143,166]]];
  const r = clamp(ratio);
  for (let i=1; i<stops.length; i++) {const [b,cb]=stops[i], [a,ca]=stops[i-1];if(r<=b) return mix(ca,cb,(r-a)/(b-a));}
  return stops[stops.length-1][1];
}
export function mix(a: RGB, b: RGB, t: number): RGB { return a.map((n,i)=>n+(b[i]-n)*t) as unknown as RGB; }
export const rgb = (c: RGB, alpha=1) => `rgba(${c.map(Math.round).join(',')},${alpha})`;
// Exact rounded-rectangle cross-section, integrated once to map liquid area to height.
export function fillSurface(ratio: number, width=264, height=276, radius=76): number {
  const r=clamp(ratio);if(r===0)return height;if(r===1)return 0;
  const total=width*height-(4-Math.PI)*radius*radius;
  function areaAbove(y:number) {
    const segment=(h:number)=>{const z=clamp(h,0,radius)-radius;return (width-2*radius)*h+z*Math.sqrt(Math.max(0,radius*radius-z*z))+radius*radius*(Math.asin(clamp(z/radius,-1,1))+Math.PI/2);};
    if(y<radius)return segment(y);
    if(y>height-radius)return total-segment(height-y);
    return segment(radius)+(y-radius)*width;
  }
  let lo=0,hi=height;for(let i=0;i<24;i++){const m=(lo+hi)/2;if(areaAbove(m)<total*(1-r))lo=m;else hi=m;}return (lo+hi)/2;
}
export type Spring = { position: number; velocity: number };
// Semi-implicit integration with bounded substeps is stable after dropped frames.
export function advanceSpring(s: Spring, target: number, seconds: number, stiffness=95, damping=18): Spring {
  let p=s.position,v=s.velocity;const total=clamp(seconds,0,.1),steps=Math.max(1,Math.ceil(total/.008)),dt=total/steps;
  for(let i=0;i<steps;i++){v+=(stiffness*(target-p)-damping*v)*dt;p+=v*dt;}
  if(Math.abs(target-p)<.00005&&Math.abs(v)<.0001)return{position:target,velocity:0};return{position:p,velocity:v};
}

// Integrate the visible cross-section so tilting doesn't change the represented volume.
const vesselColumns = Array.from({length:80},(_,i)=>{
  const x=(i+.5)*264/80,edge=Math.min(x,264-x),inset=edge>=76?0:76-Math.sqrt(76*76-(76-edge)**2);
  return {x:x-132,top:inset,bottom:276-inset};
});
export function tiltedSurface(ratio:number,slope:number) {
  const r=clamp(ratio);if(!r)return 400;if(r===1)return -124;
  if(Math.abs(slope)<.0001)return fillSurface(r);
  const total=vesselColumns.reduce((n,c)=>n+c.bottom-c.top,0),target=total*r;
  let lo=-124,hi=400;
  for(let i=0;i<14;i++){const y=(lo+hi)/2,area=vesselColumns.reduce((n,c)=>n+clamp(c.bottom-y-slope*c.x,0,c.bottom-c.top),0);if(area>target)lo=y;else hi=y;}
  return (lo+hi)/2;
}
// Device beta/gamma → gravity projected onto the screen; adapt to screen rotation.
export function orientationSlope(beta:number,gamma:number,screenAngle=0) {
  const rad=Math.PI/180,b=beta*rad,g=gamma*rad,a=screenAngle*rad;
  const gx=Math.cos(b)*Math.sin(g),gy=Math.sin(b),x=gx*Math.cos(a)+gy*Math.sin(a),y=gy*Math.cos(a)-gx*Math.sin(a);
  // A near-horizontal screen has an unstable projected gravity: return to level.
  if(Math.hypot(x,y)<.15)return 0;
  return clamp(-x/Math.max(.25,Math.abs(y)),-.36,.36);
}
