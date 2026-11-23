'use strict';
let renderer,material;
window.updateScene=data=>{if(!renderer||material!==data.material){renderer?.destroy();material=data.material||'glass';document.querySelector('#scene').innerHTML=SaiBottle.markup(material,null,false);renderer=SaiBottle.createRenderer(document.querySelector('.member-bottle'));}document.body.dataset.theme=data.theme||'light';renderer.update({count:data.count,capacity:data.referenceCapacity||15,roster:data,reduced:data.reduced===true,paused:data.paused===true});};
window.tiltScene=(slope,impulse)=>renderer?.tilt(slope,impulse);
let pointer=null;document.addEventListener('pointerdown',e=>pointer=e.clientX);document.addEventListener('pointermove',e=>{if(pointer!==null){renderer?.tilt((e.clientX-pointer)/180,(e.clientX-pointer)/700);pointer=e.clientX;}});document.addEventListener('pointerup',()=>{pointer=null;renderer?.tilt(0);});document.addEventListener('pointercancel',()=>pointer=null);
document.addEventListener('click',e=>{if(e.target.closest('[data-action="presence-details"]'))SaiScene.postMessage('members');});
SaiScene.postMessage('ready');
