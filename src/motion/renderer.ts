import { advanceSpring, clamp, fillSurface, tiltedSurface, mix, occupancyTone, rgb, type Material, type Spring } from './model';

type Options = { ratio:number; material:Material; reduced:boolean; paused:boolean; dark:boolean };
export type LiquidController = { update:(next:Partial<Options>)=>void; point:(x:number,y:number)=>void; ripple:()=>void; tilt:(slope:number,impulse?:number)=>void; destroy:()=>void };
const levels=Array.from({length:401},(_,i)=>fillSurface(i/400));
const surface=(r:number)=>{const n=clamp(r)*400,i=Math.floor(n);return 32+levels[i]+((levels[i+1]??levels[i])-levels[i])*(n-i);};
const round=(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number)=>{c.beginPath();c.roundRect(x,y,w,h,r);};

export function createLiquidRenderer(canvas:HTMLCanvasElement, initial:Options):LiquidController {
  const c=canvas.getContext('2d');if(!c)return{update(){},point(){},ripple(){},tilt(){},destroy(){}};
  let options={...initial}, spring:Spring={position:clamp(initial.ratio),velocity:0}, raf=0,last=0,phase=0,energy=0,width=360,height=370,dpr=1,visible=true,disposed=false;
  let tiltTarget=0,tiltSpring:Spring={position:0,velocity:0};
  let pointerX=0,pointerY=0,lightX=0,lightY=0,paintedAt=0;
  const grain=document.createElement('canvas');grain.width=grain.height=96;const gc=grain.getContext('2d')!;const pixels=gc.createImageData(96,96);let seed=1717;
  for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=seed>>>24;pixels.data[i+3]=seed%4;}gc.putImageData(pixels,0,0);
  const texture=c.createPattern(grain,'repeat');
  function wave(y:number,offset:number,amplitude:number,close=true){
    c!.beginPath();for(let x=36;x<=324;x+=2){const xx=(x-180)/144;const yy=y+Math.sin(x*.024+phase+offset)*amplitude+Math.sin(x*.047-phase*.7+offset)*amplitude*.24+(x-180)*tiltSpring.position;
      if(x===36)c!.moveTo(x,yy);else c!.lineTo(x,yy);}
    if(close){c!.lineTo(324,320);c!.lineTo(36,320);c!.closePath();}
  }
  function draw(){
    if(!c)return;const {material,reduced,paused,dark}=options,matte=material==='frost',ceramic=material==='ceramic';
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);c.save();c.scale(width/360,height/370);
    const ratio=clamp(spring.position),col=occupancyTone(ratio),light=mix(col,[250,250,255],.45),deep=mix(col,[31,50,103],.36),y=Math.abs(tiltSpring.position)<.0001?surface(ratio):32+tiltedSurface(ratio,tiltSpring.position);
    const amp=paused||reduced?0:(matte?3.2:5.5)+energy*6+Math.min(5,Math.abs(spring.velocity)*8);
    // A separate, broad shadow anchors the glass instead of a generic UI drop shadow.
    const shadow=c.createRadialGradient(180,328,14,180,328,139);shadow.addColorStop(0,dark?'#09112760':'#192b5620');shadow.addColorStop(.7,'#192b5608');shadow.addColorStop(1,'#192b5600');c.save();c.translate(0,220);c.scale(1,.32);c.fillStyle=shadow;c.fillRect(20,200,320,220);c.restore();
    c.save();c.shadowColor=dark?'#09112860':'#26375c1d';c.shadowBlur=18;c.shadowOffsetY=12;round(c,29,16,302,306,89);c.fillStyle=ceramic?'#f0e7ea':'#e4e8f3';c.fill();c.restore();
    const rim=c.createLinearGradient(38,10,321,325);[[0,'#ffffff'],[.16,'#e6eaf4'],[.36,'#ffffff'],[.62,'#c2cada'],[.79,'#fafcff'],[1,'#dae0ed']].forEach(([s,v])=>rim.addColorStop(s as number,v as string));
    round(c,29,16,302,306,89);c.fillStyle=ceramic?'#f1e8ed':rim;c.fill();c.lineWidth=1;c.strokeStyle='#ffffff90';c.stroke();
    // Inner cavity, refraction, and material depth are independent of the liquid.
    round(c,48,32,264,276,76);c.save();c.clip();const cavity=c.createLinearGradient(45,35,302,305);cavity.addColorStop(0,ceramic?'#fcf7fa':'#f7f9fe');cavity.addColorStop(.6,'#eef2fa');cavity.addColorStop(1,'#d9e1ef');c.fillStyle=cavity;c.fillRect(40,25,282,290);
    let shade=c.createRadialGradient(165+lightX*18,130+lightY*12,25,180,160,200);shade.addColorStop(0,'#ffffff60');shade.addColorStop(.75,'#ffffff00');shade.addColorStop(1,'#24376b1e');c.fillStyle=shade;c.fillRect(40,25,282,290);
    if(ratio>0){
      // A second meniscus and depth gradient give the surface a tangible thickness.
      wave(y-3,1.7,amp*.8);c.fillStyle=rgb(light,.8);c.fill();
      const fluid=c.createLinearGradient(0,y-5,0,310);fluid.addColorStop(0,rgb(light));fluid.addColorStop(.12,rgb(mix(col,[249,249,255],.2)));fluid.addColorStop(.66,rgb(col));fluid.addColorStop(1,rgb(deep));wave(y,0,amp);c.fillStyle=fluid;c.fill();
      c.save();wave(y,0,amp);c.clip();
      const refraction=c.createLinearGradient(48,0,312,0);[[0,'#1b2d6230'],[.035,'#ffffffa0'],[.085,'#ffffff08'],[.3,'#ffffff00'],[.78,'#4b245705'],[.94,'#59234e32'],[1,'#ffffff70']].forEach(([s,v])=>refraction.addColorStop(s as number,v as string));c.fillStyle=refraction;c.fillRect(45,30,270,285);
      if(!matte&&!ceramic){
        // Slow caustics stay below the reading so text contrast is stable.
        for(let j=0;j<6;j++){c.beginPath();for(let x=48;x<314;x+=3){const yy=271+j*5+Math.sin(x*.031+phase*.28+j*.7)*11; x===48?c.moveTo(x,yy):c.lineTo(x,yy);}c.strokeStyle=`rgba(245,248,255,${.17-j*.02})`;c.lineWidth=1.1+j*.45;c.stroke();}
        for(let j=0;j<13;j++){const bx=65+(j*47)%230,by=305-((j*43+phase*5)%270),r=1+(j%3)*.65;if(by<y+8)continue;c.beginPath();c.arc(bx,by,r,0,Math.PI*2);c.strokeStyle='#f7f9ff65';c.lineWidth=.7;c.stroke();c.beginPath();c.arc(bx-.4,by-.5,.6,0,Math.PI*2);c.fillStyle='#ffffffa0';c.fill();}
      }
      c.restore();wave(y,0,amp,false);c.strokeStyle=rgb(mix(light,[255,255,255],.62),.85);c.lineWidth=2.2;c.stroke();
      c.save();c.translate(0,2);wave(y,0,amp,false);c.strokeStyle=rgb(deep,.25);c.lineWidth=.8;c.stroke();c.restore();
    }
    const readingGlow=c.createRadialGradient(180,150,15,180,170,130);readingGlow.addColorStop(0,'#ffffff4d');readingGlow.addColorStop(1,'#ffffff00');c.fillStyle=readingGlow;c.fillRect(45,32,270,276);
    if(matte){c.fillStyle='#f5f7ff38';c.fillRect(40,25,282,290);}if(texture){c.fillStyle=texture;c.fillRect(40,25,282,290);}
    c.restore();
    // Polished bevel and directional reflections. No CSS blur filters are animated.
    round(c,47.5,31.5,265,277,77);c.strokeStyle=ceramic?'#a5789445':'#6c7ea040';c.lineWidth=1.2;c.stroke();round(c,35,22,290,294,84);c.strokeStyle='#ffffffb0';c.lineWidth=1.5;c.stroke();
    if(!matte&&!ceramic){c.save();round(c,46,30,268,280,78);c.clip();const shine=c.createLinearGradient(52+lightX*3,0,88+lightX*3,0);shine.addColorStop(0,'#ffffff00');shine.addColorStop(.4,'#ffffff65');shine.addColorStop(1,'#ffffff00');c.fillStyle=shine;c.beginPath();c.ellipse(66+lightX*3,136+lightY*4,9,83,-.04,0,Math.PI*2);c.fill();c.restore();}
    // Fine etched scale: just enough to read the ratio, without visual noise.
    for(let i=0;i<5;i++){const yy=75+i*44;c.beginPath();c.moveTo(286,yy);c.lineTo(i%2?290:293,yy);c.strokeStyle='#283f6a35';c.lineWidth=1;c.stroke();}
    c.restore();
  }
  function frame(t:number){raf=0;if(disposed||!visible||document.hidden)return;const dt=last?Math.min(.1,(t-last)/1000):.016;last=t;
    spring=options.reduced?{position:clamp(options.ratio),velocity:0}:advanceSpring(spring,clamp(options.ratio),dt);tiltSpring=options.reduced||options.paused?{position:0,velocity:0}:advanceSpring(tiltSpring,tiltTarget,dt,65,10);energy*=Math.exp(-dt*2.5);lightX+=(pointerX-lightX)*(1-Math.exp(-dt*9));lightY+=(pointerY-lightY)*(1-Math.exp(-dt*9));
    if(!options.paused&&!options.reduced)phase+=dt*1.25;
    if(t-paintedAt>1000/45||options.reduced){draw();paintedAt=t;}
    if(!options.reduced&&(!options.paused||Math.abs(clamp(options.ratio)-spring.position)>.0001))raf=requestAnimationFrame(frame);
  }
  function wake(){cancelAnimationFrame(raf);last=0;draw();if(!disposed&&visible&&!document.hidden)raf=requestAnimationFrame(frame);}
  const resize=new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);wake();});resize.observe(canvas);
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)wake();else cancelAnimationFrame(raf);});observer.observe(canvas);
  const visibility=()=>document.hidden?cancelAnimationFrame(raf):wake();document.addEventListener('visibilitychange',visibility);
  return{update(next){if(next.ratio!==undefined&&next.ratio!==options.ratio)energy=Math.min(1.2,Math.abs(next.ratio-options.ratio)*4);options={...options,...next};if(options.reduced)spring={position:clamp(options.ratio),velocity:0};wake();},point(x,y){pointerX=clamp(x,-1,1);pointerY=clamp(y,-1,1);},ripple(){if(options.reduced||options.paused)return;energy=.8;wake();},tilt(slope,impulse=0){if(options.reduced||options.paused)return;tiltTarget=clamp(slope,-.36,.36);energy=Math.min(1.5,energy+clamp(impulse,0,.35));if(!raf)wake();},destroy(){disposed=true;cancelAnimationFrame(raf);resize.disconnect();observer.disconnect();document.removeEventListener('visibilitychange',visibility);}};
}
