/* Small deterministic position-based solver. No network or sensor access. */
(function () {
  'use strict';
  const BOUNDS={left:42,right:318,top:66,bottom:304,corner:28};
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
  const hash=s=>Array.from(s).reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))>>>0,17);
  function spec(count,capacity,visible) {
    const ratio=count/Math.max(1,capacity),pressure=smooth((ratio-.65)/.35);
    const area=(BOUNDS.right-BOUNDS.left)*(BOUNDS.bottom-BOUNDS.top)-700;
    const base=Math.sqrt(area*.84*Math.min(ratio,1.12)/(Math.max(visible,1)*Math.PI));
    const radius=clamp(base,15,58);
    return {ratio,pressure,radius:radius*(1+pressure*.16),collision:Math.min(radius*(.98-pressure*.025),Math.sqrt(area*.79/(Math.max(visible,1)*Math.PI)))};
  }
  function createWorld() {
    const world={particles:[],gravity:0,config:spec(7,15,7),time:0};
    world.configure=(count,capacity,visible)=>{world.config=spec(count,capacity,visible);};
    world.add=(id,wait=0,settled=false)=>{
      const seed=hash(id),x=180+(seed%23-11),y=settled?150+(seed%90):26;
      const p={id,x,y,px:x-(seed%7-3)*.25,py:y,wait,age:0,entered:settled,r:world.config.radius,cr:world.config.collision,squash:0,seed};
      world.particles.push(p);return p;
    };
    world.remove=p=>{world.particles=world.particles.filter(x=>x!==p);};
    world.impulse=amount=>{for(const p of world.particles){p.px-=amount*(p.seed%2?1:-1)*90;p.py+=amount*120;}};
    world.step=(dt=1/60)=>{
      dt=clamp(dt,1/240,1/45);world.time+=dt;
      const {config}=world;
      for(const p of world.particles){
        p.r+=(config.radius-p.r)*.14;p.cr+=(config.collision-p.cr)*.14;p.squash*=.83;
        if(p.wait>0){p.wait-=dt;continue;}
        p.age+=dt;const vx=(p.x-p.px)*.965,vy=(p.y-p.py)*.965;
        p.px=p.x;p.py=p.y;p.x+=vx+world.gravity*1050*dt*dt;p.y+=vy+1450*dt*dt;
        if(p.y>BOUNDS.top+p.cr || p.age>1.25)p.entered=true;
      }
      const active=world.particles.filter(p=>p.wait<=0);
      for(let k=0;k<10;k++){
        for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
          const a=active[i],b=active[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
          if(d<.001){dx=.01;dy=.02;d=Math.hypot(dx,dy);}
          const overlap=a.cr+b.cr-d;
          if(overlap>0){const move=overlap*.49,ux=dx/d,uy=dy/d;a.x-=ux*move;a.y-=uy*move;b.x+=ux*move;b.y+=uy*move;if(k===0){a.squash=Math.max(a.squash,Math.min(.22,overlap*.035));b.squash=Math.max(b.squash,Math.min(.22,overlap*.035));}}
        }
        for(const p of active){
          const r=p.cr,b=BOUNDS,vx=p.x-p.px,vy=p.y-p.py;
          const left=b.left+r,right=b.right-r;
          if(p.x<left){p.x=left;p.px=left+vx*.18;}if(p.x>right){p.x=right;p.px=right+vx*.18;}
          if(p.y>b.bottom-r){p.y=b.bottom-r;p.py=p.y+Math.max(0,vy)*.16;p.px=p.x-vx*.82;p.squash=Math.max(p.squash,Math.min(.22,Math.abs(vy)*.025));}
          if(p.entered&&p.y<b.top+r){p.y=b.top+r;p.py=p.y;}
          // Rounded lower corners keep balls inside the visible glass.
          for(const side of [-1,1]){
            const cx=side<0?b.left+b.corner:b.right-b.corner,cy=b.bottom-b.corner;
            if(p.y>cy && (side<0?p.x<cx:p.x>cx)){
              const dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy),limit=Math.max(1,b.corner-r);
              if(d>limit){p.x=cx+dx/d*limit;p.y=cy+dy/d*limit;}
            }
          }
        }
      }
    };
    world.settle=()=>{const r=world.config.collision,columns=Math.max(1,Math.floor((BOUNDS.right-BOUNDS.left)/(2*r)));world.particles.forEach((p,i)=>{p.wait=0;if(!p.entered){p.entered=true;p.x=columns===1?180:BOUNDS.left+r+(i%columns)*(BOUNDS.right-BOUNDS.left-2*r)/(columns-1);p.y=clamp(BOUNDS.bottom-r-Math.floor(i/columns)*r*1.8,BOUNDS.top+r,BOUNDS.bottom-r);p.px=p.x;p.py=p.y;}});for(let i=0;i<240;i++)world.step();};
    return world;
  }
  // Clip each soft surface against neighboring balls and glass. Circular arcs flatten
  // where compressed; labels are separate DOM text and keep their original aspect ratio.
  function outline(p,others) {
    const points=[],b=BOUNDS,segments=40;
    for(let i=0;i<segments;i++){
      const angle=i/segments*Math.PI*2,ux=Math.cos(angle),uy=Math.sin(angle);
      const sx=1+p.squash,sy=1-p.squash*.7;
      let r=p.r/Math.sqrt(ux*ux/(sx*sx)+uy*uy/(sy*sy));
      for(const q of others){if(q===p||q.wait>0)continue;const dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy);if(d>p.r+q.r+3||d<.01)continue;const dot=(dx*ux+dy*uy)/d;if(dot>.05)r=Math.min(r,(d*p.r/(p.r+q.r)-.45)/dot);}
      if(ux>.01)r=Math.min(r,(b.right-p.x-2)/ux);if(ux<-.01)r=Math.min(r,(b.left-p.x+2)/ux);
      if(uy>.01)r=Math.min(r,(b.bottom-p.y-2)/uy);if(uy<-.01&&p.entered)r=Math.min(r,(b.top-p.y+2)/uy);
      r=Math.max(p.r*.56,r);points.push({x:60+ux*r/p.r*54,y:60+uy*r/p.r*54});
    }
    const mid=(a,c)=>({x:(a.x+c.x)/2,y:(a.y+c.y)/2});const start=mid(points.at(-1),points[0]);
    let path=`M${start.x.toFixed(2)},${start.y.toFixed(2)}`;
    for(let i=0;i<segments;i++){const a=points[i],m=mid(a,points[(i+1)%segments]);path+=`Q${a.x.toFixed(2)},${a.y.toFixed(2)} ${m.x.toFixed(2)},${m.y.toFixed(2)}`;}
    const area=Math.abs(points.reduce((sum,a,i)=>{const c=points[(i+1)%segments];return sum+a.x*c.y-c.x*a.y;},0))/2*(p.r/54)**2;
    return {path:path+'Z',area,points,clip:`polygon(${points.map(a=>`${(a.x/1.2).toFixed(2)}% ${(a.y/1.2).toFixed(2)}%`).join(',')})`};
  }
  window.SaiSoftPhysics={createWorld,spec,outline,BOUNDS,hash};
})();
