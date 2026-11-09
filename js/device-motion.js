/* Opt-in device physics. Sensor values never leave memory. */
(function(){
  'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let enabled=false,pending=false,message='통을 좌우로 끌어 돌려보세요. 기기 움직임을 켜면 공이 흔들립니다.',timer=0,lastSample=0,lastImpulse=0,received=false,slope=0,lastAcceleration=null,revision=0;
  function paint(){document.querySelectorAll('[data-action="device-motion"]').forEach(button=>{button.setAttribute('aria-pressed',String(enabled));button.disabled=pending;});const state=document.querySelector('#device-motion-state'),hint=document.querySelector('#device-motion-message');if(state)state.textContent=pending?'연결 중':enabled?'기기 움직임 켜짐':'기기 움직임 켜기';if(hint)hint.textContent=message;}
  function stop(){revision++;enabled=false;pending=false;clearTimeout(timer);window.removeEventListener('deviceorientation',orientation);window.removeEventListener('devicemotion',motion);lastAcceleration=null;slope=0;message='통을 좌우로 끌어 돌려보세요. 기기 움직임을 켜면 공이 흔들립니다.';SaiMotion.tilt(0);paint();}
  function sample(){if(!received){received=true;clearTimeout(timer);message='기기를 기울이거나 흔들어보세요. 빈 공간이 많을수록 공이 크게 움직입니다.';paint();}}
  function orientation(event){if(!enabled||document.hidden||reduced.matches||!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;sample();slope=SaiLiquid.orientationSlope(event.beta,event.gamma,screen.orientation?.angle??window.orientation??0);SaiMotion.tilt(slope);}
  function motion(event){if(!enabled||document.hidden||reduced.matches)return;const now=performance.now();if(now-lastSample<32)return;lastSample=now;const a=event.acceleration,g=event.accelerationIncludingGravity;let strength=0;
    if(a&&[a.x,a.y,a.z].every(Number.isFinite)){sample();strength=Math.hypot(a.x,a.y,a.z);}
    else if(g&&[g.x,g.y,g.z].every(Number.isFinite)){sample();if(lastAcceleration)strength=Math.hypot(g.x-lastAcceleration.x,g.y-lastAcceleration.y,g.z-lastAcceleration.z);lastAcceleration={x:g.x,y:g.y,z:g.z};}
    if(strength>1.4&&now-lastImpulse>110){lastImpulse=now;SaiMotion.tilt(slope,Math.min(.32,(strength-1.4)*.028));}
  }
  async function toggle(){if(pending)return;if(enabled){stop();message='기기 움직임을 껐습니다. 통은 손으로 돌릴 수 있습니다.';paint();return;}
    if(reduced.matches){message='‘움직임 줄이기’ 설정에 따라 흔들림 효과를 꺼두었습니다.';paint();return;}
    if(!isSecureContext){message='휴대폰 센서를 사용하려면 HTTPS로 접속해주세요.';paint();return;}
    if(!window.DeviceOrientationEvent&&!window.DeviceMotionEvent){message='이 기기는 센서를 지원하지 않습니다. 통은 좌우로 끌어 돌릴 수 있습니다.';paint();return;}
    pending=true;message='센서 연결 중';const version=++revision;paint();
    try{
      const types=[window.DeviceOrientationEvent,window.DeviceMotionEvent];
      const permissions=await Promise.all(types.map(Type=>!Type?Promise.resolve('denied'):typeof Type.requestPermission==='function'?Type.requestPermission():Promise.resolve('granted')));
      if(version!==revision)return;
      if(permissions.every(p=>p!=='granted')){message='센서 사용을 허용하지 않았습니다. 통은 손으로 돌릴 수 있습니다.';return;}
      enabled=true;received=false;lastSample=lastImpulse=0;message='기기를 조금 움직여 연결을 확인해주세요.';
      if(permissions[0]==='granted')window.addEventListener('deviceorientation',orientation,{passive:true});if(permissions[1]==='granted')window.addEventListener('devicemotion',motion,{passive:true});
      timer=setTimeout(()=>{if(!received){stop();message='센서 값을 받지 못했습니다. 지원하는 휴대폰에서 다시 시도해주세요.';paint();}},7000);
    }catch{if(version===revision){stop();message='센서 권한을 확인해주세요. 통은 손으로 돌릴 수 있습니다.';paint();}}
    finally{if(version===revision){pending=false;paint();}}
  }
  reduced.addEventListener('change',()=>{if(reduced.matches&&(enabled||pending)){stop();message='움직임 줄이기 설정에 따라 기기 효과를 껐습니다.';paint();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){lastAcceleration=null;SaiMotion.tilt(0);}});
  window.addEventListener('pagehide',stop);
  window.SaiDeviceMotion={toggle,stop,get enabled(){return enabled;},get message(){return message;}};
})();
