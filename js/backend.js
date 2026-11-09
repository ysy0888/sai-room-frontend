/* Transport only. No secret, demo fallback, or local authorization in HTTP mode. */
(function () {
  'use strict';
  const config=window.SAI_CONFIG, pendingKeys=new Map();
  let csrf='', user=null;
  class ApiError extends Error { constructor(message,status=0,code='NETWORK'){super(message);this.status=status;this.code=code;} }
  async function request(path,{method='GET',body,signal}={}) {
    const write=!['GET','HEAD'].includes(method),auth=path.startsWith('/auth/')||path==='/staff/operator-code',login=path==='/auth/login'&&method==='POST';
    // Never retain credentials in the retry-key map, URLs, or browser storage.
    const fingerprint=auth?null:method+path+JSON.stringify(body??null);
    let key=auth?null:pendingKeys.get(fingerprint);if(write&&!auth&&!key){key=crypto.randomUUID();pendingKeys.set(fingerprint,key);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000),abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
    try {
      const response=await fetch(config.apiBase.replace(/\/$/,'')+path,{method,credentials:'include',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(write?{'Content-Type':'application/json','X-CSRF-Token':csrf,...(key?{'Idempotency-Key':key}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const json=response.status===204?null:await response.json().catch(()=>null);
      if(!response.ok){const codeMessages={PASSWORD_MISMATCH:'내 비밀번호를 확인해주세요.',WEAK_OPERATOR_CODE:'운영진 코드는 12자 이상으로 설정해주세요.',CODE_UNCHANGED:'기존 코드와 다른 코드를 입력해주세요.',CODE_VERSION_CONFLICT:'다른 운영진이 코드를 변경했습니다. 새로고침한 뒤 다시 입력해주세요.',ACCOUNT_UNAVAILABLE:'이미 가입된 이메일 또는 학번입니다.',INVALID_PROFILE:'이름과 학번을 확인해주세요.',INVALID_INPUT:'입력한 내용을 확인해주세요.',INVALID_BOOKING:'예약 날짜와 시간을 확인해주세요.',CSRF_FAILED:'연결 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.'};if(codeMessages[json?.error?.code])throw new ApiError(codeMessages[json.error.code],response.status,json.error.code);if(path==='/auth/signup'&&[400,422].includes(response.status)&&json?.error?.code==='INVALID_OPERATOR_CODE')throw new ApiError('운영진 코드를 확인해주세요. 만료되었거나 사용할 수 없는 코드입니다.',response.status,'INVALID_OPERATOR_CODE');if(response.status>=400&&response.status<500)pendingKeys.delete(fingerprint);const messages={401:login?'이메일 또는 비밀번호를 확인해주세요.':'로그인이 필요합니다.',403:'이 작업을 할 권한이 없습니다.',409:auth?'이 이메일로 가입할 수 없습니다. 로그인하거나 다른 이메일을 입력해주세요.':path.startsWith('/admin/')?'이미 처리된 신청입니다. 목록을 새로고침해주세요.':'다른 예약과 시간이 겹칩니다. 시간을 다시 선택해주세요.',429:'잠시 후 다시 시도해주세요.'};if(response.status===401&&!login&&(user||!path.startsWith('/bootstrap')))window.dispatchEvent(new Event('sai:session-expired'));if(response.status===403&&write&&(!auth||path==='/staff/operator-code'))window.dispatchEvent(new Event('sai:permissions-changed'));throw new ApiError(messages[response.status]||'서버에서 처리하지 못했습니다. 다시 시도해주세요.',response.status,json?.error?.code);}
      if(write)pendingKeys.delete(fingerprint);return json;
    } catch(e){if(e instanceof ApiError)throw e;throw new ApiError(controller.signal.aborted?'응답이 늦어지고 있습니다. 다시 시도해주세요.':'연결을 확인한 후 다시 시도해주세요.');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  const dateValid=s=>{const d=new Date(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
  function resource(value,type){
    const base=value&&typeof value.id==='string'&&/^[a-zA-Z0-9_-]+$/.test(value.id)&&['me','other','admin'].includes(value.owner);
    const valid=base&&(type==='booking'?typeof value.date==='string'&&dateValid(value.date)&&Number.isInteger(value.start)&&Number.isInteger(value.end)&&value.start>=540&&value.end<=1380&&value.start<value.end&&value.start%30===0&&value.end%30===0&&typeof value.purpose==='string'&&typeof value.name==='string'&&Number.isInteger(value.people)&&value.people>=1&&value.people<=15:type==='comment'?typeof value.body==='string'&&Number.isFinite(value.createdAt):['public','inquiry'].includes(value.kind)&&typeof value.title==='string'&&typeof value.body==='string'&&(value.kind==='public'?['자유','스터디','공용물품']:['문의','건의']).includes(value.category)&&Number.isFinite(value.createdAt)&&Array.isArray(value.comments)&&value.comments.every(c=>{try{return !!resource(c,'comment');}catch{return false;}}));
    if(!valid)throw new ApiError('서버 응답 형식을 확인해주세요.',502,'INVALID_RESPONSE');return value;
  }
  function preferences(value){
    if(value===undefined)return {};if(!value||typeof value!=='object'||(value.theme!==undefined&&!['light','dark','blue'].includes(value.theme))||(value.gauge!==undefined&&!['basic','water','lava'].includes(value.gauge)))throw new ApiError('화면 설정 형식을 확인해주세요.',502,'INVALID_RESPONSE');
    return {...(value.theme?{theme:value.theme}:{}),...(value.gauge?{gauge:value.gauge}:{})};
  }
  function memberList(value) {
    const valid = value && Number.isInteger(value.count) && value.count >= 0 && value.count <= 10000 &&
      Number.isInteger(value.hiddenCount) && value.hiddenCount >= 0 &&
      Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
      typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) &&
      Array.isArray(value.members) && value.members.length + value.hiddenCount === value.count &&
      value.members.every(m => m && typeof m.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(m.id) &&
        typeof m.displayName === 'string' && m.displayName.trim().length > 0 && m.displayName.length <= 40 &&
        (m.isSelf === undefined || typeof m.isSelf === 'boolean') && (m.ball===undefined || (()=>{try{ballStyle(m.ball);return true;}catch{return false;}})())) &&
      new Set(value.members.map(m=>m.id)).size === value.members.length;
    if (!valid) throw new ApiError('회원 목록을 확인할 수 없습니다. 다시 불러와주세요.',502,'INVALID_RESPONSE');
    return {count:value.count,hiddenCount:value.hiddenCount,sequence:value.sequence,observedAt:value.observedAt,
      members:value.members.map(m=>({id:m.id,displayName:m.ball?.anonymous?'익명 회원':m.displayName.trim(),isSelf:m.isSelf===true,...(m.ball?{ball:ballStyle(m.ball)}:{})}))};
  }
  async function preauth(){const data=await request('/auth/csrf');if(typeof data?.csrfToken!=='string'||!data.csrfToken)throw new ApiError('로그인 연결을 확인해주세요.',502,'INVALID_RESPONSE');csrf=data.csrfToken;}
  function safeImage(value){return typeof value==='string'&&/^\/media\/[a-zA-Z0-9_/-]+\.(png|jpe?g|webp)$/.test(value);}
  function ballStyle(value){
    if(value===undefined)return {anonymous:false,color:'#233f6d',imageId:null,imageUrl:null};
    if(!value||typeof value.anonymous!=='boolean'||!/^#[0-9a-f]{6}$/i.test(value.color)||(value.imageUrl!=null&&!safeImage(value.imageUrl))||(value.imageId!=null&&typeof value.imageId!=='string'))throw new ApiError('공 설정을 확인해주세요.',502,'INVALID_RESPONSE');
    return {anonymous:value.anonymous,color:value.color,imageId:value.imageId||null,imageUrl:value.imageUrl||null};
  }
  function codeMetadata(data){if(!data||data.configured!==true||!Number.isInteger(data.version)||data.version<1||!Number.isFinite(data.updatedAt)||(data.updatedBy!==null&&typeof data.updatedBy!=='string'))throw new ApiError('코드 정보를 불러오지 못했습니다.',502);return {configured:true,version:data.version,updatedAt:data.updatedAt,updatedBy:data.updatedBy};}
  const api={
    get enabled(){return true;},get user(){return user;},request,
    async bootstrap(){const data=await request('/bootstrap?roomId='+encodeURIComponent(config.roomId));if(!data?.user||typeof data.user.displayName!=='string'||!['member','operator','admin'].includes(data.user.role)||!['pending','approved','rejected'].includes(data.user.membershipStatus)||typeof data.csrfToken!=='string'||!Array.isArray(data.bookings)||!Array.isArray(data.posts))throw new ApiError('초기 데이터 형식을 확인해주세요.',502,'INVALID_RESPONSE');
      data.bookings.forEach(b=>resource(b,'booking'));data.posts.forEach(p=>resource(p,'post'));if(data.user.membershipStatus!=='approved'&&(data.bookings.length||data.posts.length))throw new ApiError('승인 전 데이터가 포함된 응답입니다.',502,'INVALID_RESPONSE');if(data.user.role==='member'&&data.posts.some(p=>p.kind==='inquiry'&&p.owner!=='me'))throw new ApiError('문의 공개 범위를 확인해주세요.',502,'INVALID_RESPONSE');data.preferences=preferences(data.preferences);data.ball=ballStyle(data.ball);user=data.user;csrf=data.csrfToken;return data;},
    async booking(payload,id){const {owner:_,id:__,authorId:___,...body}=payload;return resource(await request('/bookings'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:{...body,roomId:config.roomId}}),'booking');},
    deleteBooking:id=>request('/bookings/'+encodeURIComponent(id),{method:'DELETE'}),
    async post({kind,category,title,body},id){return resource(await request('/posts'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:{kind,category,title,body,roomId:config.roomId}}),'post');},
    deletePost:id=>request('/posts/'+encodeURIComponent(id),{method:'DELETE'}),
    async comment(id,body,reply=false){return resource(await request('/posts/'+encodeURIComponent(id)+(reply?'/reply':'/comments'),{method:'POST',body:{body}}),'comment');},
    preference:body=>request('/me/preferences',{method:'PATCH',body}),
    async members(signal){return memberList(await request('/rooms/'+encodeURIComponent(config.roomId)+'/occupants',{signal}));},
    occupancy:signal=>request('/rooms/'+encodeURIComponent(config.roomId)+'/occupancy',{signal}),
    async signIn(email,password){await preauth();await request('/auth/login',{method:'POST',body:{email,password}});},
    async signUp({displayName,studentId,email,password,operatorCode=''}){if(typeof operatorCode!=='string'||operatorCode.trim().length>128)throw new ApiError('운영진 코드를 확인해주세요.',422,'INVALID_OPERATOR_CODE');const code=operatorCode.trim();await preauth();await request('/auth/signup',{method:'POST',body:{displayName,studentId,email,password,...(code?{operatorCode:code}:{})}});},
    async applications(){if(user?.role!=='admin'||user.membershipStatus!=='approved')throw new ApiError('관리자만 확인할 수 있습니다.',403);const data=await request('/admin/membership-applications');if(!Array.isArray(data)||data.some(x=>!x||typeof x.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(x.id)||typeof x.displayName!=='string'||typeof x.email!=='string'||(x.role!==undefined&&!['member','operator'].includes(x.role))||!['pending','approved','rejected'].includes(x.membershipStatus)||!Number.isFinite(x.createdAt)))throw new ApiError('가입 신청 목록을 확인해주세요.',502);return data.map(({id,displayName,email,role,membershipStatus,createdAt})=>({id,displayName,email,role:role||'member',membershipStatus,createdAt}));},
    async decide(id,membershipStatus){if(user?.role!=='admin'||user.membershipStatus!=='approved'||!['approved','rejected'].includes(membershipStatus))throw new ApiError('관리자 권한을 확인해주세요.',403);await request('/admin/membership-applications/'+encodeURIComponent(id),{method:'PATCH',body:{membershipStatus}});},
    async operatorCode(){if(!['operator','admin'].includes(user?.role)||user.membershipStatus!=='approved')throw new ApiError('운영진만 변경할 수 있습니다.',403);return codeMetadata(await request('/staff/operator-code'));},
    async rotateOperatorCode({newCode,currentPassword,version}){if(!['operator','admin'].includes(user?.role)||user.membershipStatus!=='approved')throw new ApiError('운영진만 변경할 수 있습니다.',403);return codeMetadata(await request('/staff/operator-code',{method:'PUT',body:{newCode,currentPassword,version}}));},
    async setPresence(checkedIn){const data=await request('/me/presence',{method:checkedIn?'POST':'DELETE'});if(typeof data?.checkedIn!=='boolean')throw new ApiError('입·퇴실 상태를 확인해주세요.',502);return data;},
    async saveBall({anonymous,color,imageId}){return ballStyle(await request('/me/ball',{method:'PATCH',body:{anonymous,color,imageId}}));},
    async uploadBallImage(imageData){const data=await request('/me/ball-image',{method:'POST',body:{imageData}});if(!data||typeof data.imageId!=='string'||!safeImage(data.imageUrl))throw new ApiError('이미지 응답을 확인해주세요.',502);return data;},
    async logout(){await request('/auth/logout',{method:'POST'});user=null;csrf='';},
    clear(){user=null;csrf='';pendingKeys.clear();}
  };window.SaiBackend=api;
})();
