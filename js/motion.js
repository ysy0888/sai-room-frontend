/* Member bottle and roster share one validated in-memory snapshot. */
(function () {
  'use strict';
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const materials = {basic:'frost',water:'glass',lava:'ceramic'};
  let controllers = [], current = null, deltaTimer = null, detailsTrigger = null;
  let members = null, memberError = '', memberLoading = false, memberRequest = 0, memberAbort = null, requestedSequence = null;
  let selectedMember = '', selectedFocused = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time = s => new Date(s).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'});
  const dialog = () => document.querySelector('#presence-dialog');
  const wanted = () => controllers.length > 0 || dialog().open;
  function gauge(style,count,mini=false) { return SaiBottle.markup(materials[style]||'glass',count,mini); }
  function clearMembers() {
    memberRequest++; memberAbort?.abort(); memberAbort=null;
    members=null; memberError=''; memberLoading=false; requestedSequence=null;
  }
  function unmount() {
    controllers.forEach(x=>x.controller.destroy()); controllers=[];
    clearTimeout(deltaTimer); clearMembers();
  }
  function mount(root,reading) {
    unmount(); current=reading;
    root.querySelectorAll('.member-bottle').forEach(el=>{
      const mini=el.classList.contains('mini-vessel');
      const controller=SaiBottle.createRenderer(el,{reduced:media.matches});
      controllers.push({controller,el,mini});
      el.onpointermove=e=>{if(e.pointerType==='touch'||media.matches)return;const b=el.getBoundingClientRect();controller.point((e.clientX-b.left)/b.width*2-1);};
      el.onpointerleave=()=>controller.point(0);
    });
    update(reading,false);
  }
  function paintMembers() {
    controllers.forEach(({controller,el})=>{
      controller.setMembers(members,{loading:memberLoading,error:!!memberError});
      const note=el.querySelector('.bottle-roster-note');
      const stale=members&&(current?.status!=='live'||Date.now()-Date.parse(members.observedAt)>SAI_CONFIG.staleAfterMs);
      if(note)note.textContent=memberLoading?'이름 확인 중':memberError?'이름을 불러오지 못했어요':stale?'마지막 확인 명단':'';
    });
    if(dialog().open)fillDetails();
  }
  function update(reading,animate=true) {
    const previous=current?.snapshot; current=reading;
    const {snapshot,status,source,refreshing}=reading,n=snapshot?.count,cap=snapshot?.referenceCapacity??15;
    const delta=previous&&snapshot?n-previous.count:0;
    if(snapshot?.roster&&snapshot.roster!==members){
      memberRequest++;memberAbort?.abort();memberAbort=null;
      members=snapshot.roster;memberError='';memberLoading=false;requestedSequence=snapshot.sequence;
    }
    if(members&&snapshot&&members.sequence===snapshot.sequence&&members.count===snapshot.count&&status==='live')members.observedAt=snapshot.observedAt;
    // A changed snapshot invalidates names immediately, until a matching roster arrives.
    if(members && snapshot && (members.sequence!==snapshot.sequence || members.count!==snapshot.count)) {
      members=null;
      controllers.forEach(({controller})=>controller.setMembers(null));
    }
    controllers.forEach(({controller,el})=>{
      const roster=members;
      controller.update({count:snapshot?n:null,capacity:cap,roster,paused:status!=='live',reduced:media.matches});
      const num=el.querySelector('.vessel-value');
      if(num)num.textContent=snapshot?n:'—';
      el.dataset.connection=status;
      const trigger=el.querySelector('.vessel-touch');
      if(trigger)trigger.setAttribute('aria-label',snapshot?`이용 중인 회원 ${n}명 전체 보기`:'현황 확인 정보 보기');
    });
    const label=document.querySelector('#occupancy-mood');if(label)label.textContent=snapshot?SaiLiquid.occupancyLabel(n,cap):'현황 확인 중';
    const connection=document.querySelector('#presence-connection');
    if(connection){connection.dataset.state=status;connection.innerHTML=`<i></i>${{live:'실시간',stale:'갱신 지연',offline:'오프라인',loading:'연결 중',error:'연결 확인'}[status]}`;}
    const updated=document.querySelector('#presence-updated');
    if(updated)updated.textContent=snapshot?`${time(snapshot.observedAt)} 확인${status==='live'?'':' · 마지막 확인값'}`:status==='loading'?'현황 확인 중':'확인된 인원 없음';
    const refresh=document.querySelector('[data-action="refresh"]');
    if(refresh){refresh.disabled=refreshing;refresh.classList.toggle('spinning',refreshing);const caption=refresh.querySelector('span');if(caption)caption.textContent=refreshing?'확인 중':'새로고침';refresh.setAttribute('aria-label',refreshing?'현황 확인 중':'현황 새로고침');}
    const issue=document.querySelector('#presence-issue');
    if(issue){issue.hidden=status==='live'||status==='loading';issue.textContent=snapshot?(status==='offline'?'오프라인입니다. 마지막 확인 인원을 표시합니다.':'현황 갱신이 지연되어 마지막 확인 인원을 표시합니다.'):'인원을 확인할 수 없습니다. 연결 후 새로고침해주세요.';}
    const live=document.querySelector('#presence-live');
    if(live&&delta)live.textContent=`현재 ${n}명. ${Math.abs(delta)}명 ${delta>0?'늘었습니다':'줄었습니다'}.`;
    if(delta&&animate){const badge=document.querySelector('.change-badge');if(badge){clearTimeout(deltaTimer);badge.textContent=`${delta>0?'+':''}${delta}명`;badge.classList.remove('show');void badge.offsetWidth;badge.classList.add('show');deltaTimer=setTimeout(()=>badge.classList.remove('show'),2400);}}
    if(wanted() && snapshot && snapshot.sequence!==requestedSequence)loadMembers();
    else paintMembers();
    const range=document.querySelector('#motion-count');if(range&&document.activeElement!==range)range.value=n??0;
    const rangeValue=document.querySelector('#motion-count-value');if(rangeValue)rangeValue.textContent=snapshot?`${n}명`:'—';
    const homeValue=document.querySelector('#home-count-value');if(homeValue)homeValue.innerHTML=`${n??0}<small>명</small>`;
  }
  function fillDetails() {
    const d=document.querySelector('#presence-details-body');if(!d||!current)return;
    if(memberLoading){d.innerHTML='<div class="members-loading" role="status"><span class="loading-orbit" aria-hidden="true"></span><p>회원 목록을 불러오는 중입니다.</p></div>';return;}
    if(memberError){d.innerHTML=`<div class="members-empty" role="alert"><p>${esc(memberError)}</p><button class="secondary-button members-refresh" data-action="refresh-members">다시 불러오기</button></div>`;return;}
    if(!members){d.innerHTML='<div class="members-empty"><p>현황을 확인하고 있습니다.</p></div>';return;}
    const stale=current.status!=='live'||Date.now()-Date.parse(members.observedAt)>SAI_CONFIG.staleAfterMs;
    d.innerHTML=`<div class="members-summary"><div><strong>${members.count}</strong><span>명 이용 중</span></div></div><div class="members-updated"><span>${time(members.observedAt)} 기준${stale?' · 마지막 확인 명단':''}</span><button class="text-button members-refresh" data-action="refresh-members" aria-label="회원 목록 새로고침">새로고침</button></div>${members.count===0?'<div class="members-empty"><p>현재 이용 중인 회원이 없습니다.</p></div>':`<ul class="member-list">${members.members.map((m,i)=>`<li class="member-row ${m.id===selectedMember?'member-highlight':''}" data-member-id="${esc(m.id)}" ${m.id===selectedMember?'tabindex="-1" aria-current="true"':''}><span class="member-avatar tone-${i%3}" aria-hidden="true">${esc(m.displayName.slice(0,1))}</span><strong>${esc(m.displayName)}</strong>${m.isSelf?'<span class="member-self">나</span>':''}</li>`).join('')}${members.hiddenCount?`<li class="member-row anonymous-members"><span class="member-avatar" aria-hidden="true">—</span><strong>이름 비공개</strong><span>${members.hiddenCount}명</span></li>`:''}</ul>`}`;
    if(selectedMember&&!selectedFocused){selectedFocused=true;queueMicrotask(()=>{const row=d.querySelector('.member-highlight');if(row&&dialog().open){row.scrollIntoView({block:'nearest'});row.focus({preventScroll:true});}});}
  }
  async function loadMembers() {
    if(!wanted()||!current?.snapshot)return;
    const request=++memberRequest;memberAbort?.abort();memberAbort=new AbortController();
    const snap=current.snapshot; requestedSequence=snap.sequence;
    memberError='';memberLoading=true;
    paintMembers();
    try {
      const data=await SaiBackend.members(memberAbort.signal);
      if(request!==memberRequest||!wanted())return;
      if(data.sequence!==current.snapshot?.sequence||data.count!==current.snapshot?.count)throw new Error('인원과 명단을 동기화하고 있습니다. 다시 불러와주세요.');
      members=data;
    } catch(e) {
      if(request!==memberRequest)return;
      members=null;
      memberError=e.status===403?'회원 목록을 볼 권한이 없습니다.':e.message||'회원 목록을 불러오지 못했습니다.';
    } finally {
      if(request===memberRequest){memberLoading=false;paintMembers();}
    }
  }
  function openDetails(trigger) {
    detailsTrigger=trigger;selectedMember=trigger?.dataset.memberId||'';selectedFocused=false;
    dialog().showModal();
    if(members||memberLoading||memberError)fillDetails();else loadMembers();
  }
  function closeDetails(){if(dialog().open)dialog().close();}
  dialog().addEventListener('close',()=>{
    selectedMember='';selectedFocused=false;document.querySelector('#presence-details-body').replaceChildren();
    if(!controllers.length)clearMembers();
    const target=detailsTrigger?.isConnected?detailsTrigger:document.querySelector('.vessel-touch');
    target?.focus({preventScroll:true});detailsTrigger=null;
  });
  window.addEventListener('sai:session-expired',()=>{clearMembers();controllers.forEach(({controller})=>controller.setMembers(null));document.querySelector('#presence-details-body').replaceChildren();closeDetails();});
  media.addEventListener('change',()=>{if(current)update(current,false);});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.dataset.action==='presence-details')openDetails(b);if(b.dataset.action==='close-presence')closeDetails();if(b.dataset.action==='refresh-members')loadMembers();});
  function tilt(slope,impulse=0){controllers.forEach(({controller,mini})=>{if(!mini)controller.tilt(slope,impulse);});}
  window.SaiMotion={tilt,gauge,mount,unmount,update,openDetails,closeDetails,esc};
})();
