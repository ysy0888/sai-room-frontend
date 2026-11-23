/* SAI ROOM frontend: static app with replaceable HTTP transport. */
(function () {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const view = $("#view"),
    header = $("#header"),
    nav = $("#nav");
  let state = SaiData.load(),
    selectedDate = SaiData.day(),
    selectedSlot = { date: selectedDate, start: 1200, end: 1260 };
  let boardKind = "public",
    boardFilter = "전체",
    draftCustom = null,
    currentRoute = "",
    toastTimer,
    confirmResolver;
  let selectedTimeEdited = false;
  let busy = false, bootError = '', sessionExpired = false, authenticated = false, booting = false, authRevision = 0;
  const remote = true;
  let signupEmail='',signupDone=false,applicationFilter='pending',applications=null,applicationsError='',applicationsLoading=false,applicationRevision=0;
  let ball={anonymous:false,color:'#233f6d',imageId:null,imageUrl:null},draftBall=null;
  const user=()=>SaiBackend.user;
  const approved=()=>authenticated&&user()?.membershipStatus==='approved';
  const staff=()=>approved()&&['operator','admin'].includes(user()?.role);
  const admin=()=>approved()&&user()?.role==='admin';
  const inboxRoute=()=>staff()?'inbox':'messages';
  const roleName=()=>({member:'멤버',operator:'운영진',admin:'관리자'}[user()?.role]||'멤버');
  let codeInfo=null,codeError='',codeLoading=false,codeSuccess=false,checkedIn=false,firstBoot=true;
  let reading = SaiPresence.current();
  function requestError(e, target) { if (target) target.textContent = e.message; else toast(e.message); }
  async function mutate(task, button, errorTarget) {
    if (busy) return false;
    busy = true; if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
    const revision=authRevision;
    try { await task(); return revision===authRevision; } catch(e) { requestError(e,errorTarget); return false; }
    finally { busy = false; if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
  }
  const icons = {
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m3 0h2M7 17h2m3 0h2"/>',
    chat: '<path d="M20 14a5 5 0 0 1-5 5H8l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4zM7 8h9M7 12h6"/>',
    palette:
      '<path d="M12 3C6 3 3 7 3 12s4 9 9 9h2c2 0 3-2 2-4s0-3 2-3h1c3 0 3-5 0-8-2-2-4-3-7-3z"/><circle cx="8" cy="8" r="1"/><circle cx="14" cy="7" r="1"/><circle cx="7" cy="13" r="1"/>',
    gear: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',
    back: '<path d="M15 4l-8 8 8 8"/>',
    next: '<path d="M9 4l8 8-8 8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12l4 4L19 6"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
    home: '<path d="M3 11l9-8 9 8v10H3zM9 21v-8h6v8"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    edit: '<path d="M4 16l12-12 4 4L8 20H4zM14 6l4 4"/>',
    person:
      '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.home}</svg>`;
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const uid = () =>
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  const time = (n) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const dateObj = (s) => new Date(`${s}T12:00:00`);
  const addDay = (s, n) => {
    const d = dateObj(s);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtDate = (s, full = true) =>
    dateObj(s).toLocaleDateString(
      "ko-KR",
      full
        ? { year: "numeric", month: "long", day: "numeric", weekday: "short" }
        : { month: "long", day: "numeric", weekday: "short" },
    );
  const relative = (t) => {
    const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
    return m < 1
      ? "방금 전"
      : m < 60
        ? `${m}분 전`
        : m < 1440
          ? `${Math.floor(m / 60)}시간 전`
          : `${Math.floor(m / 1440)}일 전`;
  };
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("visible");
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      3000,
    );
  }
  function save(message) { if(message)toast(message); }
  function go(route) {
    if(route==="board")boardKind="public";
    if (location.hash.slice(1) === route) render();
    else location.hash = route;
  }
  function confirmAction(title, message, button = "확인") {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      $("#confirm-title").textContent = title;
      $("#confirm-message").textContent = message;
      $("#confirm-yes").textContent = button;
      $("#confirm-dialog").showModal();
      $("#confirm-no").focus();
    });
  }
  function closeConfirm(result) {
    $("#confirm-dialog").close();
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  }
  $("#confirm-no").onclick = () => closeConfirm(false);
  $("#confirm-yes").onclick = () => closeConfirm(true);
  $("#confirm-dialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeConfirm(false);
  });
  function gauge(style = state.settings.gauge, count = state.settings.occupancy, mini = false) {
    return SaiMotion.gauge(style, count, mini);
  }
  function appHeader(title, back, action = "") {
    header.innerHTML = `${back ? `<button class="icon-button" data-action="go" data-route="${back}" aria-label="이전 화면">${icon("back")}</button>` : '<span class="header-spacer"></span>'}<h1 class="sr-only">${title}</h1><div class="header-actions">${action}</div>`;
    header.dataset.empty=String(!back&&!action);
  }
  function setActions(html = "") {
    const dock = $("#action-dock");
    dock.innerHTML = html;
    dock.hidden = !html;
  }
  function mainNav(active, show = true) {
    nav.hidden = !show;
    nav.innerHTML = [
      ["home", "home", "동방"],
      ["reservations", "calendar", "예약"],
      ["board", "chat", "게시판"],
      [inboxRoute(), "chat", staff()?"문의함":"내 문의"],
    ]
      .map(
        ([r, i, label]) =>
          `<button class="nav-item ${(r === active || (active === "messages" && r === inboxRoute())) ? "active" : ""}" data-action="go" data-route="${r}" ${(r === active || (active === "messages" && r === inboxRoute())) ? 'aria-current="page"' : ""}>${icon(i)}<span>${label}</span></button>`,
      )
      .join("");
  }
  function nextFreeSlot() {
    const now = new Date(), current = Number(now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).slice(0,2))*60+Number(now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).slice(3,5));
    for(let d=0;d<7;d++) { const date=addDay(SaiData.day(),d);for(let start=Math.max(540,d?540:Math.ceil((current+1)/30)*30);start<1380;start+=30) {const end=Math.min(start+60,1380);if(!overlapping({date,start,end}))return{date,start,end};if(!overlapping({date,start,end:start+30}))return{date,start,end:start+30};} }
    return null;
  }
  function authField(id,label,type,autocomplete,placeholder,min=''){
    return `<div class="auth-field"><label for="${id}">${label}</label><div class="${type==='password'?'auth-password':''}"><input id="${id}" name="${id.split('-').slice(1).join('-')}" type="${type}" autocomplete="${autocomplete}" ${id.endsWith('-email')?'inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254"':`maxlength="${type==='password'?128:id.endsWith('-studentId')?20:40}"`} ${min?`minlength="${min}"`:''} placeholder="${placeholder}" required>${type==='password'?`<button type="button" data-action="toggle-password" data-target="${id}" aria-label="비밀번호 표시" aria-pressed="false">표시</button>`:''}</div></div>`;
  }
  function operatorCodeField(){
    return `<details class="auth-operator"><summary><span>운영진 코드</span><span class="auth-optional">선택 입력</span></summary><div class="auth-field"><label class="sr-only" for="signup-operatorCode">운영진 코드</label><input id="signup-operatorCode" name="operatorCode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="128" placeholder="전달받은 코드 입력" aria-describedby="operator-code-help"><p id="operator-code-help">코드를 입력하면 운영진으로 가입을 신청합니다.<br>코드가 없으면 멤버로 신청됩니다.</p></div></details>`;
  }
  function loginScreen(signup=false) {
    appHeader(signup?'회원가입':'로그인',null);mainNav('',false);
    return `<div class="auth-view"><div class="auth-brand"><img src="assets/sai-logo.png" alt="SAI 로고"><span>SAI ROOM</span></div><div class="auth-heading"><p>세종대학교 인공지능 동아리</p><h2>${signup?'회원가입':'로그인'}</h2>${signup?'<span>가입 신청 후 관리자 승인을 기다려주세요.</span>':''}</div>${sessionExpired?'<p class="auth-notice" role="status">로그인이 만료되었습니다. 다시 로그인해주세요.</p>':''}${!signup&&signupDone?'<p class="auth-notice" role="status">가입 신청을 보냈습니다. 로그인하면 승인 상태를 확인할 수 있습니다.</p>':''}${bootError?`<div class="auth-notice" role="alert">${esc(bootError)}<button class="text-button" data-action="retry-boot">연결 다시 확인</button></div>`:''}<form id="${signup?'signup':'login'}-form" class="auth-form">${signup?authField('signup-displayName','이름','text','name','동아리에서 사용하는 이름')+authField('signup-studentId','학번','text','off','학번 입력','4'):''}${authField(`${signup?'signup':'login'}-email`,signup?'이메일':'이메일 또는 기존 아이디',signup?'email':'text','username',signup?'name@example.com':'이메일 또는 아이디')}${authField(`${signup?'signup':'login'}-password`,'비밀번호','password',signup?'new-password':'current-password',signup?'8자 이상 입력해주세요':'비밀번호',signup?'8':'')}${signup?authField('signup-confirm','비밀번호 확인','password','new-password','비밀번호를 한 번 더 입력해주세요')+operatorCodeField():''}<p class="form-error auth-error" id="${signup?'signup':'login'}-error" role="alert" aria-live="polite"></p><button type="submit" class="primary-button auth-submit" ${signup?'':'data-action="login"'}><span>${signup?'가입 신청':'로그인'}</span>${icon('next')}</button></form><div class="auth-switch"><span>${signup?'이미 계정이 있나요?':'처음 오셨나요?'}</span><button type="button" data-action="auth-route" data-route="${signup?'login':'signup'}">${signup?'로그인':'회원가입'}</button></div><div class="auth-footer"><span>SAI</span><span>Sejong Artificial Intelligence</span></div></div>`;
  }
  function membershipScreen(){
    appHeader('가입 승인',null);mainNav('',false);const rejected=user()?.membershipStatus==='rejected';
    return `<div class="membership-view"><img src="assets/sai-logo.png" alt="SAI" class="membership-logo"><span class="membership-mark">${icon(rejected?'lock':'person')}</span><p class="eyebrow">${esc(user()?.displayName)}</p><h2>${rejected?'가입이 승인되지 않았습니다':'가입 승인을 기다리고 있어요'}</h2><p>${rejected?'가입 정보 확인이 필요하면 동아리 관리자에게 문의해주세요.':'관리자가 신청을 확인하면 동방과 예약을 이용할 수 있습니다.'}</p><div class="membership-status"><span>${roleName()} 가입</span><strong>${rejected?'승인 거절':'승인 대기'}</strong></div><button class="primary-button" data-action="retry-boot">승인 상태 확인 ${icon('refresh')}</button><button class="text-button" data-action="logout">로그아웃</button></div>`;
  }
  async function submitSignup(form){
    if(busy)return;const displayName=form.elements.displayName.value.trim(),studentId=form.elements.studentId.value.trim(),email=form.elements.email.value.trim(),password=form.elements.password.value,operatorCode=form.elements.operatorCode.value.trim(),error=$('#signup-error');
    error.textContent='';if(!displayName||password.length<8||password.length>128){error.textContent='이름과 8자 이상의 비밀번호를 입력해주세요.';return;}
    if(password!==form.elements.confirm.value){error.textContent='비밀번호가 서로 다릅니다.';form.elements.confirm.focus();return;}
    const version=authRevision,button=form.querySelector('[type=submit]');
    const success=await mutate(()=>SaiBackend.signUp({displayName,studentId,email,password,operatorCode}),button,error);
    if(!success||version!==authRevision)return;form.reset();signupEmail=email;signupDone=true;sessionExpired=false;go('login');
  }
  function announceAuth(){document.dispatchEvent(new Event('sai:auth-change'));}
  function clearSession(expired=false){
    authenticated=false;booting=false;sessionExpired=expired;bootError='';authRevision++;SaiBeacon.stop({report:false}).catch(()=>{});SaiBeacon.reset();beaconLoadError='';beaconSaved=false;codeInfo=null;codeError='';codeLoading=false;codeSuccess=false;checkedIn=false;applications=null;applicationsError='';applicationsLoading=false;applicationRevision++;draftBall=null;ball={anonymous:false,color:'#233f6d',imageId:null,imageUrl:null};boardKind='public';boardFilter='전체';
    state.bookings=[];state.posts=[];SaiBackend.clear();SaiPresence.stop();SaiDeviceMotion.stop();SaiMotion.unmount();
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    const detail=$('#presence-details-body');if(detail)detail.replaceChildren();
    if(confirmResolver){confirmResolver(false);confirmResolver=null;}
    announceAuth();render();
  }
  async function submitLogin(form){
    if(busy)return;const email=form.elements.email.value.trim(),password=form.elements.password.value,error=$('#login-error'),button=form.querySelector('[type="submit"]'),version=++authRevision;
    busy=true;button.disabled=true;button.setAttribute('aria-busy','true');button.querySelector('span').textContent='로그인 중';error.textContent='';
    try{
      await SaiBackend.signIn(email,password);
      if(version!==authRevision)return;
      form.elements.password.value='';busy=false;sessionExpired=false;signupDone=false;
      await boot();
    }catch(e){if(version===authRevision&&error.isConnected){error.textContent=e.message;form.elements.password.value='';form.elements.password.focus();}}
    finally{busy=false;if(button.isConnected){button.disabled=false;button.removeAttribute('aria-busy');button.querySelector('span').textContent='로그인';}}
  }
  function home() {
    appHeader('SAI',null,`<button class="icon-button" data-action="go" data-route="settings" aria-label="설정">${icon('gear')}</button>`);
    header.querySelector('.header-spacer').outerHTML='<img class="header-mark" src="assets/sai-logo.png" alt="SAI 로고">';
    mainNav('home');
    const n=reading.snapshot?.count;
    const slot=nextFreeSlot(),next=[...state.bookings].filter(b=>new Date(`${b.date}T${time(b.end)}:00+09:00`).getTime()>Date.now()).sort((a,b)=>(a.date+time(a.start)).localeCompare(b.date+time(b.start)))[0];
    return `<div class="home-view"><div class="room-intro"><div><h2>동방 현황</h2></div><span class="connection-pill" id="presence-connection"><i></i>연결 중</span></div><section class="occupancy-section" aria-label="동아리방 현황">${gauge(state.settings.gauge,n)}<div class="presence-meta"><span id="presence-updated">현황 확인 중</span><button class="text-button refresh-button" data-action="refresh">${icon('refresh')}<span>새로고침</span></button></div><p id="presence-issue" class="connection-note" hidden></p><span id="occupancy-mood" class="sr-only"></span><span id="presence-live" class="sr-only" aria-live="polite" aria-atomic="true"></span></section><div class="check-in-row"><div><strong>${checkedIn?'동방에 있어요':'동방에 도착했나요?'}</strong><p>직접 입·퇴실 기록 · 입실 후 4시간 유지</p></div><button class="${checkedIn?'secondary':'primary'}-button" data-action="toggle-check-in">${checkedIn?'퇴실하기':'입실하기'}</button></div><p class="helper left beacon-note">현재 인원은 앱에서 감지·입실한 회원 수이며 전체 방문자가 아닙니다. <span id="beacon-last">${esc(beaconNoteText(reading&&reading.snapshot))}</span> <button class="text-button" data-action="go" data-route="beacon">자동 감지 설정</button></p>${staff()?`<button class="staff-entry" data-action="go" data-route="inbox"><span>${icon("chat")} 운영진 문의함</span><strong>${state.posts.filter(p=>p.kind==="inquiry"&&p.status!=="answered").length}건 대기 ${icon("next")}</strong></button>`:""}${admin()?`<button class="staff-entry" data-action="go" data-route="members"><span>${icon("person")} 회원 승인</span>${icon("next")}</button>`:""}<div class="bottle-tools"><button data-action="device-motion" aria-pressed="${SaiDeviceMotion.enabled}">${icon("refresh")}<span id="device-motion-state">${SaiDeviceMotion.enabled?"기기 움직임 켜짐":"기기 움직임 켜기"}</span></button><button data-action="go" data-route="ball">내 공 꾸미기 ${icon("next")}</button></div><p class="helper left" id="device-motion-message">${esc(SaiDeviceMotion.message)}</p><button class="free-window" data-action="reserve-free"><span class="free-window-icon">${icon('calendar')}</span><span><strong>예약하기</strong><small>${slot?`${slot.date===SaiData.day()?'오늘':fmtDate(slot.date,false)} ${time(slot.start)}–${time(slot.end)} 이용 가능`:'시간표에서 빈 시간을 선택하세요'}</small></span>${icon('next')}</button>${next?`<div class="next-heading">다음 예약</div><button class="next-reservation" data-action="go" data-route="reservation/${next.id}"><span class="booking-date-mark"><small>${dateObj(next.date).toLocaleDateString('ko-KR',{month:'short'})}</small><strong>${dateObj(next.date).getDate()}</strong></span><span class="next-copy"><strong>${esc(next.purpose)}</strong><span>${time(next.start)}–${time(next.end)} · ${next.people}명</span></span>${icon('next')}</button>`:`<div class="empty-upcoming">예정된 예약이 없습니다.</div>`}</div>`;
  }
  function reservations() {
    // 저장된 예약 위에 선택 표시가 겹치지 않도록 빈 구간으로 이동합니다.
    if (!selectedTimeEdited && (overlapping(selectedSlot) || isPastSlot(selectedSlot))) {
      const starts = Array.from({ length: 28 }, (_, i) => 540 + i * 30);
      starts.sort(
        (a, b) =>
          Math.abs(a - selectedSlot.start) - Math.abs(b - selectedSlot.start),
      );
      const free = starts
        .flatMap((start) => [60,30].map(duration => ({
          date: selectedSlot.date,
          start,
          end: Math.min(start + duration, 1380),
        })))
        .find((slot) => !overlapping(slot) && !isPastSlot(slot));
      selectedSlot = free || { ...selectedSlot, start: 1200, end: 1260 };
    }
    const selectionError = isPastSlot(selectedSlot) ? '앞으로 이용할 시간을 선택해주세요.' : overlapping(selectedSlot) ? '다른 예약과 겹칩니다. 시간을 조절해주세요.' : '';
    const selectable = !selectionError;
    appHeader("예약", null, remote ? `<button class="icon-button" data-action="refresh-data" aria-label="예약 목록 새로고침">${icon("refresh")}</button>` : "");
    mainNav("reservations");
    const weekStart=addDay(selectedDate,-((dateObj(selectedDate).getDay()+6)%7));
    const dates=Array.from({length:7},(_,i)=>addDay(weekStart,i));
    const weekdays=['월','화','수','목','금','토','일'];
    let grid = "";
    const start = 540,
      end = 1380,
      cell = 44;
    for (let t = start; t < end; t += 30) {
      const top = ((t - start) / 30) * cell;
      grid += `<span class="time-label" style="top:${top}px">${time(t)}</span>`;
      grid += `<button class="slot" style="top:${top}px;left:0;height:${cell}px" data-action="slot" data-date="${selectedDate}" data-start="${t}" aria-label="${fmtDate(selectedDate, false)} ${time(t)} 예약 시간 선택" ${isPastSlot({date:selectedDate,start:t})?'disabled':''}></button>`;
    }
    state.bookings
      .filter((b) => b.date===selectedDate)
      .forEach((b) => {
        grid += `<button class="booking-block ${b.owner === "me" ? "mine" : ""} ${b.end - b.start === 30 ? "short" : ""}" style="top:${((b.start - start) / 30) * cell + 2}px;left:3px;height:${((b.end - b.start) / 30) * cell - 4}px" data-action="go" data-route="reservation/${b.id}"><strong>${esc(b.purpose)}: ${esc(b.name)}</strong><span>${b.people}명</span><small>${time(b.start)}–${time(b.end)}</small></button>`;
      });
    if (selectedSlot.date===selectedDate && !overlapping(selectedSlot) && !isPastSlot(selectedSlot)) {
      grid += `<div class="selection-block" style="top:${((selectedSlot.start - start) / 30) * cell + 2}px;left:3px;height:${((selectedSlot.end - selectedSlot.start) / 30) * cell - 4}px"><strong>선택한 시간</strong><span>${time(selectedSlot.start)}–${time(selectedSlot.end)}</span></div>`;
    }
    setActions(`<div class="booking-actions"><div class="selection-summary ${selectable?'':'unavailable'}"><span>${fmtDate(selectedSlot.date, false)}</span><strong>${selectable?`${time(selectedSlot.start)}–${time(selectedSlot.end)}`:'시간을 다시 선택해주세요'}</strong></div><button class="primary-button booking-submit" data-action="go" data-route="reservation/new" ${selectable?'':'disabled'}>${selectable?'예약하기':'시간을 다시 선택해주세요'} </button></div>`);
    return `<div class="stack reservation-view screen-enter">
      <div class="date-switch"><button class="icon-button" data-action="date-prev" aria-label="이전 주">${icon("back")}</button><label class="date-label">${dateObj(selectedDate).toLocaleDateString('ko-KR',{year:'numeric',month:'long'})}<input type="date" id="calendar-date" value="${selectedDate}" aria-label="예약 날짜 선택"></label><button class="icon-button" data-action="date-next" aria-label="다음 주">${icon("next")}</button></div>
      <div class="day-headings week-strip" aria-label="예약 요일 선택">${dates.map((d,i)=>`<button class="day-heading ${selectedDate===d?'active':''} ${d===SaiData.day()?'is-today':''}" data-action="date-select" data-date="${d}" aria-label="${fmtDate(d)}${d===SaiData.day()?', 오늘':''}" aria-pressed="${selectedDate===d}" ${d===SaiData.day()?'aria-current="date"':''}><span class="weekday-label">${weekdays[i]}</span><span class="day-number">${dateObj(d).getDate()}</span><span class="day-mark ${state.bookings.some(b=>b.date===d)?'has-bookings':''}" aria-hidden="true"></span></button>`).join('')}</div>
      <section class="booking-time-picker" aria-label="예약 시간 조절"><div class="booking-time-fields"><label for="selection-start">시작<select id="selection-start">${timeOptions(selectedSlot.start,false)}</select></label><span aria-hidden="true">–</span><label for="selection-end">종료<select id="selection-end">${timeOptions(selectedSlot.end,true,selectedSlot.start+30)}</select></label></div><p id="selection-duration" aria-live="polite">${durationText(selectedSlot.end-selectedSlot.start)}</p>${selectionError?`<p class="time-selection-error" role="status">${selectionError}</p>`:''}</section>
      <div class="timetable day-timetable" aria-label="${fmtDate(selectedDate)} 예약 시간표"><div class="time-grid" style="height:${((end-start)/30)*cell}px">${grid}<span class="time-label" style="top:${((end-start)/30)*cell-10}px">23:00</span></div></div><div class="legend"><span><i class="legend-dot mine"></i>내 예약</span><span><i class="legend-dot"></i>다른 예약</span><span>30분 단위</span></div></div>`;
  }
  const durationText = minutes => `${Math.floor(minutes/60)?Math.floor(minutes/60)+'시간':''}${minutes%60?(minutes>=60?' ':'')+minutes%60+'분':''}`;
  const timeOptions = (value, includeLast = true, minimum = 540) =>
    Array.from({ length: includeLast ? 29 : 28 }, (_, i) => 540 + i * 30)
      .map(
        (t) =>
          `<option value="${t}" ${t === value ? "selected" : ""} ${t<minimum?"disabled":""}>${time(t)}</option>`,
      )
      .join("");
  function bookingForm(id) {
    const edit =
      id && state.bookings.find((b) => b.id === id && b.owner === "me");
    if (id && !edit) return notFound();
    const b = edit || {
      ...selectedSlot,
      purpose: "스터디",
      name: SaiBackend.user?.displayName || "",
      people: 4,
    };
    appHeader(
      edit ? "예약 수정" : "예약 작성",
      edit ? `reservation/${id}` : "reservations",
    );
    mainNav("", false);
    return `<form id="booking-form" data-id="${edit ? esc(edit.id) : ""}" class="stack screen-enter"><span class="chip">예약 정보</span><div class="form-field"><label for="booking-date">이용 날짜</label><input type="date" id="booking-date" name="date" value="${b.date}" required></div><div class="form-grid"><div class="form-field"><label for="booking-start">시작 시간</label><select id="booking-start" name="start">${timeOptions(b.start, false)}</select></div><div class="form-field"><label for="booking-end">종료 시간</label><select id="booking-end" name="end">${timeOptions(b.end,true,b.start+30)}</select></div></div><div class="form-field"><label for="booking-purpose">이용 목적</label><input id="booking-purpose" name="purpose" maxlength="20" value="${esc(b.purpose)}" placeholder="예: 스터디" required></div><div class="form-field"><label for="booking-name">대표자 이름</label><input id="booking-name" name="name" maxlength="20" value="${esc(b.name)}" placeholder="대표자 이름" required></div><div class="form-field"><label for="booking-people">사용 인원</label><input id="booking-people" name="people" type="number" min="1" max="15" value="${b.people}" required><p class="field-hint">대표자를 포함한 전체 인원 (1–15명)</p></div><div class="summary-card"><p>예약 미리보기</p><strong id="booking-preview">${esc(b.purpose)}: ${esc(b.name)} · ${b.people}명</strong><span id="booking-time-preview">${time(b.start)}–${time(b.end)}</span></div><p class="form-error" id="booking-error" role="alert"></p><p class="helper">다른 예약과 겹치는 시간은 예약할 수 없습니다.</p><button class="primary-button" type="submit">${edit ? "수정 내용 저장" : "예약 저장"} ${icon("check")}</button></form>`;
  }
  function bookingDetail(id) {
    const b = state.bookings.find((b) => b.id === id);
    if (!b) return notFound();
    appHeader("예약 상세", "reservations");
    mainNav("", false);
    return `<div class="stack screen-enter"><span class="chip">${b.owner === "me" ? "내 예약" : "동아리방 예약"}</span><h2 class="detail-title">${esc(b.purpose)}: ${esc(b.name)}</h2><div class="surface detail-body"><div class="settings-row"><span>이용 날짜</span><strong>${fmtDate(b.date, false)}</strong></div><div class="settings-row"><span>이용 시간</span><strong>${time(b.start)}–${time(b.end)}</strong></div><div class="settings-row"><span>예약 주체</span><strong>${esc(b.name)}</strong></div><div class="settings-row"><span>사용 인원</span><strong>${b.people}명</strong></div></div>${b.owner === "me" ? `<button class="primary-button" data-action="go" data-route="reservation/edit/${b.id}">시간·예약 정보 변경 ${icon("edit")}</button><button class="danger-button" data-action="cancel-booking" data-id="${b.id}">예약 취소</button>` : '<p class="helper">본인 예약만 수정·취소할 수 있어요.</p>'}<button class="secondary-button" data-action="go" data-route="reservations">타임테이블로 돌아가기</button></div>`;
  }
  function board(inbox=false) {
    if(inbox)boardKind="inquiry";
    appHeader(inbox?(staff()?"운영진 문의함":"내 문의"):"게시판", null, remote ? `<button class="icon-button" data-action="refresh-data" aria-label="게시판 새로고침">${icon("refresh")}</button>` : "");
    mainNav(inbox?"messages":"board");
    let posts = state.posts
      .filter(
        (p) =>
          p.kind === boardKind &&
          (boardKind === "public" || p.owner === "me" || staff()) &&
          (boardFilter === "전체" || p.category === boardFilter),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const cats =
      boardKind === "public"
        ? ["전체", "스터디", "공용물품", "자유"]
        : ["전체", "건의", "문의"];
    if(boardKind==='inquiry')return inquiryList(posts,inbox);
    return `<div class="stack screen-enter"><div class="segmented" aria-label="게시판 선택"><button data-action="board-kind" data-value="public" class="active" aria-pressed="true">자유게시판</button><button data-action="board-kind" data-value="inquiry" aria-pressed="false">${staff()?'운영진 문의함':'내 문의'}</button></div><p class="muted">회원에게 이름이 공개되지 않습니다.</p><div class="board-tools">${cats.map(c=>`<button class="chip ${boardFilter===c?'active':''}" data-action="board-filter" data-value="${c}" aria-pressed="${boardFilter===c}">${c}</button>`).join('')}</div><div class="post-list">${posts.length?posts.map(p=>`<button class="post-card" data-action="go" data-route="post/${p.id}"><span class="post-card-top"><span class="category-label">${esc(p.category)}</span>${p.owner==='me'?'<span class="own-label">내 글</span>':''}</span><strong class="post-title">${esc(p.title)}</strong><span class="post-excerpt">${esc(p.body.split('\n')[0])}</span><span class="post-meta">익명 · ${relative(p.createdAt)} · 댓글 ${p.comments.length}</span></button>`).join(''):'<div class="empty-state">아직 글이 없습니다.</div>'}</div><button class="primary-button floating-compose" data-action="compose" data-kind="public">${icon('edit')} 글쓰기</button></div>`;
  }
  function inquiryList(posts,inbox){
    const all=state.posts.filter(p=>p.kind==='inquiry'&&(p.owner==='me'||staff())),pending=all.filter(p=>p.status!=='answered').length;
    posts=all.filter(p=>boardFilter==='대기 중'?p.status!=='answered':boardFilter==='답변 완료'?p.status==='answered':true).sort((a,b)=>b.createdAt-a.createdAt);
    return `<div class="inquiry-view screen-enter">${inbox?'':`<div class="segmented"><button data-action="board-kind" data-value="public">자유게시판</button><button class="active" data-action="board-kind" data-value="inquiry">${staff()?'운영진 문의함':'내 문의'}</button></div>`}<div class="inquiry-heading"><span class="eyebrow">${staff()?'운영진 전용':'운영진에게만 전달됩니다'}</span><h2>${staff()?`답변을 기다리는 문의 <em>${pending}</em>`:'궁금한 점을 남겨주세요'}</h2><p>${staff()?'운영진이 함께 확인하고 답변합니다.':'내가 보낸 문의와 답변을 한곳에서 확인하세요.'}</p></div><div class="inquiry-filters">${['전체','대기 중','답변 완료'].map(c=>`<button data-action="board-filter" data-value="${c}" aria-pressed="${boardFilter===c}" class="${boardFilter===c?'active':''}">${c}</button>`).join('')}</div><div class="post-list inquiry-list">${posts.length?posts.map(p=>`<button class="inquiry-item" data-action="go" data-route="post/${p.id}"><span class="inquiry-item-top"><span class="inquiry-state ${p.status==='answered'?'answered':''}">${p.status==='answered'?'답변 완료':'대기 중'}</span><span>${relative(p.createdAt)}</span></span><strong>${esc(p.title)}</strong><span class="inquiry-item-bottom">${staff()?esc(p.authorName||'회원'):'운영진에게 보낸 문의'} · ${esc(p.category)}${icon('next')}</span></button>`).join(''):`<div class="inquiry-empty">${icon('chat')}<h3>${all.length?'해당하는 문의가 없습니다':'아직 문의가 없습니다'}</h3><p>${staff()?'새 문의가 도착하면 여기에 표시됩니다.':'문의나 건의를 남기면 운영진이 답변합니다.'}</p></div>`}</div>${!staff()?`<button class="primary-button floating-compose" data-action="compose" data-kind="inquiry">문의 보내기 ${icon('plus')}</button>`:''}<p class="privacy-footnote">${icon('lock')} 작성자와 운영진만 내용을 확인할 수 있습니다.</p></div>`;
  }
  function inquiryDetail(p){
    appHeader('문의',inboxRoute());mainNav('messages');
    return `<article class="inquiry-thread screen-enter"><div class="inquiry-item-top"><span class="inquiry-state ${p.status==='answered'?'answered':''}">${p.status==='answered'?'답변 완료':'대기 중'}</span><span>${esc(p.category)}</span></div><h2>${esc(p.title)}</h2><p class="thread-meta">${esc(p.authorName||'회원')} · ${relative(p.createdAt)}</p><div class="thread-original">${esc(p.body)}</div><div class="thread-divider">${icon('lock')} 작성자와 운영진의 대화</div><div class="comment-list thread-messages">${p.comments.map(c=>`<div class="thread-message ${c.owner==='admin'||c.isStaff?'staff-message':'member-message'}"><div class="post-meta"><strong>${c.owner==='admin'||c.isStaff?'SAI 운영진':p.owner==='me'?'나':esc(p.authorName||'회원')}</strong><span>${relative(c.createdAt)}</span></div><p>${esc(c.body)}</p></div>`).join('')}${!p.comments.length?'<p class="thread-wait">운영진의 답변을 기다리고 있습니다.</p>':''}</div><form class="comment-form thread-form" id="comment-form" data-id="${p.id}" data-reply="${staff()}"><label for="comment-body">${staff()?'운영진 답변':'메시지 추가'}</label><textarea id="comment-body" name="body" rows="3" maxlength="500" placeholder="${staff()?'회원에게 답변을 남겨주세요':'추가로 전할 내용을 입력해주세요'}" required></textarea><p class="form-error" id="comment-error" role="alert"></p><button class="primary-button" type="submit">${staff()?'답변 보내기':'메시지 보내기'} ${icon('next')}</button></form></article>`;
  }

  function postForm(id) {
    const edit = id && state.posts.find((p) => p.id === id && p.owner === "me");
    if (id && !edit) return notFound();
    const p = edit || {
      kind: boardKind,
      category: boardKind === "public" ? "자유" : "건의",
      title: "",
      body: "",
    };
    appHeader(
      edit ? "글 수정" : p.kind === "public" ? "글쓰기" : "운영진 문의",
      edit ? `post/${id}` : "board",
    );
    mainNav("", false);
    const cats =
      p.kind === "public" ? ["자유", "스터디", "공용물품"] : ["건의", "문의"];
    return `<form id="post-form" data-id="${edit ? esc(id) : ""}" data-kind="${p.kind}" class="stack screen-enter"><span class="chip">${p.kind === "public" ? "일반 익명글" : "운영진 문의"}</span><div class="form-field"><label for="post-category">${p.kind === "public" ? "분류" : "문의 유형"}</label><select id="post-category" name="category">${cats.map((c) => `<option ${c === p.category ? "selected" : ""}>${c}</option>`).join("")}</select></div><div class="form-field"><label for="post-title">제목</label><input id="post-title" name="title" value="${esc(p.title)}" maxlength="60" placeholder="제목을 입력해주세요" required></div><div class="form-field"><label for="post-body">내용</label><textarea id="post-body" name="body" maxlength="2000" rows="9" placeholder="내용을 입력해주세요" required>${esc(p.body)}</textarea><span class="field-hint" id="character-count">${p.body.length} / 2,000</span></div><div class="notice">${icon(p.kind === "inquiry" ? "lock" : "chat")}<span>${p.kind === "inquiry" ? "이름과 문의 내용이 운영진에게 전달됩니다." : "동아리 회원에게 익명으로 공개됩니다."}</span></div><p class="form-error" id="post-error" role="alert"></p><button class="primary-button" type="submit">${edit ? "수정 내용 저장" : p.kind === "public" ? "글 등록" : "문의 보내기"}</button></form>`;
  }
  function postDetail(id) {
    const p = state.posts.find((p) => p.id === id);
    if (!p || (p.kind === "inquiry" && p.owner !== "me" && !staff())) return notFound();
    if(p.kind==="inquiry")return inquiryDetail(p);
    appHeader("글 상세", "board");
    mainNav("", false);
    return `<article class="stack screen-enter"><div class="post-card-top"><span class="category-label">${esc(p.category)}</span>${p.kind === "inquiry" ? `<span class="status-pill ${p.status === "answered" ? "quiet" : "normal"}">${p.status === "answered" ? "답변 완료" : "접수"}</span>` : ""}</div><h2 class="detail-title">${esc(p.title)}</h2><p class="detail-meta">익명 · ${relative(p.createdAt)}${p.owner === "me" ? " · 내 글" : ""}</p><div class="detail-body post-body">${esc(p.body)}</div>${p.owner === "me" ? `<div class="button-row"><button class="text-button" data-action="go" data-route="post/edit/${p.id}">수정</button><button class="text-button danger-text" data-action="delete-post" data-id="${p.id}">삭제</button></div>` : ""}<hr><h3 class="section-title">${p.kind === "inquiry" ? "운영진 답변" : "댓글"} <span>${p.comments.length}</span></h3><div class="comment-list">${p.comments.length ? p.comments.map((c) => `<div class="comment"><div class="post-meta"><strong>${c.owner === "admin" ? "SAI 운영진" : c.owner === "me" ? "익명 (나)" : "익명"}</strong><span>${relative(c.createdAt)}</span></div><p>${esc(c.body)}</p></div>`).join("") : `<p class="muted">${p.kind === "inquiry" ? "아직 답변이 없습니다. 답변이 등록되면 여기서 확인할 수 있습니다." : "첫 댓글을 남겨보세요."}</p>`}</div>${p.kind === "public" || staff() ? `<form class="comment-form" id="comment-form" data-id="${p.id}" data-reply="${p.kind === "inquiry"}"><label class="sr-only" for="comment-body">${p.kind === "inquiry" ? "운영진 답변" : "익명 댓글"}</label><textarea id="comment-body" name="body" rows="2" maxlength="500" placeholder="${p.kind === "inquiry" ? "운영진 답변을 입력해주세요" : "댓글을 입력해주세요"}" required></textarea><button class="primary-button" type="submit">등록</button><p class="form-error" id="comment-error" role="alert"></p></form>` : `<p class="helper">답변은 이 화면에서 확인할 수 있습니다.</p>`}</article>`;
  }
  function custom() {
    if(!draftCustom)draftCustom={theme:state.settings.theme,gauge:state.settings.gauge};
    appHeader('화면 설정',null);mainNav('custom');
    setActions('<div class="custom-actions"><button class="secondary-button" data-action="go" data-route="home">취소</button><button class="primary-button" data-action="apply-custom">저장</button></div>');
    const materials=[['water','유리'],['basic','무광'],['lava','세라믹']],themes=[['light','라이트'],['dark','다크'],['blue','블루']];
    return `<div class="custom-view screen-enter"><div class="preview-card" data-theme="${draftCustom.theme}"><span class="preview-label">미리보기</span><div class="preview-orb">${SaiMotion.gauge(draftCustom.gauge,state.settings.occupancy,true,true)}</div></div><section><h2 class="section-title">통 스타일</h2><div class="option-grid">${materials.map(([k,l])=>`<button class="design-option ${draftCustom.gauge===k?'active':''}" data-action="gauge-choice" data-value="${k}" aria-pressed="${draftCustom.gauge===k}"><span class="material-sample ${k}"></span><span>${l}</span>${draftCustom.gauge===k?`<span class="option-check">${icon('check')}</span>`:''}</button>`).join('')}</div></section><section><h2 class="section-title">테마</h2><div class="option-grid">${themes.map(([k,l])=>`<button class="design-option theme-option ${draftCustom.theme===k?'active':''}" data-action="theme-choice" data-value="${k}" aria-pressed="${draftCustom.theme===k}"><span class="theme-swatch ${k}"><i></i></span><span>${l}</span>${draftCustom.theme===k?`<span class="option-check">${icon('check')}</span>`:''}</button>`).join('')}</div></section></div>`;
  }
  function forbidden(){
    appHeader('접근 권한', 'home');mainNav('');
    return `<div class="inquiry-empty">${icon('lock')}<h2>이 메뉴를 이용할 수 없습니다</h2><p>계정에 허용된 메뉴에서 확인해주세요.</p><button class="primary-button" data-action="go" data-route="${inboxRoute()}">내 메뉴로 돌아가기</button></div>`;
  }
  function membershipAdmin(){
    appHeader('회원 승인','settings',`<button class="icon-button" data-action="refresh-applications" aria-label="가입 신청 새로고침">${icon('refresh')}</button>`);mainNav('');
    const items=(applications||[]).filter(x=>x.membershipStatus===applicationFilter),pending=(applications||[]).filter(x=>x.membershipStatus==='pending').length;
    return `<div class="membership-admin screen-enter"><div class="inquiry-heading"><span class="eyebrow">관리자 전용</span><h2>가입 신청</h2><p>승인을 기다리는 가입 신청 <strong>${pending}건</strong></p></div><div class="inquiry-filters">${[['pending','대기'],['approved','승인'],['rejected','거절']].map(([k,l])=>`<button data-action="application-filter" data-value="${k}" class="${applicationFilter===k?'active':''}" aria-pressed="${applicationFilter===k}">${l}</button>`).join('')}</div>${applicationsError?`<div class="auth-notice" role="alert">${esc(applicationsError)}<button class="text-button" data-action="refresh-applications">다시 불러오기</button></div>`:applicationsLoading||applications===null?'<p class="muted" role="status">가입 신청을 불러오는 중입니다.</p>':items.length?`<div class="application-list">${items.map(x=>`<article class="application-item"><div class="application-person"><span class="application-avatar">${esc(x.displayName.slice(0,1))}</span><div><h3>${esc(x.displayName)}<span class="application-role ${x.role==='operator'?'is-operator':''}">${x.role==='operator'?'운영진':'멤버'}</span></h3><p>${esc(x.email)}</p></div></div><span class="application-date">${relative(x.createdAt)} 신청</span>${x.membershipStatus==='pending'?`<div class="button-row"><button class="secondary-button" data-action="decide-member" data-id="${esc(x.id)}" data-value="rejected">거절</button><button class="primary-button" data-action="decide-member" data-id="${esc(x.id)}" data-value="approved">가입 승인 ${icon('check')}</button></div>`:`<span class="inquiry-state ${x.membershipStatus==='approved'?'answered':''}">${x.membershipStatus==='approved'?'승인 완료':'승인 거절'}</span>`}</article>`).join('')}</div>`:`<div class="inquiry-empty">${icon('person')}<h3>${applicationFilter==='pending'?'대기 중인 신청이 없습니다':'처리한 신청이 없습니다'}</h3><p>가입 신청이 도착하면 이곳에서 확인할 수 있습니다.</p></div>`}</div>`;
  }
  async function loadApplications(){
    if(!admin()||applicationsLoading)return;applicationsLoading=true;applicationsError='';const version=++applicationRevision,session=authRevision;render();
    try{const result=await SaiBackend.applications();if(version!==applicationRevision||session!==authRevision||!admin())return;applications=result;}
    catch(e){if(version===applicationRevision&&session===authRevision){applications=[];applicationsError=e.message;}}
    finally{if(version===applicationRevision&&session===authRevision){applicationsLoading=false;if(location.hash==='#members')render();}}
  }
  function ballSettings(){
    if(!draftBall)draftBall={...ball};appHeader('내 공 꾸미기','settings');mainNav('');
    setActions('<div class="custom-actions"><button class="secondary-button" data-action="go" data-route="home">취소</button><button class="primary-button" data-action="save-ball">저장</button></div>');
    const colors=['#233f6d','#a6113c','#c5d5eb','#e4b9c8','#9bab96','#e3cda0'];
    return `<div class="ball-settings screen-enter"><div class="personal-ball-stage"><div class="personal-ball" style="--personal-color:${esc(draftBall.color)}">${draftBall.imageUrl?`<img src="${esc(draftBall.imageUrl)}" alt="내 공 이미지">`:''}<span>${draftBall.anonymous?'익명 회원':esc(user().displayName)}<small>나</small></span></div><span class="preview-label">미리보기</span></div><section class="ball-option"><label class="settings-row" for="ball-anonymous"><span><strong>이름 비공개</strong><small>공과 회원 목록에 ‘익명 회원’으로 표시합니다.</small></span><input type="checkbox" class="switch" id="ball-anonymous" ${draftBall.anonymous?'checked':''} role="switch"></label></section><section class="ball-option"><h2>공 색상</h2><div class="ball-colors">${colors.map(c=>`<button type="button" data-action="ball-color" data-value="${c}" style="--swatch:${c}" aria-label="공 색상 ${c}" aria-pressed="${draftBall.color===c}">${draftBall.color===c?icon('check'):''}</button>`).join('')}<label class="custom-color" title="직접 고르기"><input type="color" id="ball-color-input" value="${esc(draftBall.color)}" aria-label="공 색상 직접 고르기">${icon('plus')}</label></div></section><section class="ball-option"><h2>이미지</h2><label class="ball-upload" for="ball-image">${icon('plus')} ${draftBall.imageUrl?'이미지 바꾸기':'이미지 선택'}<input id="ball-image" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only"></label><p class="field-hint">JPG, PNG, WebP · 최대 5MB · 가운데를 정사각형으로 자릅니다.</p>${draftBall.imageUrl?'<button class="text-button" data-action="remove-ball-image">이미지 지우기</button>':''}<p class="form-error" id="ball-error" role="alert"></p></section></div>`;
  }
  async function readBallImage(file){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('5MB 이하의 JPG, PNG, WebP 이미지를 선택해주세요.');
    const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d'),side=Math.min(bitmap.width,bitmap.height);c.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);return canvas.toDataURL('image/png');}finally{bitmap.close();}
  }
  function settings() {
    appHeader('설정','home');mainNav('',false);
    return `<div class="stack screen-enter"><div class="profile-card"><span class="profile-avatar">${icon('person')}</span><div><h2>${esc(user()?.displayName||'회원')}</h2><p class="muted">${roleName()}</p></div></div><section class="settings-group"><h2 class="section-title">내 계정</h2><button class="settings-row full-row" data-action="go" data-route="ball"><span>내 공 꾸미기</span>${icon('next')}</button><button class="settings-row full-row" data-action="go" data-route="beacon"><span>동방 자동 감지</span><strong>${SaiBeacon.running?'켜짐':'꺼짐'}</strong></button><button class="settings-row full-row" data-action="go" data-route="${inboxRoute()}"><span>${staff()?'운영진 문의함':'내 문의'}</span>${icon('next')}</button></section>${staff()?`<section class="settings-group"><h2 class="section-title">동아리 운영</h2><button class="settings-row full-row" data-action="go" data-route="operator-code"><span>운영진 가입 코드</span>${icon('next')}</button><button class="settings-row full-row" data-action="go" data-route="beacon-settings"><span>동방 비콘 등록·설정</span>${icon('next')}</button>${admin()?`<button class="settings-row full-row" data-action="go" data-route="members"><span>회원 승인 관리</span>${icon('next')}</button>`:''}</section>`:''}<section class="settings-group"><h2 class="section-title">화면 설정</h2><button class="settings-row full-row" data-action="device-motion" aria-pressed="${SaiDeviceMotion.enabled}"><span>기기 움직임에 반응</span><strong id="device-motion-state">${SaiDeviceMotion.enabled?'켜짐':'켜기'}</strong></button><p class="helper left" id="device-motion-message">${esc(SaiDeviceMotion.message)}</p><button class="settings-row full-row" data-action="go" data-route="custom"><span>화면 꾸미기</span>${icon('next')}</button></section><button class="secondary-button" data-action="logout">로그아웃</button><p class="helper">SAI ROOM</p></div>`;
  }

  /* ---- Room beacon (automatic presence) ---- */
  let beaconLoading=false,beaconLoadError='',beaconSaved=false;
  const beaconLabel={off:'꺼짐',starting:'준비 중',scanning:'신호 찾는 중',inside:'동방에서 감지됨',weak:'신호 약함','unsupported':'사용 불가','not-configured':'미등록','bluetooth-off':'블루투스 꺼짐','permission-denied':'권한 필요','server-error':'전송 실패'};
  function beaconNoteText(snapshot){
    if(!snapshot||!snapshot.beacon)return '';
    if(!snapshot.beacon.enabled||!snapshot.beacon.configured)return '자동 감지 꺼짐 · 직접 입실한 회원만 집계';
    return snapshot.lastDetectionAt?`마지막 감지 ${new Date(snapshot.lastDetectionAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}`:'아직 감지된 회원 없음';
  }
  async function loadBeacon(){
    if(beaconLoading)return;beaconLoading=true;beaconLoadError='';const revision=authRevision;
    try{await SaiBeacon.load();}catch(e){if(revision===authRevision)beaconLoadError=e.message;}
    finally{if(revision===authRevision){beaconLoading=false;if(['#beacon','#beacon-settings'].includes(location.hash))render();}}
  }
  function beaconScreen(){
    appHeader('동방 자동 감지','settings');mainNav('',false);
    const st=SaiBeacon.status,cfg=st.config,on=SaiBeacon.running,sim=SaiBeacon.simulator;
    const simBlock=cfg&&cfg.simulatorAllowed?`<section class="settings-group beacon-dev"><h2 class="section-title">개발 모드 전용 · 감지 시뮬레이터</h2><p class="helper left">실제 비콘 없이 내 계정의 감지 흐름만 확인합니다. 운영 서버에서는 나타나지 않으며 서버도 거절합니다.</p><button class="settings-row full-row" data-action="beacon-sim-toggle" aria-pressed="${!!st.useSimulator}"><span>시뮬레이터 사용</span><strong>${st.useSimulator?'선택됨':'선택'}</strong></button>${sim?`<div class="beacon-sim-modes" role="group" aria-label="시뮬레이션 신호">${[['strong','강함 -60'],['edge','경계 -80'],['weak','약함 -95'],['lost','끊김']].map(([m,l])=>`<button class="${sim.mode===m?'primary':'secondary'}-button" data-action="beacon-sim-mode" data-value="${m}" aria-pressed="${sim.mode===m}">${l}</button>`).join('')}</div>`:'<p class="helper left">시뮬레이터를 선택한 뒤 자동 감지를 켜면 신호 버튼이 나타납니다.</p>'}</section>`:'';
    return `<div class="beacon-view stack screen-enter"><div class="inquiry-heading"><h2>동방 자동 감지</h2><p>휴대폰이 동방 비콘 신호를 감지하면 서버가 현재 인원에 반영합니다. 홈의 숫자는 <strong>앱으로 감지·입실한 회원 수</strong>이며 실제 전체 방문자 수가 아닙니다.</p></div>${beaconLoadError?`<div class="auth-notice" role="alert">${esc(beaconLoadError)}<button class="text-button" data-action="refresh-beacon">다시 불러오기</button></div>`:''}<div class="beacon-status" data-code="${esc(st.code)}" role="status" aria-live="polite"><strong>${esc(beaconLabel[st.code]||'')}</strong><p>${esc(st.text||'')}</p>${st.lastReportAt?`<p class="helper left">마지막 전송 ${new Date(st.lastReportAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>`:''}</div><button class="${on?'secondary':'primary'}-button" data-action="beacon-toggle" ${beaconLoading?'disabled':''}>${on?'자동 감지 끄기':'자동 감지 켜기'}</button><p class="helper left">앱 화면이 켜져 있고 열려 있을 때 가장 안정적으로 동작합니다. 앱을 닫거나 화면이 잠기면 감지가 멈출 수 있고, 일정 시간 신호가 오지 않으면 자동으로 인원에서 빠집니다. 위치·블루투스 권한은 비콘 신호를 읽기 위한 것이며 위치를 저장하지 않습니다.</p>${simBlock}</div>`;
  }
  function beaconSettingsScreen(){
    appHeader('비콘 설정','settings');mainNav('',false);
    const c=SaiBeacon.status.config;
    if(beaconLoadError)return `<div class="beacon-view stack screen-enter"><div class="auth-notice" role="alert">${esc(beaconLoadError)}<button class="text-button" data-action="refresh-beacon">다시 불러오기</button></div></div>`;
    if(!c)return '<div class="beacon-view stack screen-enter"><p class="muted" role="status">설정을 불러오는 중입니다.</p></div>';
    const field=(id,label,value,attrs,hint)=>`<div class="auth-field"><label for="beacon-${id}">${label}</label><input id="beacon-${id}" name="${id}" value="${esc(value??'')}" ${attrs}>${hint?`<p class="helper left">${hint}</p>`:''}</div>`;
    const num='type="number" inputmode="numeric" step="1" required';
    return `<div class="beacon-view stack screen-enter"><div class="inquiry-heading"><h2>동방 비콘 등록</h2><p>비폰 매니저 앱에서 HE5를 검색해 확인한 <strong>UUID · Major · Minor</strong>를 입력하세요. 이 값은 동방 비콘을 구분하는 번호일 뿐 비밀번호나 출입 인증이 아닙니다.</p></div>${beaconSaved?'<p class="code-success" role="status">저장했습니다.</p>':''}${c.usingTestDefaults?'<div class="auth-notice" role="note">신호 기준과 시간은 <strong>테스트용 초깃값</strong>입니다. 실제 동방에서 확인한 뒤 조정해주세요.</div>':''}<form id="beacon-config-form" class="auth-form"><label class="beacon-check"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}><span>자동 감지 사용</span></label>${field('uuid','UUID',c.uuid,'type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="36" placeholder="11111111-2222-3333-4444-555555555555"')}${field('major','Major (비우면 모두 허용)',c.major,'type="number" inputmode="numeric" min="0" max="65535" step="1"')}${field('minor','Minor (비우면 모두 허용)',c.minor,'type="number" inputmode="numeric" min="0" max="65535" step="1"')}${field('enterRssi','입실 신호 기준 (dBm)',c.enterRssi,num+' min="-120" max="-30"','이 값보다 강해야 동방으로 인식합니다. 예: -75')}${field('exitRssi','유지 신호 기준 (dBm)',c.exitRssi,num+' min="-120" max="-30"','이미 입실한 뒤에는 이 값까지 허용합니다. 입실 기준보다 약해야 합니다.')}${field('reportIntervalSeconds','갱신 간격 (초)',c.reportIntervalSeconds,num+' min="10" max="300"')}${field('exitGraceSeconds','퇴실 유예시간 (초)',c.exitGraceSeconds,num+' min="30" max="900"','이 시간 동안 갱신이 없으면 인원에서 제외합니다. 갱신 간격의 2배 이상이어야 합니다.')}${field('referenceCapacity','기준 인원 (게이지 가득 참)',c.referenceCapacity,num+' min="1" max="100"','기준을 넘어도 숫자는 정확히 표시하고 게이지만 가득 찬 상태로 유지합니다.')}<p class="form-error auth-error" id="beacon-config-error" role="alert" aria-live="polite"></p><button class="primary-button auth-submit" type="submit"><span>저장</span>${icon('check')}</button></form></div>`;
  }
  async function submitBeaconConfig(form){
    const c=SaiBeacon.status.config;if(!staff()||!c||busy)return;const error=$('#beacon-config-error');error.textContent='';beaconSaved=false;
    const n=name=>{const v=form.elements[name].value.trim();return v===''?null:Number(v);};
    const body={version:c.version,enabled:form.elements.enabled.checked,uuid:form.elements.uuid.value.trim()||null,major:n('major'),minor:n('minor'),enterRssi:n('enterRssi'),exitRssi:n('exitRssi'),reportIntervalSeconds:n('reportIntervalSeconds'),exitGraceSeconds:n('exitGraceSeconds'),referenceCapacity:n('referenceCapacity')};
    for(const k of ['major','minor'])if(body[k]!==null&&!Number.isInteger(body[k])){error.textContent='Major·Minor는 0–65535 정수로 입력해주세요.';return;}
    for(const k of ['enterRssi','exitRssi','reportIntervalSeconds','exitGraceSeconds','referenceCapacity'])if(!Number.isInteger(body[k])){error.textContent='숫자 항목을 확인해주세요.';return;}
    const revision=authRevision;
    const ok=await mutate(async()=>{await SaiBackend.saveBeaconConfig(body);await SaiBeacon.load();},form.querySelector('[type="submit"]'),error);
    if(ok&&revision===authRevision){beaconSaved=true;SaiPresence.refresh({afterWrite:true});render();}
  }
  function operatorCodeSettings(){
    appHeader('운영진 가입 코드','settings');mainNav('',false);
    const date=codeInfo?new Date(codeInfo.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    return `<div class="code-settings stack screen-enter"><div class="inquiry-heading"><h2>가입 코드 변경</h2><p>새 코드를 저장하면 이전 코드는 사용할 수 없습니다.<br>이미 가입한 계정에는 영향을 주지 않습니다.</p></div>${codeSuccess?'<p class="code-success" role="status">새 코드로 변경했습니다. 가입할 운영진에게 전달해주세요.</p>':''}${codeError?`<div class="auth-notice" role="alert">${esc(codeError)}<button class="text-button" data-action="refresh-code">다시 불러오기</button></div>`:codeInfo?`<div class="code-meta"><span>${codeInfo.updatedBy?'마지막 변경':'최초 설정'}</span><strong>${date}${codeInfo.updatedBy?' · '+esc(codeInfo.updatedBy):''}</strong><button type="button" class="text-button" data-action="refresh-code">새로고침</button></div><form id="operator-code-form" class="auth-form">${authField('code-newCode','새 운영진 코드','password','off','12자 이상 입력해주세요','12')}${authField('code-confirmCode','새 코드 확인','password','off','새 코드를 한 번 더 입력해주세요','12')}${authField('code-currentPassword','내 비밀번호','password','current-password','변경하는 계정의 비밀번호','8')}<p class="form-error auth-error" id="operator-code-error" role="alert" aria-live="polite"></p><button class="primary-button auth-submit" type="submit"><span>코드 변경</span>${icon('check')}</button><p class="helper left">변경한 코드는 다시 표시되지 않습니다. 저장하기 전에 안전한 곳에 보관해주세요.</p></form>`:'<p class="muted" role="status">코드 정보를 불러오는 중입니다.</p>'}</div>`;
  }
  async function loadCodeInfo(){
    if(!staff()||codeLoading)return;codeLoading=true;codeError='';const revision=authRevision;
    try{const result=await SaiBackend.operatorCode();if(revision===authRevision&&staff())codeInfo=result;}
    catch(e){if(revision===authRevision){codeInfo=null;codeError=e.message;}}
    finally{if(revision===authRevision){codeLoading=false;if(location.hash==='#operator-code')render();}}
  }
  async function submitCode(form){
    if(!staff()||!codeInfo||busy)return;
    const newCode=form.elements.newCode.value.trim(),confirmCode=form.elements.confirmCode.value.trim(),currentPassword=form.elements.currentPassword.value,error=$('#operator-code-error');
    error.textContent='';if(newCode.length<12){error.textContent='새 코드는 12자 이상 입력해주세요.';return;}if(newCode!==confirmCode){error.textContent='새 코드가 서로 다릅니다.';form.elements.confirmCode.focus();return;}
    const revision=authRevision,version=codeInfo.version;let saved;
    const success=await mutate(async()=>{saved=await SaiBackend.rotateOperatorCode({newCode,currentPassword,version});},form.querySelector('[type=submit]'),error);
    form.elements.currentPassword.value='';
    if(success&&revision===authRevision&&staff()){form.reset();codeInfo=saved;codeSuccess=true;render();}
  }
  function launchScreen(){return `<div class="launch-screen" role="status"><div class="launch-mark"><img src="assets/sai-logo.png" alt="SAI 동아리 로고" width="112" height="112"></div><strong class="launch-wordmark">SAI ROOM</strong><span class="launch-progress" aria-hidden="true"></span><p>불러오는 중</p><span class="launch-caption">SEJONG ARTIFICIAL INTELLIGENCE</span></div>`;}
  function notFound() {
    appHeader("화면을 찾을 수 없어요", "home");
    mainNav("", false);
    return '<div class="empty-state">삭제되었거나 없는 항목이에요.</div><button class="primary-button" data-action="go" data-route="home">홈으로 돌아가기</button>';
  }
  function render() {
    SaiMotion.unmount();
    setActions();
    const requested = decodeURI(location.hash.slice(1) || "home"), route = authenticated && ["login","signup"].includes(requested) ? "home" : requested;
    if (route !== "custom") draftCustom = null;
    if(route!=="ball")draftBall=null;
    document.body.dataset.theme = approved()?state.settings.theme:"light";
    const parts = route.split("/");
    let html;
    if (!authenticated) { if(booting){appHeader('SAI',null);mainNav('',false);html=launchScreen();}else html=loginScreen(requested==="signup"); }
    else if(!approved())html=membershipScreen();
    else if (bootError) { appHeader('SAI',null); mainNav('',false); html=`<div class="connection-screen"><h2>연결을 확인해주세요</h2><p>${esc(bootError)}</p><button class="primary-button" data-action="retry-boot">다시 시도</button></div>`; }
    else if (route === "home") html = home();
    else if (route === "reservations") html = reservations();
    else if (route === "reservation/new") html = bookingForm();
    else if (parts[0] === "reservation" && parts[1] === "edit")
      html = bookingForm(parts[2]);
    else if (parts[0] === "reservation") html = bookingDetail(parts[1]);
    else if (route === "board") html = board();
    else if (route === "messages") {boardFilter=["대기 중","답변 완료"].includes(boardFilter)?boardFilter:"전체";html=board(true);}
    else if (route === "inbox") html=staff()?board(true):forbidden();
    else if (route === "members") html=admin()?membershipAdmin():forbidden();
    else if (route === "operator-code") html=staff()?operatorCodeSettings():forbidden();
    else if (route === "beacon") html=beaconScreen();
    else if (route === "beacon-settings") html=staff()?beaconSettingsScreen():forbidden();
    else if (route === "ball") html=ballSettings();
    else if (route === "post/new") html = postForm();
    else if (parts[0] === "post" && parts[1] === "edit")
      html = postForm(parts[2]);
    else if (parts[0] === "post") html = postDetail(parts[1]);
    else if (route === "custom") html = custom();
    else if (route === "settings") html = settings();
    else html = notFound();
    const changed = (authenticated?route:'login') !== currentRoute;
    view.innerHTML = html;
    view.scrollTop = 0;
    currentRoute = authenticated?route:'login';
    document.title = `${header.querySelector("h1").textContent} · SAI ROOM`;
    if (changed) view.focus({ preventScroll: true });
    if (authenticated && route === "reservations")
      $(".timetable").scrollTop = Math.max(
        0,
        ((selectedSlot.start - 540) / 30) * 44 - Math.min(80, $(".timetable").clientHeight / 4),
      );
    if(approved())SaiMotion.mount(view,reading,state.settings.gauge,state.settings.theme);
    document.body.dataset.route=booting?'loading':!authenticated?(requested==='signup'?'signup':'login'):!approved()?'pending':route.split('/')[0];
    header.hidden=!approved();
    if(!authenticated&&signupEmail&&$('#login-email'))$('#login-email').value=signupEmail;
    if(approved()&&route==='operator-code'&&staff()&&!codeInfo&&!codeLoading&&!codeError)loadCodeInfo();
    if(approved()&&route==='members'&&admin()&&applications===null&&!applicationsLoading&&!applicationsError)loadApplications();
    if(approved()&&(route==='beacon'||(route==='beacon-settings'&&staff()))&&!SaiBeacon.status.config&&!beaconLoading&&!beaconLoadError)loadBeacon();

  }
  const isPastSlot = b => new Date(`${b.date}T${time(b.start)}:00+09:00`).getTime() <= Date.now();
  const overlapping = (b) =>
    state.bookings.find(
      (x) =>
        x.id !== b.id &&
        x.date === b.date &&
        b.start < x.end &&
        b.end > x.start,
    );
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, value, id } = btn.dataset;
    if (busy) return;
    if(action==='login')return;
    if(action==='auth-route'&&!authenticated){go(btn.dataset.route);return;}
    if(action==='toggle-password'){const input=$('#'+(btn.dataset.target||'login-password')),show=input.type==='password';input.type=show?'text':'password';btn.textContent=show?'숨김':'표시';btn.setAttribute('aria-label',show?'비밀번호 숨김':'비밀번호 표시');btn.setAttribute('aria-pressed',String(show));return;}
    if(action==='retry-boot')return boot();
    if(!authenticated)return;
    if(action==='logout'){if(await mutate(()=>SaiBackend.logout(),btn)){clearSession(false);history.replaceState(null,'',location.pathname+location.search+'#login');render();}return;}
    if(!approved())return;
    if(action==='beacon-toggle'){if(SaiBeacon.running)await SaiBeacon.stop();else await SaiBeacon.start({userInitiated:true});return;}
    if(action==='beacon-sim-toggle'){SaiBeacon.useSimulator(!SaiBeacon.status.useSimulator);return;}
    if(action==='beacon-sim-mode'){if(SaiBeacon.simulator)SaiBeacon.simulator.setMode(value);render();return;}
    if(action==='refresh-beacon'){beaconLoadError='';await loadBeacon();return;}
    if(action==='refresh-code'&&staff()){codeInfo=null;codeSuccess=false;codeError='';await loadCodeInfo();return;}
    if(action==='toggle-check-in'){
      const revision=authRevision;
      await mutate(async()=>{
        const result=await SaiBackend.setPresence(!checkedIn);
        if(revision!==authRevision)return;
        await SaiPresence.refresh({afterWrite:true});
        if(revision===authRevision){checkedIn=result.checkedIn;updateCheckInRow();}
      },btn);
      return;
    }
    if(action==='refresh-applications'){applications=null;loadApplications();return;}
    if(action==='application-filter'&&admin()){applicationFilter=value;render();return;}
    if(action==='decide-member'&&admin()){
      const record=applications?.find(x=>x.id===id&&x.membershipStatus==='pending');if(!record)return;
      if(value==='rejected'&&!await confirmAction('가입을 거절할까요?',`${record.displayName} 님의 가입 신청을 거절합니다.`,'가입 거절'))return;
      if(!admin())return;const success=await mutate(()=>SaiBackend.decide(id,value),btn);
      if(success&&admin()){toast(value==='approved'?'가입을 승인했습니다':'가입을 거절했습니다');applications=null;loadApplications();}return;
    }
    if(action==='ball-color'&&draftBall){draftBall.color=value;const y=view.scrollTop;render();view.scrollTop=y;return;}
    if(action==='remove-ball-image'&&draftBall){draftBall.imageUrl=null;draftBall.imageId=null;draftBall.imageData=null;render();return;}
    if(action==='save-ball'&&draftBall){const version=authRevision,editing=draftBall;let saved={...editing};const success=await mutate(async()=>{if(editing.imageData){const image=await SaiBackend.uploadBallImage(editing.imageData);saved={...saved,...image};}saved=await SaiBackend.saveBall(saved);},btn,$('#ball-error'));if(success&&version===authRevision&&approved()){ball=saved;draftBall=null;toast('내 공을 저장했습니다');go('home');}return;}
    if (action === 'device-motion') { await SaiDeviceMotion.toggle();return; }
    if (action === 'refresh-data') { await mutate(async()=>{const version=authRevision,data=await SaiBackend.bootstrap();if(version!==authRevision)return;state.bookings=data.bookings;state.posts=data.posts;render();toast('목록을 갱신했어요');},btn);return; }
    if (action === 'reserve-free') { const slot=nextFreeSlot();if(slot){selectedDate=slot.date;selectedSlot=slot;} go('reservations'); }
    else if (action === "go") go(btn.dataset.route);
    else if (action === "refresh") {
      await SaiPresence.refresh();
    } else if (action === "date-prev" || action === "date-next") {
      selectedDate = addDay(selectedDate, action === "date-prev" ? -7 : 7);
      selectedSlot = { ...selectedSlot, date: selectedDate };selectedTimeEdited=false;
      render();
    } else if (action === "date-select") {
      selectedDate=btn.dataset.date;selectedSlot={...selectedSlot,date:selectedDate};selectedTimeEdited=false;render();
    } else if (action === "slot") {
      const start = Number(btn.dataset.start),
        slot = {
          date: btn.dataset.date,
          start,
          end: Math.min(start + 60, 1380),
        };
      if(isPastSlot(slot)){toast("앞으로 이용할 시간을 선택해주세요.");return;}
      const conflict = overlapping(slot);
      if (conflict) {
        slot.end = start + 30;
        if (overlapping(slot)) {
          toast("이미 예약된 시간이에요");
          return;
        }
      }
      selectedSlot = slot;selectedTimeEdited=false;
      const sc = $(".timetable").scrollTop;
      render();
      $(".timetable").scrollTop = sc;
    } else if (action === "cancel-booking") {
      const b = state.bookings.find((b) => b.id === id && b.owner === "me");
      if (
        b &&
        (await confirmAction(
          "예약을 취소할까요?",
          `${b.purpose}: ${b.name} · ${time(b.start)}–${time(b.end)}`,
          "예약 취소",
        ))
      ) {
        if(remote && !await mutate(()=>SaiBackend.deleteBooking(id),btn)) return;
        state.bookings = state.bookings.filter((b) => b.id !== id);
        save("예약을 취소했어요");
        go("reservations");
      }
    } else if (action === "board-kind") {
      boardKind = value;
      boardFilter = "전체";
      if(value==="inquiry")go(inboxRoute());else go("board");
    } else if (action === "board-filter") {
      boardFilter = value;
      render();
    } else if (action === "compose") {
      boardKind = btn.dataset.kind;
      go("post/new");
    } else if (action === "delete-post") {
      const p = state.posts.find((p) => p.id === id && p.owner === "me");
      if (
        p &&
        (await confirmAction(
          "글을 삭제할까요?",
          "이 글과 댓글을 함께 삭제합니다.",
          "삭제",
        ))
      ) {
        if(remote && !await mutate(()=>SaiBackend.deletePost(id),btn)) return;
        state.posts = state.posts.filter((p) => p.id !== id);
        save("글을 삭제했어요");
        go("board");
      }
    } else if (action === "gauge-choice" || action === "theme-choice") {
      draftCustom[action === "gauge-choice" ? "gauge" : "theme"] = value;
      const scroll = view.scrollTop;
      render();
      view.scrollTop = scroll;
      view
        .querySelector(`[data-action="${action}"][data-value="${value}"]`)
        .focus({ preventScroll: true });
    } else if (action === "apply-custom") {
      if(remote && !await mutate(()=>SaiBackend.preference(draftCustom),btn)) return;
      state.settings = { ...state.settings, ...draftCustom };
      save("화면 설정을 저장했습니다");
      go("home");
    }
  });
  document.addEventListener("input", (e) => {
    if(e.target.id==='ball-color-input'&&draftBall){draftBall.color=e.target.value;$('.personal-ball').style.setProperty('--personal-color',draftBall.color);}

    if (e.target.closest("#booking-form")) {
      const f = $("#booking-form"),
        d = new FormData(f);
      $("#booking-preview").textContent =
        `${d.get("purpose").trim() || "이용 목적"}: ${d.get("name").trim() || "대표자"} · ${d.get("people") || "0"}명`;
      $("#booking-time-preview").textContent =
        `${time(Number(d.get("start")))}–${time(Number(d.get("end")))}`;
    }
    if (e.target.id === "post-body")
      $("#character-count").textContent = `${e.target.value.length} / 2,000`;
  });
  document.addEventListener("change", async (e) => {
    if (e.target.id === 'selection-start' || e.target.id === 'selection-end') {
      const focusId=e.target.id,scroll=view.scrollTop;
      if(focusId==='selection-start'){
        const duration=selectedSlot.end-selectedSlot.start;
        selectedSlot={...selectedSlot,start:Number(e.target.value),end:Math.min(1380,Number(e.target.value)+duration)};
      }else selectedSlot={...selectedSlot,end:Number(e.target.value)};
      selectedTimeEdited=true;render();view.scrollTop=scroll;$('#'+focusId).focus({preventScroll:true});
      return;
    }
    if(e.target.id==='booking-start'){
      const start=Number(e.target.value),end=$('#booking-end');
      if(Number(end.value)<=start)end.value=String(start+30);
      Array.from(end.options).forEach(option=>option.disabled=Number(option.value)<=start);
      $('#booking-time-preview').textContent=`${time(start)}–${time(Number(end.value))}`;
      $('#booking-error').textContent='';
    }
    if (e.target.id === "calendar-date" && e.target.value) {
      selectedDate = e.target.value;
      selectedSlot = {...selectedSlot,date:selectedDate};selectedTimeEdited=false;
      render();
    }
  });
  document.addEventListener('change',async e=>{
    if(!approved()||!draftBall)return;
    if(e.target.id==='ball-anonymous'){draftBall.anonymous=e.target.checked;const y=view.scrollTop;render();view.scrollTop=y;}
    if(e.target.id==='ball-image'){const editing=draftBall,version=authRevision,error=$('#ball-error');try{const imageData=await readBallImage(e.target.files?.[0]);if(version!==authRevision||draftBall!==editing)return;draftBall.imageData=imageData;draftBall.imageUrl=imageData;draftBall.imageId=null;render();}catch(err){if(error?.isConnected)error.textContent=err.message;}}
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if(f.id==="signup-form"){e.preventDefault();await submitSignup(f);return;}
    if(f.id==="login-form"){e.preventDefault();await submitLogin(f);return;}
    if(!approved())return;
    if(f.id==="operator-code-form"){e.preventDefault();await submitCode(f);return;}
    if(f.id==="beacon-config-form"){e.preventDefault();await submitBeaconConfig(f);return;}
    if (!["booking-form", "post-form", "comment-form"].includes(f.id)) return;
    e.preventDefault();
    if(busy) return;
    const d = new FormData(f);
    if (f.id === "booking-form") {
      let b = {
        id: f.dataset.id || uid(),
        owner: "me",
        authorId:user().id,
        date: d.get("date"),
        start: Number(d.get("start")),
        end: Number(d.get("end")),
        purpose: d.get("purpose").trim(),
        name: d.get("name").trim(),
        people: Number(d.get("people")),
      };
      let err = "";
      if (!b.purpose || !b.name)
        err = "이용 목적과 대표자 이름을 입력해주세요.";
      else if (!Number.isInteger(b.people) || b.people < 1 || b.people > 15)
        err = "사용 인원은 1–15명으로 입력해주세요.";
      else if (
        !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
        !Number.isFinite(dateObj(b.date).getTime())
      )
        err = "올바른 날짜를 선택해주세요.";
      else if (
        b.start >= b.end ||
        b.start < 540 ||
        b.end > 1380 ||
        b.start % 30 ||
        b.end % 30
      )
        err = "종료 시간은 시작 시간보다 늦어야 해요.";
      else if (new Date(`${b.date}T${time(b.start)}:00+09:00`).getTime() <= Date.now())
        err = "앞으로 이용할 시간을 선택해주세요.";
      else {
        const other = overlapping(b);
        if (other)
          err = `${time(other.start)}–${time(other.end)}에 다른 예약이 있어요. 시간을 다시 선택해주세요.`;
      }
      if (err) {
        $("#booking-error").textContent = err;
        $("#booking-error").scrollIntoView({ block: "nearest" });
        return;
      }
      if(remote && !await mutate(async()=>{b=await SaiBackend.booking(b,f.dataset.id||null);},f.querySelector('[type="submit"]'),$('#booking-error')))return;
      state.bookings = state.bookings.filter((x) => x.id !== b.id);
      state.bookings.push(b);
      selectedDate = b.date;selectedTimeEdited=false;
      selectedSlot = {
        date: b.date,
        start: Math.min(b.end, 1350),
        end: Math.min(b.end + 60, 1380),
      };
      save(f.dataset.id ? "예약을 수정했어요" : "예약을 저장했어요");
      go("reservations");
    } else if (f.id === "post-form") {
      const title = d.get("title").trim(),
        body = d.get("body").trim();
      if (!title || !body) {
        $("#post-error").textContent = "제목과 내용을 입력해주세요.";
        return;
      }
      const existing = state.posts.find(
        (p) => p.id === f.dataset.id && p.owner === "me",
      );
      if(remote) {
        const payload={kind:f.dataset.kind,category:d.get('category'),title,body};let saved;
        if(!await mutate(async()=>{saved=await SaiBackend.post(payload,f.dataset.id||null);},f.querySelector('[type="submit"]'),$('#post-error')))return;
        state.posts=state.posts.filter(p=>p.id!==saved.id);state.posts.push(saved);boardKind=saved.kind;boardFilter='전체';toast(existing?'글을 수정했어요':'글을 등록했어요');go(`post/${saved.id}`);return;
      }
    } else if (f.id === "comment-form") {
      const p = state.posts.find((p) => p.id === f.dataset.id),
        body = d.get("body").trim();
      if (!body) {
        $("#comment-error").textContent = "댓글 내용을 입력해주세요.";
        return;
      }
      const reply = f.dataset.reply === "true";
      if (!p || (reply ? !staff() : p.kind!=="public"&&p.owner!=="me")) return;
      let comment={id:uid(),body,owner:reply?'admin':'me',authorId:user().id,isStaff:reply,createdAt:Date.now()};
      if(remote&&!await mutate(async()=>{comment=await SaiBackend.comment(p.id,body,reply);},f.querySelector('[type="submit"]'),$('#comment-error')))return;
      p.comments.push(comment);
      if(p.kind==="inquiry")p.status=reply?"answered":"received";
      save(reply ? "답변을 등록했어요" : "댓글을 등록했어요");
      render();
      $(".comment-form").scrollIntoView({ block: "end" });
    }
  });
  window.addEventListener("hashchange", render);
  function updateCheckInRow(){
    const row=document.querySelector('.check-in-row');if(!row)return;
    row.querySelector('strong').textContent=checkedIn?'동방에 있어요':'동방에 도착했나요?';
    const button=row.querySelector('button');button.textContent=checkedIn?'퇴실하기':'입실하기';button.className=checkedIn?'secondary-button':'primary-button';
  }
  SaiPresence.subscribe(value=>{reading=value;if(value.snapshot){const note=document.querySelector('#beacon-last');if(note)note.textContent=beaconNoteText(value.snapshot);state.settings.occupancy=value.snapshot.count;state.settings.capacity=value.snapshot.referenceCapacity;if(typeof value.snapshot.checkedIn==='boolean'&&checkedIn!==value.snapshot.checkedIn){checkedIn=value.snapshot.checkedIn;updateCheckInRow();}}if(approved())SaiMotion.update(value);});
  // Re-draw only screens without text inputs when detection status changes, so typing is never wiped.
  SaiBeacon.subscribe(()=>{if(authenticated&&approved()&&['#beacon','#settings'].includes(location.hash)&&!busy)render();});
  window.addEventListener('sai:session-expired',()=>clearSession(authenticated));
  window.addEventListener('sai:permissions-changed',()=>{clearSession(false);boot();});
  async function boot(){
    const version=++authRevision,started=performance.now();bootError='';booting=true;authenticated=false;SaiPresence.stop();state.bookings=[];state.posts=[];announceAuth();render();
    try{const data=await SaiBackend.bootstrap();if(version!==authRevision)return;state.bookings=data.bookings;state.posts=data.posts;state.settings={...state.settings,...data.preferences};ball=data.ball;checkedIn=data.checkedIn===true;sessionExpired=false;authenticated=true;if(approved()){SaiPresence.start(state.settings);SaiBeacon.restore().catch(()=>{});}else{state.bookings=[];state.posts=[];}}
    catch(e){if(version!==authRevision)return;bootError=e.status===401?'':e.message;}
    if(firstBoot){firstBoot=false;await new Promise(resolve=>setTimeout(resolve,Math.max(0,500-(performance.now()-started))));}
    if(version!==authRevision)return;booting=false;announceAuth();render();
  }
  window.SaiAuth={get signedIn(){return approved();},get user(){return user();},get ball(){return {...ball};}};
  boot();
})();
