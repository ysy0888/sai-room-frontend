import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// A shallow physical display case: real meshes, lights, depth, and shadows.
// The existing deterministic solver constrains centers to a readable front layer.
const PALETTE = ['#bacce6', '#e5b3c4', '#780d2e', '#e3e8ef'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function rounded(w,h,r){
  const s=new THREE.Shape(),x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  return s;
}
function create(host,{material='glass',mini=false}={}){
  let renderer;
  try {renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}
  catch {host.dataset.renderer='fallback';return null;}
  const canvas=renderer.domElement;canvas.className='bottle-webgl';canvas.setAttribute('aria-hidden','true');
  canvas.addEventListener('webglcontextlost',lost);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  host.prepend(canvas);host.classList.add('has-webgl');host.dataset.renderer='webgl';
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-180,180,200,-200,1,1800);
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.55;room.dispose();pmrem.dispose();
  const key=new THREE.DirectionalLight('#fff5e7',2.6);key.position.set(-170,330,350);key.castShadow=true;
  Object.assign(key.shadow.camera,{left:-240,right:240,top:280,bottom:-260,near:10,far:1100});key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.00015;key.shadow.normalBias=.35;key.shadow.radius=5;key.shadow.blurSamples=12;
  scene.add(key,new THREE.HemisphereLight('#e8f0ff','#6b7790',1.25));
  const rim=new THREE.DirectionalLight('#d9e6ff',1.4);rim.position.set(210,100,-80);scene.add(rim);
  const fill=new THREE.DirectionalLight('#ffffff',.65);fill.position.set(90,-80,300);scene.add(fill);
  const object=new THREE.Group();scene.add(object);
  const dark=host.closest('[data-theme]')?.dataset.theme==='dark';
  const white=new THREE.MeshStandardMaterial({color:'#dbe3ed',metalness:.2,roughness:.4});
  const navy=new THREE.MeshPhysicalMaterial({color:material==='ceramic'?'#8c284e':'#1c2d59',roughness:material==='frost'?.7:.44,metalness:.02,clearcoat:.22,envMapIntensity:.4});
  const rubber=new THREE.MeshStandardMaterial({color:'#111d35',roughness:.8});
  const glass=new THREE.MeshPhysicalMaterial({color:material==='ceramic'?'#f4dfeb':'#cddff4',roughness:material==='frost'?.38:.07,metalness:0,transparent:true,opacity:material==='frost'?.15:.10,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.5,clearcoat:1});
  function mesh(geometry,mat,x=0,y=0,z=0,shadow=true){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=shadow;m.receiveShadow=shadow;object.add(m);return m;}
  function box(w,h,d,r,mat,x,y,z,shadow=true){return mesh(new RoundedBoxGeometry(w,h,d,3,r),mat,x,y,z,shadow);}
  function extruded(shape,depth,mat,x,y,z,bevel=0){const g=new THREE.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:!!bevel,bevelSegments:3,bevelSize:bevel,bevelThickness:bevel,curveSegments:12});g.translate(0,0,-depth/2);return mesh(g,mat,x,y,z,mat!==glass);}
  // Rear panel, a 96-unit-deep shell, and a separate front pane.
  const shell=rounded(286,250,36);shell.holes.push(new THREE.Path(rounded(276,240,31).getPoints(24)));
  extruded(shell,96,glass,0,19,0,1);
  const back=new THREE.MeshPhysicalMaterial({color:dark?'#72839e':'#e3eaf4',roughness:.43,metalness:.12,transparent:true,opacity:.68});
  extruded(rounded(277,241,32),3,back,0,19,-50);
  extruded(rounded(277,241,32),2,glass,0,19,49);
  // Physical glass edges reveal the distance between front and back.
  const edgeMat=new THREE.MeshStandardMaterial({color:'#bccde0',metalness:.6,roughness:.25,transparent:true,opacity:.68});
  for(const z of [-49,49]){
    const outline=rounded(283,247,35).getPoints(72).map(p=>new THREE.Vector3(p.x,p.y+19,z));
    const curve=new THREE.CatmullRomCurve3(outline,true);
    mesh(new THREE.TubeGeometry(curve,180,1.2,6,true),edgeMat,0,0,0,false);
  }
  // Inlet is an open ring, with a visible inner wall and recessed lip.
  const inlet=rounded(96,76,27);inlet.holes.push(new THREE.Path(rounded(80,60,22).getPoints(24)));
  const mouth=extruded(inlet,12,white,0,153,0,1);mouth.rotation.x=Math.PI/2;
  const innerMouth=extruded(inlet,7,navy,0,149,0);innerMouth.rotation.x=Math.PI/2;
  // Base consists of separate solids around a real tunnel; no black hole painted on a face.
  box(266,17,110,6,navy,0,-113,0);
  box(104,49,110,9,navy,-81,-143,0);box(104,49,110,9,navy,81,-143,0);
  box(65,48,8,4,rubber,0,-142,-49);
  box(66,7,106,2,rubber,0,-165,0);
  box(250,9,97,4,rubber,0,-172,-1);
  const tray=box(110,7,67,3,white,0,-173,72);tray.receiveShadow=true;
  box(110,5,5,2,white,0,-168,103);box(5,8,64,2,white,-53,-168,72);box(5,8,64,2,white,53,-168,72);
  for(const x of [-106,106]){const screw=mesh(new THREE.CylinderGeometry(2.1,2.1,1,14),white,x,-139,56);screw.rotation.x=Math.PI/2;}
  // Brand marking is attached to the base's front face, and follows camera perspective.
  const logoCanvas=document.createElement('canvas');logoCanvas.width=512;logoCanvas.height=128;
  const lc=logoCanvas.getContext('2d');lc.fillStyle='#d8e2f1';lc.font='500 34px -apple-system, sans-serif';lc.textAlign='center';lc.fillText('S A I   R O O M',256,70);
  const logoTex=new THREE.CanvasTexture(logoCanvas);logoTex.colorSpace=THREE.SRGBColorSpace;
  mesh(new THREE.PlaneGeometry(64,16),new THREE.MeshBasicMaterial({map:logoTex,transparent:true,depthWrite:false}),-82,-138,56.5,false);
  // Thin luminous reflections are actual strips sitting on the front pane.
  const shine=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.32,depthWrite:false});
  box(3,153,.3,1,shine,-127,20,51,false);box(1,96,.3,.4,shine,130,18,51,false);
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=256;shadowCanvas.height=256;
  const sc=shadowCanvas.getContext('2d'),gradient=sc.createRadialGradient(128,128,15,128,128,122);gradient.addColorStop(0,'rgba(16,31,58,.24)');gradient.addColorStop(.45,'rgba(16,31,58,.12)');gradient.addColorStop(1,'rgba(16,31,58,0)');sc.fillStyle=gradient;sc.fillRect(0,0,256,256);
  const shadowMap=new THREE.CanvasTexture(shadowCanvas);const floor=new THREE.Mesh(new THREE.PlaneGeometry(370,230),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));floor.rotation.x=-Math.PI/2;floor.position.set(6,-180,12);scene.add(floor);
  const active=new Map(),leaving=new Set();let disposed=false,contextLost=false,angle=-9,latest=[],lastWorld=null;
  const toVector=new THREE.Vector3();
  function cameraAngle(value){angle=clamp(value,-30,30);const a=angle*Math.PI/180;camera.position.set(Math.sin(a)*900,78,Math.cos(a)*900);camera.lookAt(0,0,0);camera.updateMatrixWorld();host.dataset.viewAngle=String(angle);}
  cameraAngle(angle);
  let drag=null,suppressClickUntil=0;
  function setAngle(value){cameraAngle(value);draw();const slider=document.querySelector('#test-view-angle');if(slider){slider.value=String(Math.round(angle));slider.setAttribute('aria-valuetext',`${Math.round(angle)}도`);}}
  function pointerDown(e){if(mini||e.button!==0||!e.isPrimary)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,angle,active:false};}
  function pointerMove(e){if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.active){if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}if(Math.abs(dx)<7)return;drag.active=true;host.setPointerCapture(e.pointerId);host.classList.add('is-dragging');}
    e.preventDefault();setAngle(drag.angle+dx*.24);
  }
  function pointerEnd(e){if(!drag||e.pointerId!==drag.id)return;if(drag.active){suppressClickUntil=performance.now()+350;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);}drag=null;host.classList.remove('is-dragging');}
  function captureClick(e){if(performance.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}}
  function keyboard(e){if(e.target!==host)return;if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();setAngle(e.key==='Home'?0:angle+(e.key==='ArrowLeft'?-5:5));}}
  if(!mini){host.tabIndex=0;host.setAttribute('role','group');host.setAttribute('aria-label','동방 인원 통. 좌우로 끌거나 방향키로 회전');host.addEventListener('pointerdown',pointerDown);host.addEventListener('pointermove',pointerMove);host.addEventListener('pointerup',pointerEnd);host.addEventListener('pointercancel',pointerEnd);host.addEventListener('click',captureClick,true);host.addEventListener('keydown',keyboard);}

  function resize(){if(disposed)return;const b=host.getBoundingClientRect();if(!b.width)return;renderer.setSize(b.width,b.height,false);draw(latest,lastWorld);}
  const ro=new ResizeObserver(resize);ro.observe(host);
  function label(entry,color){
    const c=document.createElement('canvas');c.width=512;c.height=entry.ball?.imageUrl?512:256;const ctx=c.getContext('2d');
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;
    ctx.font='600 126px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
    const title=String(entry.displayName);ctx.fillText(title,256,entry.isSelf?106:128,450);
    if(entry.isSelf){ctx.font='400 51px -apple-system, sans-serif';ctx.globalAlpha=.85;ctx.fillText('나',256,202);}
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    if(entry.ball?.imageUrl){const img=new Image();img.onload=()=>{if(disposed||texture.userData.disposed)return;ctx.clearRect(0,0,512,512);ctx.save();ctx.beginPath();ctx.arc(256,256,249,0,Math.PI*2);ctx.clip();const side=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,512,512);ctx.fillStyle='rgba(13,25,48,.55)';ctx.fillRect(0,350,512,162);ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.font='600 55px -apple-system, "Apple SD Gothic Neo", sans-serif';ctx.fillText(title+(entry.isSelf?' · 나':''),256,406,380);ctx.restore();texture.needsUpdate=true;draw();};img.src=entry.ball.imageUrl;}
    return texture;
  }
  function makeBall(entry){
    const hash=window.SaiSoftPhysics.hash(entry.id),self=entry.isSelf,tone=hash%4,anonymous=entry.kind==='pending'||entry.kind==='private';
    const mat=new THREE.MeshPhysicalMaterial({color:entry.ball?.color||(anonymous?'#d4dde9':self?'#233f6d':PALETTE[tone]),roughness:.52,metalness:0,clearcoat:.12,clearcoatRoughness:.45,envMapIntensity:.45});
    const geometry=new THREE.SphereGeometry(1,40,28),original=geometry.attributes.position.array.slice();
    const ball=mesh(geometry,mat);ball.userData.original=original;
    const patchGeo=new THREE.PlaneGeometry(entry.ball?.imageUrl?1.7:1.65,entry.ball?.imageUrl?1.7:.825,24,24),patchOrig=patchGeo.attributes.position.array.slice();
    const hex=entry.ball?.color?.slice(1),lum=hex?(.2126*parseInt(hex.slice(0,2),16)+.7152*parseInt(hex.slice(2,4),16)+.0722*parseInt(hex.slice(4,6),16)):null;const tex=label(entry,lum!==null?(lum<145?'#ffffff':'#253b60'):!anonymous&&(self||tone===2)?'#ffffff':'#253b60');
    const patch=new THREE.Mesh(patchGeo,new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));ball.add(patch);
    const key=JSON.stringify([entry.id,entry.displayName,entry.isSelf,entry.kind,entry.ball]);
    return{mesh:ball,patch,patchOrig,key,entry,phase:(hash%9-4)*.014,z:(hash%13-6)*.9};
  }
  function disposeBall(b){object.remove(b.mesh);b.mesh.geometry.dispose();b.mesh.material.dispose();b.patch.geometry.dispose();b.patch.material.map.userData.disposed=true;b.patch.material.map.dispose();b.patch.material.dispose();}
  function deform(b,p,world){
    const outline=world?window.SaiSoftPhysics.outline(p,world.particles).points:null;
    const radial=(x,y)=>{if(!outline)return 1;let a=Math.atan2(-y,x);if(a<0)a+=Math.PI*2;const f=(a/(Math.PI*2)*outline.length)%outline.length,i=Math.floor(f),next=(i+1)%outline.length;
      const radius=j=>Math.hypot(outline[j].x-60,outline[j].y-60)/54;return radius(i)*(1-f+i)+radius(next)*(f-i);};
    const arr=b.mesh.geometry.attributes.position.array,orig=b.mesh.userData.original;
    for(let i=0;i<arr.length;i+=3){const x=orig[i],y=orig[i+1],z=orig[i+2],k=radial(x,y);arr[i]=x*k;arr[i+1]=y*k;arr[i+2]=z*(1+(1-k)*.15);}
    b.mesh.geometry.attributes.position.needsUpdate=true;b.mesh.geometry.computeVertexNormals();
    const pa=b.patch.geometry.attributes.position.array;
    for(let i=0;i<pa.length;i+=3){const x=b.patchOrig[i],y=b.patchOrig[i+1],k=radial(x,y);pa[i]=x*k;pa[i+1]=y*k;pa[i+2]=Math.sqrt(Math.max(.01,1-x*x-y*y))*(1+(1-k)*.15)+.038;}
    b.patch.geometry.attributes.position.needsUpdate=true;
    b.mesh.scale.setScalar(p.r);b.mesh.position.set(p.x-180,200-p.y,b.z);b.mesh.visible=p.wait<=0;
    b.patch.rotation.z=0;
  }
  function projection(x,y,z){toVector.set(x,y,z).project(camera);return{x:(toVector.x+1)*180,y:(1-toVector.y)*200};}
  function overlay(record,b){
    const p=record.p,c=projection(b.mesh.position.x,b.mesh.position.y,b.mesh.position.z+p.r*.85),r=p.r*2/.9;
    record.node.style.left=`${c.x/3.6}%`;record.node.style.top=`${c.y/4}%`;record.node.style.width=`${r/3.6}%`;record.node.style.height=`${r/4}%`;record.node.style.clipPath='circle(45%)';
  }
  function depart(record,index=0){
    let b=active.get(record.entry.id);if(b){active.delete(record.entry.id);}else b=makeBall(record.entry);
    deform(b,record.p,null);b.start=performance.now()+Math.min(index*120,480);b.from={x:record.p.x-180,y:200-record.p.y,z:b.z};b.radius=record.p.r;leaving.add(b);
  }
  function clearExits(){for(const b of leaving)disposeBall(b);leaving.clear();}
  function draw(records=latest,world=lastWorld){
    if(disposed||contextLost)return;latest=records;lastWorld=world;const ids=new Set(records.map(r=>r.entry.id));
    for(const [id,b] of active){if(!ids.has(id)){disposeBall(b);active.delete(id);}}
    for(const r of records){let b=active.get(r.entry.id);const key=JSON.stringify([r.entry.id,r.entry.displayName,r.entry.isSelf,r.entry.kind,r.entry.ball]);
      if(b&&b.key!==key){disposeBall(b);active.delete(r.entry.id);b=null;}if(!b){b=makeBall(r.entry);active.set(r.entry.id,b);}deform(b,r.p,world);overlay(r,b);
    }
    const now=performance.now();
    for(const b of leaving){const t=clamp((now-b.start)/1250,0,1);if(t>=1){disposeBall(b);leaving.delete(b);continue;}
      const knots=[{t:0,...b.from,sx:1,sy:1},{t:.35,x:0,y:-98,z:0,sx:.85,sy:1.02},{t:.58,x:0,y:-145,z:35,sx:.58,sy:.86},{t:.78,x:17,y:-158,z:91,sx:.72,sy:.6},{t:1,x:100,y:-168,z:100,sx:.68,sy:.68}];
      const j=Math.max(1,knots.findIndex(k=>k.t>=t)),a=knots[j-1],c=knots[j],v=(t-a.t)/(c.t-a.t),u=v*v*(3-2*v),mix=k=>THREE.MathUtils.lerp(a[k],c[k],u);
      b.mesh.position.set(mix('x'),mix('y'),mix('z'));b.mesh.scale.set(b.radius*mix('sx'),b.radius*mix('sy'),b.radius*.74);b.mesh.rotation.z=-t*.7;
      if(t>.87){b.mesh.material.transparent=true;b.mesh.material.opacity=(1-t)/.13;b.patch.material.opacity=(1-t)/.13;}
    }
    host.dataset.meshCount=String(active.size);host.dataset.exitMeshes=String(leaving.size);
    renderer.render(scene,camera);
  }
  function lost(e){e.preventDefault();contextLost=true;host.classList.remove('has-webgl');host.dataset.renderer='fallback';canvas.hidden=true;for(const r of latest){r.node.style.left=`${r.p.x/3.6}%`;r.node.style.top=`${r.p.y/4}%`;}}
  function angleEvent(e){cameraAngle(Number(e.detail)||0);draw();}
  document.addEventListener('sai-view-angle',angleEvent);
  function dispose(){if(disposed)return;disposed=true;drag=null;host.removeEventListener('pointerdown',pointerDown);host.removeEventListener('pointermove',pointerMove);host.removeEventListener('pointerup',pointerEnd);host.removeEventListener('pointercancel',pointerEnd);host.removeEventListener('click',captureClick,true);host.removeEventListener('keydown',keyboard);ro.disconnect();document.removeEventListener('sai-view-angle',angleEvent);canvas.removeEventListener('webglcontextlost',lost);clearExits();active.forEach(disposeBall);active.clear();const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());env.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
  resize();return{draw,depart,clearExits,dispose};
}
window.SaiBottle3D={create};
