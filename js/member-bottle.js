/* One soft name ball per member. The bounded renderer shares the roster's identity. */
(function(){
  'use strict';
  const MAX_TAGS=30, esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let serial=0;
  function entries(count,roster,previous=[]){
    if(!Number.isInteger(count)||count<0)return[];
    const valid=roster?.count===count,known=valid?roster.members:[],byId=new Map(known.map(m=>[m.id,m]));
    const ordered=previous.filter(e=>byId.has(e.id)).map(e=>byId.get(e.id)),retained=new Set(ordered.map(e=>e.id));ordered.push(...known.filter(m=>!retained.has(m.id)));
    const limit=count>MAX_TAGS?MAX_TAGS-1:count,result=ordered.slice(0,limit).map(m=>({...m,kind:'member'}));
    for(let i=result.length;i<limit;i++)result.push({id:`anonymous-${i}`,kind:valid?'private':'pending',displayName:valid?'비공개':'회원'});
    if(count>MAX_TAGS)result.push({id:'overflow',kind:'overflow',displayName:`+${count-limit}명`});return result;
  }
  function markup(material,count,mini){
    const id=`gacha-${++serial}`;
    return `<div class="liquid-vessel member-bottle gacha-machine ${mini?'mini-vessel':''}" data-material="${material}" data-reduced="false">
      <div class="bottle-scene">
        <svg class="bottle-glass bottle-back" viewBox="0 0 360 400" aria-hidden="true"><defs>
          <linearGradient id="${id}-glass"><stop stop-color="#ccd8ea" stop-opacity=".65"/><stop offset=".13" stop-color="#fff" stop-opacity=".62"/><stop offset=".55" stop-color="#e6edf9" stop-opacity=".22"/><stop offset=".91" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#b8c8e1" stop-opacity=".6"/></linearGradient>
          <linearGradient id="${id}-metal" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#dce5f2"/><stop offset="1" stop-color="#b6c5de"/></linearGradient>
          <linearGradient id="${id}-base" x2="0" y2="1"><stop stop-color="#33496e"/><stop offset="1" stop-color="#1c2d59"/></linearGradient>
          <clipPath id="${id}-clip" clipPathUnits="objectBoundingBox"><path d="M.37 0H.63V.155H.81Q.89 .155 .89 .23V.69Q.89 .78 .80 .78H.20Q.11 .78 .11 .69V.23Q.11 .155 .19 .155H.37Z"/></clipPath>
        </defs>
        <ellipse class="bottle-ground" cx="180" cy="380" rx="113" ry="8" fill="#152749" opacity=".12"/>
        <path class="bottle-body" d="M76 58H284C309 58 326 74 326 101V271C326 299 310 315 282 315H78C50 315 34 299 34 271V101C34 74 51 58 76 58Z" fill="url(#${id}-glass)" stroke="#b8c9e0" stroke-width="1.3"/>
        <path d="M76 65H284C306 65 318 78 318 101V272C318 296 306 306 282 306H78C54 306 42 296 42 272V101C42 78 54 65 76 65Z" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2"/>
        <rect x="128" y="27" width="104" height="30" rx="13" fill="url(#${id}-metal)" stroke="#c0cde1"/>
        <ellipse cx="180" cy="29" rx="43" ry="8" fill="#879ab8"/><ellipse cx="180" cy="27" rx="41" ry="5" fill="#1c2d59" opacity=".65"/>
        <path d="M140 39Q180 48 220 39" stroke="#fff" stroke-width="2" fill="none"/>
        <rect x="54" y="303" width="252" height="62" rx="20" fill="url(#${id}-base)"/>
        <rect x="147" y="327" width="66" height="38" rx="16" fill="#101d39"/>
        <path d="M158 338Q180 331 202 338" stroke="#ffffff18" fill="none" stroke-width="2"/>
        <path d="M137 364H223L246 378H114Z" fill="url(#${id}-metal)" stroke="#c2cee2"/>
        <path d="M124 373H236" stroke="#fff" stroke-width="2"/>
        </svg>
        <div class="bottle-inscription" aria-hidden="true">SAI</div>
        <div class="bottle-tags" style="clip-path:url(#${id}-clip)" ${mini?'aria-hidden="true"':'role="group" aria-label="동방에 있는 회원"'}></div>
        <div class="gacha-exits" aria-hidden="true"></div>
        <div class="bottle-empty" hidden><span></span><p>지금은 비어 있어요</p></div>
        <svg class="bottle-glass bottle-front" viewBox="0 0 360 400" aria-hidden="true">
          <path class="bottle-reflection" d="M67 83C53 92 51 107 51 130V251" fill="none" stroke="white" stroke-width="7" stroke-linecap="round"/>
          <path d="M309 109V252" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".75"/>
          <path d="M74 307Q180 313 286 307" fill="none" stroke="#fff" stroke-width="3" opacity=".8"/>
          <path class="gacha-front-base" d="M74 303H286Q306 303 306 323V345Q306 365 286 365H213V343Q213 327 197 327H163Q147 327 147 343V365H74Q54 365 54 345V323Q54 303 74 303Z" fill="url(#${id}-base)"/>
          <path d="M77 309H283" fill="none" stroke="#ffffff24" stroke-width="1"/>
          <circle cx="82" cy="334" r="2" fill="#ffffff44"/><circle cx="278" cy="334" r="2" fill="#ffffff44"/>
          <path class="gacha-gate" d="M151 330Q180 321 209 330" stroke="#c1cde3" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>
        <span class="gacha-wordmark" aria-hidden="true">SAI ROOM</span>
      </div>
      ${mini?'':`<div class="bottle-summary"><div><strong class="vessel-value">${Number.isInteger(count)?count:'—'}</strong><span>명 이용 중</span></div><button class="vessel-touch" data-action="presence-details">전체 보기 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button></div><div class="bottle-roster-note"></div><span class="change-badge" aria-hidden="true"></span>`}
    </div>`;
  }
  function skin(entry){
    const h=SaiSoftPhysics.hash(entry.id),tone=entry.isSelf?'self':h%4,id=`ball-skin-${++serial}`;
    return {tone,html:`<svg class="ball-skin" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="${id}" cx="32%" cy="24%" r="80%"><stop class="ball-light"/><stop class="ball-mid" offset=".5"/><stop class="ball-shade" offset="1"/></radialGradient></defs><path class="ball-surface" fill="url(#${id})" stroke-width=".8"/><path class="ball-seam" fill="none" stroke-width="1.5" d="M26 32Q34 21 46 20" stroke-linecap="round"/></svg><span class="ball-label"><span>${esc(entry.displayName)}</span>${entry.isSelf?'<small>나</small>':''}</span>`};
  }
  function createRenderer(el,options={}){
    const scene=el.querySelector('.bottle-scene'),layer=el.querySelector('.bottle-tags'),exitLayer=el.querySelector('.gacha-exits'),mini=el.classList.contains('mini-vessel');
    let solid=null;try{solid=window.SaiBottle3D?.create(scene,{material:el.dataset.material,mini});}catch(e){console.warn("3D renderer unavailable; using accessible fallback",e);}
    const world=SaiSoftPhysics.createWorld();let count=null,capacity=15,roster=null,previous=[],records=new Map(),reduced=!!options.reduced,paused=false,destroyed=false,raf=0,last=0,awakeUntil=0;
    const exits=new Map();let exitTimer=0,lastConfirmed=new Map();
    const canMove=()=>!reduced&&!paused&&!document.hidden&&!mini;
    function depart(record,index){
      if(!canMove()){record.node.remove();return;}
      solid?.depart(record,index);
      const node=record.node;node.classList.remove('bottle-tag');node.classList.add('ball-departing');node.removeAttribute('data-action');node.removeAttribute('data-member-id');node.removeAttribute('data-id');node.removeAttribute('aria-label');node.setAttribute('aria-hidden','true');node.tabIndex=-1;node.disabled=true;exitLayer.append(node);
      const p=record.p,scale=scene.clientWidth/360,at=(x,y,sx,sy,rotate=0)=>`translate(calc(-50% + ${(x-p.x)*scale}px),calc(-50% + ${(y-p.y)*scale}px)) scale(${sx},${sy}) rotate(${rotate}deg)`;
      node.style.clipPath='none';node.querySelector('.ball-surface').setAttribute('d','M60 6A54 54 0 1 1 59.99 6Z');
      const anim=node.animate([{transform:at(p.x,p.y,1,1),opacity:1,offset:0},{transform:at(180,299,.85,1.02),opacity:1,offset:.35},{transform:at(180,344,.58,.86),opacity:1,offset:.58},{transform:at(197,369,.72,.60),opacity:1,offset:.75},{transform:at(278,373,.68,.68,70),opacity:0,offset:1}],{duration:1250,delay:Math.min(index*120,480),easing:'cubic-bezier(.35,.05,.35,1)',fill:'forwards'});
      exits.set(node,anim);anim.onfinish=()=>{node.remove();exits.delete(node);};
      el.classList.add('is-dispensing');clearTimeout(exitTimer);exitTimer=setTimeout(()=>el.classList.remove('is-dispensing'),1800);
    }
    function sync(){
      if(destroyed)return;
      const next=entries(count,roster,previous),ids=new Set(next.map(e=>e.id)),confirmed=roster?.count===count;
      world.configure(count??0,capacity,next.length);
      const missing=[...records.values()].filter(r=>!ids.has(r.entry.id));
      let additions=0,departures=0;const claimed=new Set(),departed=new Set();
      for(const entry of next){
        let record=records.get(entry.id);
        // Loading/permission states reuse geometry while erasing old identity text.
        if(!record){const reusable=missing.find(r=>!claimed.has(r)&&(!confirmed||r.entry.kind==='pending'));
          if(reusable){claimed.add(reusable);records.delete(reusable.entry.id);record=reusable;record.p.id=entry.id;records.set(entry.id,record);}
        }
        if(!record){const node=document.createElement(mini?'span':'button');layer.append(node);record={node,p:world.add(entry.id,Math.min(additions++*.115,1.1)),entry:null};records.set(entry.id,record);}
        const changed=record.entry?.id!==entry.id||record.entry?.displayName!==entry.displayName||record.entry?.isSelf!==entry.isSelf||record.entry?.kind!==entry.kind||JSON.stringify(record.entry?.ball)!==JSON.stringify(entry.ball);
        if(changed){const s=skin(entry);record.node.innerHTML=s.html;record.node.className=`bottle-tag member-ball tag-${entry.kind} ball-tone-${s.tone}`;}
        record.entry=entry;const node=record.node;if(entry.ball?.color){node.style.setProperty('--ball-mid',entry.ball.color);node.querySelector('.ball-mid')?.setAttribute('style',`stop-color:${entry.ball.color}`);}const oldImage=node.querySelector('.ball-photo');if(oldImage)oldImage.remove();if(entry.ball?.imageUrl){const image=document.createElement('img');image.className='ball-photo';image.alt='';image.src=entry.ball.imageUrl;node.prepend(image);}
        node.dataset.id=entry.id;
        if(!mini){node.type='button';node.dataset.action='presence-details';node.dataset.memberId=entry.kind==='member'?entry.id:'';node.setAttribute('aria-label',entry.kind==='member'?`${entry.displayName}${entry.isSelf?', 나':''}. 회원 목록에서 보기`:entry.kind==='overflow'?`다른 ${count-MAX_TAGS+1}명. 전체 회원 보기`:entry.kind==='private'?'이름 비공개 회원. 전체 회원 보기':'회원 이름 확인 중. 전체 회원 보기');}
      }
      for(const record of missing){if(ids.has(record.entry.id))continue;records.delete(record.entry.id);world.remove(record.p);if(confirmed&&record.entry.kind!=='pending'){departed.add(record.entry.id);depart(record,departures++);}else record.node.remove();}
      // In HTTP mode count and roster arrive separately. Restore only the accepted
      // departing member as a brief, inert exit effect after the matching roster arrives.
      if(confirmed){for(const [id,saved] of lastConfirmed){if(ids.has(id)||departed.has(id))continue;const node=document.createElement('span'),s=skin(saved.entry);node.className=`member-ball ball-tone-${s.tone}`;node.innerHTML=s.html;node.style.left=`${saved.p.x/360*100}%`;node.style.top=`${saved.p.y/400*100}%`;node.style.width=`${saved.p.r*2/0.9/360*100}%`;node.style.height=`${saved.p.r*2/0.9/400*100}%`;depart({node,p:{...saved.p,wait:0},entry:saved.entry},departures++);}lastConfirmed.clear();}
      if(confirmed)previous=next.map(e=>({id:e.id}));
      el.dataset.count=count??'unknown';el.dataset.full=String(count!==null&&count>=capacity);el.style.setProperty('--crowding',world.config.pressure.toFixed(3));el.querySelector('.bottle-empty').hidden=count!==0;
      if(!canMove()){world.settle();paint();}else{wake(3800);paint();}
    }
    function paint(){
      for(const {node,p} of records.values()){
        const shape=SaiSoftPhysics.outline(p,world.particles),size=p.r*2/0.9;
        node.style.left=`${p.x/360*100}%`;node.style.top=`${p.y/400*100}%`;node.style.width=`${size/360*100}%`;node.style.height=`${size/400*100}%`;node.style.opacity=p.wait>0?'0':'1';node.style.clipPath='none';
        node.querySelector('.ball-surface').setAttribute('d',shape.path);node.dataset.x=p.x.toFixed(2);node.dataset.y=p.y.toFixed(2);node.dataset.squash=p.squash.toFixed(3);
        node.style.setProperty('--ball-font',`${Math.max(9,Math.min(12,p.r*.32))}px`);
        node.style.setProperty('--label-tilt',`${((p.seed%9)-4)}deg`);
      }
      solid?.draw([...records.values()],world);
      if(roster?.count===count){for(const record of records.values())if(record.entry.kind==='member')lastConfirmed.set(record.entry.id,{entry:{...record.entry},p:{x:record.p.x,y:record.p.y,r:record.p.r}});}
    }
    function frame(now){
      raf=0;if(destroyed||!canMove())return;
      const dt=last?Math.min((now-last)/1000,.1):1/60;last=now;
      // Fixed small steps prevent large impulses after a slow frame.
      const steps=Math.max(1,Math.ceil(dt/(1/90)));for(let i=0;i<steps;i++)world.step(dt/steps);
      paint();if(now<awakeUntil)raf=requestAnimationFrame(frame);else{world.settle();paint();last=0;el.dataset.settled='true';}
    }
    function wake(ms){el.dataset.settled='false';awakeUntil=performance.now()+ms;if(!raf&&canMove())raf=requestAnimationFrame(frame);}
    function stopExits(){solid?.clearExits();exits.forEach((a,n)=>{a.cancel();n.remove();});exits.clear();clearTimeout(exitTimer);el.classList.remove('is-dispensing');}
    function update(value){
      const before=count;count=value.count??null;capacity=Math.max(1,value.capacity??capacity);if('roster'in value)roster=value.roster;reduced=value.reduced??reduced;paused=value.paused??paused;
      el.dataset.reduced=String(reduced);el.dataset.paused=String(paused||document.hidden);
      if(!canMove()){cancelAnimationFrame(raf);raf=0;last=0;world.gravity=0;stopExits();}
      sync();if(before===count&&!canMove())paint();
    }
    function setMembers(value,state={}){roster=value;if(!value)stopExits();if(state.error)lastConfirmed.clear();sync();}
    function tilt(slope,impulse=0){if(!canMove())return;world.gravity=Math.max(-.8,Math.min(.8,slope));if(impulse)world.impulse(impulse*(.22+.78*(1-Math.min(1,world.config.ratio))));wake(2800);}
    function visibility(){el.dataset.paused=String(paused||document.hidden);cancelAnimationFrame(raf);raf=0;last=0;if(document.hidden){stopExits();}else if(canMove())wake(1800);}
    document.addEventListener('visibilitychange',visibility);
    return {update,setMembers,tilt,point(x){if(!reduced)scene.style.setProperty('--light-shift',`${x*2}px`);},ripple(){if(canMove()){world.impulse(.025);wake(1500);}},destroy(){destroyed=true;cancelAnimationFrame(raf);stopExits();solid?.dispose();records.clear();lastConfirmed.clear();world.particles=[];previous=[];roster=null;document.removeEventListener('visibilitychange',visibility);}};
  }
  window.SaiBottle={markup,createRenderer,entries,MAX_TAGS};
})();
