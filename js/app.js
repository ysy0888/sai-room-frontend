/* SAI ROOM 프론트엔드. 외부 API / 서버 / 프레임워크 의존성이 없습니다. */
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
  let occupancyFrame;
  // 예약 데이터는 FastAPI 서버에서 관리합니다.
  const API_BASE = "http://127.0.0.1:8000";
  const authTokenKey = "sai-auth-token";
  let authToken = sessionStorage.getItem(authTokenKey) || "";
  let authUser = null;
  async function refreshAuth() {
    if (!authToken) { authUser = null; render(); return; }
    try { authUser = await apiRequest("/auth/me"); }
    catch (err) { authToken = ""; authUser = null; sessionStorage.removeItem(authTokenKey); }
    render();
  }
  function authForm(mode) {
    appHeader(mode === "signup" ? "회원가입" : "로그인", "settings");
    mainNav("", false);
    const signup = mode === "signup";
    return `<form id="auth-form" data-mode="${mode}" class="stack screen-enter">
      <h2 class="section-title">${signup ? "SAI 회원가입 신청" : "SAI ROOM 로그인"}</h2>
      <p class="muted">${signup ? "가입 후 운영진 승인이 완료되어야 로그인할 수 있어요." : "운영진 승인을 받은 계정으로 로그인해 주세요."}</p>
      ${signup ? `<div class="form-field"><label>이름</label><input name="name" maxlength="40" required></div>
      <div class="form-field"><label>학번</label><input name="student_id" maxlength="20" required></div>` : ""}
      <div class="form-field"><label>아이디</label><input name="username" minlength="4" maxlength="30" autocomplete="username" required></div>
      <div class="form-field"><label>비밀번호</label><input name="password" type="password" minlength="8" maxlength="128" autocomplete="${signup ? "new-password" : "current-password"}" required></div>
      <p id="auth-error" class="form-error" role="alert"></p>
      <button class="primary-button" type="submit">${signup ? "가입 신청하기" : "로그인"}</button>
      <button class="secondary-button" type="button" data-action="go" data-route="${signup ? "login" : "signup"}">${signup ? "이미 계정이 있어요 · 로그인" : "계정이 없어요 · 회원가입"}</button>
    </form>`;
  }
  function adminPanel() {
    appHeader("회원 승인 관리", "settings"); mainNav("", false);
    return `<div class="stack screen-enter"><h2 class="section-title">승인 대기 회원</h2><div id="pending-users"><p class="muted">목록을 불러오는 중...</p></div></div>`;
  }
  async function loadPending() {
    if (!authUser || authUser.role !== "admin") return;
    try {
      const data = await apiRequest("/auth/pending");
      const target = $("#pending-users");
      if (!target) return;
      target.innerHTML = data.users.length ? data.users.map(u => `<div class="surface" style="padding:16px;margin-bottom:12px">
        <strong>${esc(u.name)}</strong><p class="muted">학번 ${esc(u.student_id)} · 아이디 ${esc(u.username)}</p>
        <div class="button-row"><button class="primary-button" data-action="approve-user" data-id="${esc(u.id)}">승인</button>
        <button class="danger-button" data-action="reject-user" data-id="${esc(u.id)}">거절</button></div></div>`).join("") : '<p class="muted">승인 대기 중인 회원이 없습니다.</p>';
    } catch (err) { const el = $("#pending-users"); if (el) el.textContent = err.message; }
  }
  const ownedIdsKey = "sai-owned-reservation-ids";
  const ownedIds = new Set(JSON.parse(localStorage.getItem(ownedIdsKey) || "[]"));
  let reservationsLoaded = false;
  const postTokensKey = "sai-post-edit-tokens";
  const postTokens = JSON.parse(localStorage.getItem(postTokensKey) || "{}");
  function savePostTokens() { localStorage.setItem(postTokensKey, JSON.stringify(postTokens)); }
  function normalizePost(p) {
    return { ...p, owner: postTokens[String(p.id)] ? "me" : "other",
      comments: (p.comments || []).map(c => ({...c, owner: "other"})) };
  }
  async function loadPosts() {
    try {
      const data = await apiRequest("/posts");
      state.posts = [...state.posts.filter(p => p.kind === "inquiry"),
        ...data.posts.map(normalizePost)];
      render();
    } catch (err) { toast(`게시판 조회 실패: ${err.message}`); }
  }

  function rememberOwned(id) {
    ownedIds.add(String(id));
    localStorage.setItem(ownedIdsKey, JSON.stringify([...ownedIds]));
  }
  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail;
      throw new Error(typeof detail === "string" ? detail : `서버 오류 (${response.status})`);
    }
    return data;
  }
  function normalizeBooking(b) {
    return {
      ...b,
      id: String(b.id ?? b.reservation_id),
      owner: ownedIds.has(String(b.id ?? b.reservation_id)) ? "me" : "other",
      start: Number(b.start), end: Number(b.end), people: Number(b.people),
    };
  }
  async function loadReservations() {
    try {
      const result = await apiRequest("/reservations");
      const rows = Array.isArray(result) ? result : (result?.reservations ?? result?.items);
      if (!Array.isArray(rows)) throw new Error("예약 조회 응답 형식을 확인해야 합니다.");
      state.bookings = rows.map(normalizeBooking);
      reservationsLoaded = true;
      render();
    } catch (err) {
      toast(`예약 조회 실패: ${err.message}`);
    }
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
  function save(message) {
    const ok = SaiData.save(state);
    if (message) toast(ok ? message : message + " (현재 화면에만 유지됩니다)");
  }
  function go(route) {
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
  function gauge(
    style = state.settings.gauge,
    count = state.settings.occupancy,
    mini = false,
  ) {
    const level = Math.min(
      100,
      Math.max(0, (count / state.settings.capacity) * 100),
    );
    return `<div class="gauge ${mini ? "mini-gauge" : ""}" data-style="${style}" data-empty="${count === 0}" style="--level:${level}%" role="meter" aria-label="동아리방 혼잡도 게이지" aria-valuenow="${Math.min(count, 15)}" aria-valuemin="0" aria-valuemax="15" aria-valuetext="${count}명, 게이지 기준 15명"><div class="gauge-fill"><span class="wave wave-one"></span><span class="wave wave-two"></span><span class="bubbles"><i></i><i></i><i></i></span></div></div>`;
  }
  function appHeader(title, back, action = "") {
    header.innerHTML = `${back ? `<button class="icon-button" data-action="go" data-route="${back}" aria-label="이전 화면">${icon("back")}</button>` : '<span class="header-spacer"></span>'}<h1>${title}</h1><div class="header-actions">${action}</div>`;
  }
  function mainNav(active, show = true) {
    nav.hidden = !show;
    nav.innerHTML = [
      ["reservations", "calendar", "예약"],
      ["board", "chat", "익명게시판"],
      ["custom", "palette", "커스텀"],
    ]
      .map(
        ([r, i, label]) =>
          `<button class="nav-item ${r === active ? "active" : ""}" data-action="go" data-route="${r}" ${r === active ? 'aria-current="page"' : ""}>${icon(i)}<span>${label}</span></button>`,
      )
      .join("");
  }
  function home() {
    appHeader(
      "SAI 동아리방",
      null,
      `<button class="icon-button" data-action="go" data-route="settings" aria-label="설정">${icon("gear")}</button>`,
    );
    mainNav("");
    const n = state.settings.occupancy,
      level = n < 5 ? "여유" : n < 9 ? "보통" : "혼잡";
    return `<div class="home-view screen-enter"><section class="brand-hero"><div class="logo-halo"><img class="brand-logo" src="assets/sai-logo.png" alt="SAI Sejong Artificial Intelligence 로고"></div><p class="eyebrow">OUR SPACE, OUR MOMENT</p><h2>지금, 동아리방</h2><p>가기 전에 한눈에 확인해요</p></section><section class="occupancy-section"><div class="section-heading"><h3>현재 이용 현황</h3><span class="status-pill ${n < 5 ? "quiet" : n < 9 ? "normal" : "busy"}">${level}</span></div>${gauge()}<p class="occupancy-number"><span class="number" id="live-count">${n}</span><span>명</span></p><p class="occupancy-label">현재 감지 인원</p><p class="helper">앱 참여자 기준 추정 인원</p><div class="update-line"><span class="dot ${state.settings.detecting ? "" : "off"}"></span><span>내 상태: ${state.settings.detecting ? "감지 중" : "감지 안 됨"}</span><button class="icon-button small" data-action="refresh" aria-label="현황 새로고침">${icon("refresh")}</button></div><p class="helper demo-caption">예시 인원 · 설정에서 변경 가능</p></section></div>`;
  }
  function reservations() {
    // 저장된 예약 위에 선택 표시가 겹치지 않도록 빈 구간으로 이동합니다.
    if (overlapping(selectedSlot)) {
      const starts = Array.from({ length: 28 }, (_, i) => 540 + i * 30);
      starts.sort(
        (a, b) =>
          Math.abs(a - selectedSlot.start) - Math.abs(b - selectedSlot.start),
      );
      const free = starts
        .map((start) => ({
          date: selectedSlot.date,
          start,
          end: Math.min(start + 60, 1380),
        }))
        .find((slot) => !overlapping(slot));
      selectedSlot = free || { ...selectedSlot, start: 1200, end: 1260 };
    }
    appHeader("동아리방 예약", "home");
    mainNav("reservations");
    const dates = [0, 1, 2].map((i) => addDay(selectedDate, i));
    let grid = "";
    const start = 540,
      end = 1380,
      cell = 32;
    for (let t = start; t < end; t += 30) {
      const top = ((t - start) / 30) * cell;
      grid += `<span class="time-label" style="top:${top}px">${time(t)}</span>`;
      dates.forEach((d, i) => {
        grid += `<button class="slot" style="top:${top}px;left:${(i * 100) / 3}%;height:${cell}px" data-action="slot" data-date="${d}" data-start="${t}" aria-label="${fmtDate(d, false)} ${time(t)} 예약 시간 선택"></button>`;
      });
    }
    state.bookings
      .filter((b) => dates.includes(b.date))
      .forEach((b) => {
        const col = dates.indexOf(b.date);
        grid += `<button class="booking-block ${b.owner === "me" ? "mine" : ""} ${b.end - b.start === 30 ? "short" : ""}" style="top:${((b.start - start) / 30) * cell + 2}px;left:calc(${(col * 100) / 3}% + 3px);height:${((b.end - b.start) / 30) * cell - 4}px" data-action="go" data-route="reservation/${b.id}"><strong>${esc(b.purpose)}: ${esc(b.name)}</strong><span>${b.people}명</span><small>${time(b.start)}–${time(b.end)}</small></button>`;
      });
    if (dates.includes(selectedSlot.date) && !overlapping(selectedSlot)) {
      const c = dates.indexOf(selectedSlot.date);
      grid += `<div class="selection-block" style="top:${((selectedSlot.start - start) / 30) * cell + 2}px;left:calc(${(c * 100) / 3}% + 3px);height:${((selectedSlot.end - selectedSlot.start) / 30) * cell - 4}px"><strong>선택한 시간</strong><span>${time(selectedSlot.start)}–${time(selectedSlot.end)}</span></div>`;
    }
    return `<div class="stack screen-enter"><div class="date-switch"><button class="icon-button" data-action="date-prev" aria-label="이전 날짜">${icon("back")}</button><label class="date-label">${fmtDate(selectedDate)}<input type="date" id="calendar-date" value="${selectedDate}" aria-label="예약 날짜 선택"></label><button class="icon-button" data-action="date-next" aria-label="다음 날짜">${icon("next")}</button></div><div class="day-headings">${dates.map((d, i) => `<span class="day-heading ${i === 0 ? "active" : ""}">${dateObj(d).toLocaleDateString("ko-KR", { weekday: "short", day: "numeric" })}</span>`).join("")}</div><div class="timetable" aria-label="3일 예약 타임테이블"><div class="time-grid" style="height:${((end - start) / 30) * cell}px">${grid}<span class="time-label" style="top:${((end - start) / 30) * cell - 10}px">23:00</span></div></div><div class="legend"><span><i class="legend-dot mine"></i>내 예약</span><span><i class="legend-dot"></i>다른 예약</span><span>30분 단위</span></div><div class="selection-summary"><span>${fmtDate(selectedSlot.date, false)}</span><strong>${time(selectedSlot.start)}–${time(selectedSlot.end)}</strong></div><button class="primary-button" data-action="go" data-route="reservation/new">선택한 시간 예약하기 ${icon("plus")}</button></div>`;
  }
  const timeOptions = (value, includeLast = true) =>
    Array.from({ length: includeLast ? 29 : 28 }, (_, i) => 540 + i * 30)
      .map(
        (t) =>
          `<option value="${t}" ${t === value ? "selected" : ""}>${time(t)}</option>`,
      )
      .join("");
  function bookingForm(id) {
    const edit =
      id && state.bookings.find((b) => b.id === id && b.owner === "me");
    if (id && !edit) return notFound();
    const b = edit || {
      ...selectedSlot,
      purpose: "스터디",
      name: "김동하",
      people: 4,
    };
    appHeader(
      edit ? "예약 수정" : "예약 작성",
      edit ? `reservation/${id}` : "reservations",
    );
    mainNav("", false);
    return `<form id="booking-form" data-id="${edit ? esc(edit.id) : ""}" class="stack screen-enter"><span class="chip">예약 정보</span><div class="form-field"><label for="booking-date">이용 날짜</label><input type="date" id="booking-date" name="date" value="${b.date}" required></div><div class="form-grid"><div class="form-field"><label for="booking-start">시작 시간</label><select id="booking-start" name="start">${timeOptions(b.start, false)}</select></div><div class="form-field"><label for="booking-end">종료 시간</label><select id="booking-end" name="end">${timeOptions(b.end)}</select></div></div><div class="form-field"><label for="booking-purpose">이용 목적</label><input id="booking-purpose" name="purpose" maxlength="20" value="${esc(b.purpose)}" placeholder="예: 스터디" required></div><div class="form-field"><label for="booking-name">예약 주체 / 대표자 이름</label><input id="booking-name" name="name" maxlength="20" value="${esc(b.name)}" placeholder="예: 김동하" required></div><div class="form-field"><label for="booking-people">사용 인원</label><input id="booking-people" name="people" type="number" min="1" max="15" value="${b.people}" required><p class="field-hint">대표자를 포함한 전체 인원 (1–15명)</p></div><div class="summary-card"><p>타임테이블에는 이렇게 보여요</p><strong id="booking-preview">${esc(b.purpose)}: ${esc(b.name)} · ${b.people}명</strong><span id="booking-time-preview">${time(b.start)}–${time(b.end)}</span></div><p class="form-error" id="booking-error" role="alert"></p><p class="helper">같은 시간의 중복 예약은 막아줘요</p><button class="primary-button" type="submit">${edit ? "수정 내용 저장" : "예약 저장"} ${icon("check")}</button></form>`;
  }
  function bookingDetail(id) {
    const b = state.bookings.find((b) => b.id === id);
    if (!b) return notFound();
    appHeader("예약 상세", "reservations");
    mainNav("", false);
    return `<div class="stack screen-enter"><span class="chip">${b.owner === "me" ? "내 예약" : "동아리방 예약"}</span><h2 class="detail-title">${esc(b.purpose)}: ${esc(b.name)}</h2><div class="surface detail-body"><div class="settings-row"><span>이용 날짜</span><strong>${fmtDate(b.date, false)}</strong></div><div class="settings-row"><span>이용 시간</span><strong>${time(b.start)}–${time(b.end)}</strong></div><div class="settings-row"><span>예약 주체</span><strong>${esc(b.name)}</strong></div><div class="settings-row"><span>사용 인원</span><strong>${b.people}명</strong></div></div>${b.owner === "me" ? `<button class="primary-button" data-action="go" data-route="reservation/edit/${b.id}">예약 수정 ${icon("edit")}</button><button class="danger-button" data-action="cancel-booking" data-id="${b.id}">예약 취소</button>` : '<p class="helper">본인 예약만 수정·취소할 수 있어요.</p>'}<button class="secondary-button" data-action="go" data-route="reservations">타임테이블로 돌아가기</button></div>`;
  }
  function board() {
    appHeader("익명게시판", "home");
    mainNav("board");
    let posts = state.posts
      .filter(
        (p) =>
          p.kind === boardKind &&
          (boardKind === "public" || p.owner === "me") &&
          (boardFilter === "전체" || p.category === boardFilter),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const cats =
      boardKind === "public"
        ? ["전체", "스터디", "공용물품", "자유"]
        : ["전체", "건의", "문의"];
    return `<div class="stack screen-enter"><div class="segmented" aria-label="게시판 선택"><button data-action="board-kind" data-value="public" class="${boardKind === "public" ? "active" : ""}" aria-pressed="${boardKind === "public"}">자유게시판</button><button data-action="board-kind" data-value="inquiry" class="${boardKind === "inquiry" ? "active" : ""}" aria-pressed="${boardKind === "inquiry"}">운영진 문의</button></div><p class="muted">${boardKind === "public" ? "이름 없이 편하게 이야기해요" : "내가 보낸 문의와 운영진의 답변을 확인해요"}</p><div class="board-tools">${cats.map((c) => `<button class="chip ${boardFilter === c ? "active" : ""}" data-action="board-filter" data-value="${c}" aria-pressed="${boardFilter === c}">${c}</button>`).join("")}</div><div class="post-list">${posts.length ? posts.map((p) => `<button class="post-card" data-action="go" data-route="post/${p.id}"><span class="post-card-top"><span class="category-label ${p.category === "공용물품" ? "rose" : ""}">${p.category}</span>${p.kind === "inquiry" ? `<span class="status-pill ${p.status === "answered" ? "quiet" : "normal"}">${p.status === "answered" ? "답변 완료" : "접수"}</span>` : ""}${p.owner === "me" ? '<span class="own-label">내 글</span>' : ""}</span><strong class="post-title">${esc(p.title)}</strong><span class="post-excerpt">${esc(p.body.split("\n")[0])}</span><span class="post-meta">익명 · ${relative(p.createdAt)} · ${p.kind === "inquiry" ? "답변" : "댓글"} ${p.comments.length}</span></button>`).join("") : '<div class="empty-state">아직 글이 없어요.<br><span>첫 이야기를 남겨보세요.</span></div>'}</div><button class="primary-button floating-compose" data-action="compose" data-kind="${boardKind}">${icon("edit")} ${boardKind === "public" ? "익명 글쓰기" : "운영진에게 문의하기"}</button></div>`;
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
      edit ? "글 수정" : p.kind === "public" ? "익명 글쓰기" : "운영진 문의",
      edit ? `post/${id}` : "board",
    );
    mainNav("", false);
    const cats =
      p.kind === "public" ? ["자유", "스터디", "공용물품"] : ["건의", "문의"];
    return `<form id="post-form" data-id="${edit ? esc(id) : ""}" data-kind="${p.kind}" class="stack screen-enter"><span class="chip">${p.kind === "public" ? "일반 익명글" : "운영진 문의"}</span><div class="form-field"><label for="post-category">${p.kind === "public" ? "분류" : "문의 유형"}</label><select id="post-category" name="category">${cats.map((c) => `<option ${c === p.category ? "selected" : ""}>${c}</option>`).join("")}</select></div><div class="form-field"><label for="post-title">제목</label><input id="post-title" name="title" value="${esc(p.title)}" maxlength="60" placeholder="제목을 입력해주세요" required></div><div class="form-field"><label for="post-body">내용</label><textarea id="post-body" name="body" maxlength="2000" rows="9" placeholder="전하고 싶은 이야기를 적어주세요" required>${esc(p.body)}</textarea><span class="field-hint" id="character-count">${p.body.length} / 2,000</span></div><div class="notice">${icon(p.kind === "inquiry" ? "lock" : "chat")}<span>${p.kind === "inquiry" ? "작성자와 운영진만 보는 문의 화면이에요." : "일반 글은 동아리 회원에게 익명으로 공개돼요."}</span></div><p class="form-error" id="post-error" role="alert"></p><button class="primary-button" type="submit">${edit ? "수정 내용 저장" : p.kind === "public" ? "익명으로 등록하기" : "익명으로 문의 보내기"}</button></form>`;
  }
  function postDetail(id) {
    const p = state.posts.find((p) => p.id === id);
    if (!p) return notFound();
    appHeader(p.kind === "inquiry" ? "내 문의 상세" : "글 상세", "board");
    mainNav("", false);
    return `<article class="stack screen-enter"><div class="post-card-top"><span class="category-label">${p.category}</span>${p.kind === "inquiry" ? `<span class="status-pill ${p.status === "answered" ? "quiet" : "normal"}">${p.status === "answered" ? "답변 완료" : "접수"}</span>` : ""}</div><h2 class="detail-title">${esc(p.title)}</h2><p class="detail-meta">익명 · ${relative(p.createdAt)}${p.owner === "me" ? " · 내 글" : ""}</p><div class="detail-body post-body">${esc(p.body)}</div>${p.owner === "me" ? `<div class="button-row"><button class="text-button" data-action="go" data-route="post/edit/${p.id}">수정</button><button class="text-button danger-text" data-action="delete-post" data-id="${p.id}">삭제</button></div>` : ""}<hr><h3 class="section-title">${p.kind === "inquiry" ? "운영진 답변" : "댓글"} <span>${p.comments.length}</span></h3><div class="comment-list">${p.comments.length ? p.comments.map((c) => `<div class="comment"><div class="post-meta"><strong>${c.owner === "admin" ? "SAI 운영진" : c.owner === "me" ? "익명 (나)" : "익명"}</strong><span>${relative(c.createdAt)}</span></div><p>${esc(c.body)}</p></div>`).join("") : `<p class="muted">${p.kind === "inquiry" ? "문의가 접수되었어요. 답변을 기다려주세요." : "첫 댓글을 남겨보세요."}</p>`}</div>${p.kind === "public" ? `<form class="comment-form" id="comment-form" data-id="${p.id}"><label class="sr-only" for="comment-body">익명 댓글</label><textarea id="comment-body" name="body" rows="2" maxlength="500" placeholder="따뜻한 댓글을 남겨주세요" required></textarea><button class="primary-button" type="submit">등록</button><p class="form-error" id="comment-error" role="alert"></p></form>` : `<p class="helper">데모에서는 미리 준비한 운영진 답변을 확인할 수 있어요.</p>`}</article>`;
  }
  function custom() {
    if (!draftCustom)
      draftCustom = {
        theme: state.settings.theme,
        gauge: state.settings.gauge,
      };
    appHeader("나만의 화면", "home");
    mainNav("custom");
    const g = [
        ["basic", "기본"],
        ["water", "물"],
        ["lava", "마그마"],
      ],
      themes = [
        ["light", "SAI 라이트"],
        ["dark", "SAI 다크"],
        ["blue", "블루"],
      ];
    return `<div class="stack screen-enter"><section><h2 class="section-title">게이지 디자인</h2><div class="option-grid">${g.map(([k, l]) => `<button class="design-option ${draftCustom.gauge === k ? "active" : ""}" data-action="gauge-choice" data-value="${k}" aria-pressed="${draftCustom.gauge === k}">${gauge(k, state.settings.occupancy, true)}<span>${l}</span>${draftCustom.gauge === k ? `<span class="option-check">${icon("check")}</span>` : ""}</button>`).join("")}</div></section><section><h2 class="section-title">앱 전체 테마</h2><div class="option-grid">${themes.map(([k, l]) => `<button class="design-option ${draftCustom.theme === k ? "active" : ""}" data-action="theme-choice" data-value="${k}" aria-pressed="${draftCustom.theme === k}"><span class="theme-swatch ${k}"><i></i><i></i></span><span>${l}</span></button>`).join("")}</div></section><section><h2 class="section-title">홈 미리보기</h2><div class="preview-card" data-theme="${draftCustom.theme}"><img class="preview-logo" src="assets/sai-logo.png" alt="SAI"><p>지금, 동아리방</p>${gauge(draftCustom.gauge, state.settings.occupancy, true)}<strong class="preview-count">${state.settings.occupancy}명</strong><span class="helper">같은 인원, 다른 분위기</span></div></section><button class="primary-button" data-action="apply-custom">선택한 디자인 적용 ${icon("check")}</button><p class="helper">내 앱의 화면만 바뀌어요</p></div>`;
  }
  function settings() {
    appHeader("설정", "home");
    mainNav("", false);
    return `<div class="stack screen-enter"><div class="profile-card"><span class="profile-avatar">${icon("person")}</span><div><h2>${authUser ? esc(authUser.name) : "게스트"}</h2><p class="muted">${authUser ? (authUser.role === "admin" ? "SAI 운영진" : "SAI 회원") : "로그인이 필요합니다"}</p></div></div><section class="settings-group"><h2 class="section-title">계정</h2>${authUser ? `<p class="muted">${esc(authUser.student_id)} · ${esc(authUser.username)}</p>${authUser.role === "admin" ? `<button class="secondary-button" data-action="go" data-route="admin">회원 승인 관리</button>` : ""}<button class="secondary-button" data-action="logout">로그아웃</button>` : `<button class="primary-button" data-action="go" data-route="login">로그인</button><button class="secondary-button" data-action="go" data-route="signup">회원가입</button>`}</section><section class="settings-group"><h2 class="section-title">화면과 내 상태</h2><button class="settings-row full-row" data-action="go" data-route="custom"><span>화면 디자인 바꾸기</span>${icon("next")}</button><label class="settings-row"><span>내 감지 상태 <small>화면 표시용 예시</small></span><input class="switch" id="detecting-toggle" type="checkbox" ${state.settings.detecting ? "checked" : ""} role="switch" aria-label="감지 중 표시"></label><p class="helper left">현재 인원은 별도의 예시 데이터예요.</p></section><section class="settings-group"><h2 class="section-title">게이지 체험</h2><label class="settings-row" for="demo-occupancy"><span>예시 인원수</span><strong class="range-value" id="range-value">${state.settings.occupancy}명</strong></label><input id="demo-occupancy" type="range" min="0" max="30" step="1" value="${state.settings.occupancy}" aria-valuetext="${state.settings.occupancy}명"><div id="settings-gauge">${gauge()}</div><p class="helper left">게이지 기준은 15명이며, 인원이 늘어도 최대 채움은 100%예요.</p><button class="secondary-button" data-action="go" data-route="home">홈에서 확인하기</button></section><section class="settings-group"><h2 class="section-title">데모 데이터</h2><p class="muted">예약은 서버에 저장됩니다. 자유게시판은 서버에 저장되고 운영진 문의와 화면 설정은 이 브라우저에 저장됩니다. 로그인은 연결되었지만 예약·게시판의 회원별 권한 적용과 비콘 기능은 아직 연결되지 않았어요.</p><button class="danger-button" data-action="reset">예시 데이터로 초기화</button></section><p class="helper">SAI ROOM · Frontend prototype v1.0</p></div>`;
  }
  function notFound() {
    appHeader("화면을 찾을 수 없어요", "home");
    mainNav("", false);
    return '<div class="empty-state">삭제되었거나 없는 항목이에요.</div><button class="primary-button" data-action="go" data-route="home">홈으로 돌아가기</button>';
  }
  function render() {
    cancelAnimationFrame(occupancyFrame);
    const route = decodeURI(location.hash.slice(1) || "home");
    if (route !== "custom") draftCustom = null;
    document.body.dataset.theme = state.settings.theme;
    const parts = route.split("/");
    let html;
    if (route === "home") html = home();
    else if (route === "reservations") html = reservations();
    else if (route === "reservation/new") html = bookingForm();
    else if (parts[0] === "reservation" && parts[1] === "edit")
      html = bookingForm(parts[2]);
    else if (parts[0] === "reservation") html = bookingDetail(parts[1]);
    else if (route === "board") html = board();
    else if (route === "post/new") html = postForm();
    else if (parts[0] === "post" && parts[1] === "edit")
      html = postForm(parts[2]);
    else if (parts[0] === "post") html = postDetail(parts[1]);
    else if (route === "custom") html = custom();
    else if (route === "settings") html = settings();
    else if (route === "login") html = authForm("login");
    else if (route === "signup") html = authForm("signup");
    else if (route === "admin" && authUser?.role === "admin") html = adminPanel();
    else html = notFound();
    const changed = route !== currentRoute;
    view.innerHTML = html;
    view.scrollTop = 0;
    currentRoute = route;
    document.title = `${header.querySelector("h1").textContent} · SAI ROOM`;
    if (changed) view.focus({ preventScroll: true });
    if (route === "admin") loadPending();
    if (route === "reservations")
      $(".timetable").scrollTop = Math.max(
        0,
        ((selectedSlot.start - 540) / 30) * 32 - 210,
      );
    if (
      route === "home" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const el = $("#live-count"),
        n = state.settings.occupancy,
        start = performance.now();
      function tick(t) {
        const ratio = Math.min(1, (t - start) / 500);
        el.textContent = Math.round(n * (1 - Math.pow(1 - ratio, 3)));
        if (ratio < 1) occupancyFrame = requestAnimationFrame(tick);
      }
      occupancyFrame = requestAnimationFrame(tick);
    }
  }
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
    if (action === "go") {
      go(btn.dataset.route);
      if (btn.dataset.route === "reservations") await loadReservations();
      if (btn.dataset.route === "board") await loadPosts();
    }
    else if (action === "logout") {
      try { await apiRequest("/auth/logout", { method: "POST" }); }
      catch (err) { console.warn("로그아웃 요청 실패:", err.message); }
      authToken = "";
      authUser = null;
      sessionStorage.removeItem(authTokenKey);
      toast("로그아웃했어요.");
      go("settings");
    } else if (action === "approve-user" || action === "reject-user") {
      if (authUser?.role !== "admin") return;
      const approve = action === "approve-user";
      if (!approve && !(await confirmAction("가입을 거절할까요?", "해당 회원의 가입 신청을 거절합니다.", "거절"))) return;
      btn.disabled = true;
      try {
        await apiRequest(`/auth/users/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`, { method: "POST" });
        toast(approve ? "회원 가입을 승인했어요." : "가입 신청을 거절했어요.");
        await loadPending();
      } catch (err) { toast(`처리 실패: ${err.message}`); btn.disabled = false; }
    }
    else if (action === "refresh") {
      btn.classList.add("spinning");
      toast("예시 인원 정보를 새로 확인했어요");
      setTimeout(() => btn.classList.remove("spinning"), 500);
    } else if (action === "date-prev" || action === "date-next") {
      selectedDate = addDay(selectedDate, action === "date-prev" ? -1 : 1);
      selectedSlot = { date: selectedDate, start: 1200, end: 1260 };
      render();
    } else if (action === "slot") {
      const start = Number(btn.dataset.start),
        slot = {
          date: btn.dataset.date,
          start,
          end: Math.min(start + 60, 1380),
        };
      const conflict = overlapping(slot);
      if (conflict) {
        slot.end = start + 30;
        if (overlapping(slot)) {
          toast("이미 예약된 시간이에요");
          return;
        }
      }
      selectedSlot = slot;
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
        try {
          await apiRequest(`/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
          ownedIds.delete(String(id));
          localStorage.setItem(ownedIdsKey, JSON.stringify([...ownedIds]));
          toast("예약을 취소했어요");
          go("reservations");
          await loadReservations();
        } catch (err) { toast(`예약 취소 실패: ${err.message}`); }
      }
    } else if (action === "board-kind") {
      boardKind = value;
      boardFilter = "전체";
      render();
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
        if (p.kind === "public") {
          try {
            await apiRequest(`/posts/${encodeURIComponent(id)}`, {
              method: "DELETE", headers: {"X-Post-Token": postTokens[id] || ""}
            });
            delete postTokens[id]; savePostTokens();
            await loadPosts(); toast("글을 삭제했어요"); go("board");
          } catch (err) { toast(`글 삭제 실패: ${err.message}`); }
        } else {
          state.posts = state.posts.filter((p) => p.id !== id);
          save("글을 삭제했어요"); go("board");
        }
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
      state.settings = { ...state.settings, ...draftCustom };
      save("새로운 디자인을 적용했어요");
      go("home");
    } else if (
      action === "reset" &&
      (await confirmAction(
        "예시 데이터로 되돌릴까요?",
        "이 브라우저의 글, 댓글과 화면 설정이 초기화됩니다. 서버 예약은 삭제되지 않습니다.",
        "초기화",
      ))
    ) {
      state = SaiData.seed();
      state.posts = state.posts.filter(p => p.kind === "inquiry");
      state.bookings = []; // 서버 예약은 데모 초기화로 삭제하지 않습니다.
      selectedDate = SaiData.day();
      selectedSlot = { date: selectedDate, start: 1200, end: 1260 };
      boardKind = "public";
      boardFilter = "전체";
      save("예시 데이터로 초기화했어요");
      go("home");
    }
  });
  document.addEventListener("input", (e) => {
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
    if (e.target.id === "demo-occupancy") {
      state.settings.occupancy = Number(e.target.value);
      $("#range-value").textContent = `${state.settings.occupancy}명`;
      e.target.setAttribute("aria-valuetext", `${state.settings.occupancy}명`);
      $("#settings-gauge").innerHTML = gauge();
      save();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "calendar-date" && e.target.value) {
      selectedDate = e.target.value;
      selectedSlot = { date: selectedDate, start: 1200, end: 1260 };
      render();
    }
    if (e.target.id === "detecting-toggle") {
      state.settings.detecting = e.target.checked;
      save("감지 상태 표시를 변경했어요");
    }
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (!["booking-form", "post-form", "comment-form", "auth-form"].includes(f.id)) return;
    e.preventDefault();
    const d = new FormData(f);
    if (f.id === "auth-form") {
      const mode = f.dataset.mode;
      const payload = { username: String(d.get("username")).trim(), password: String(d.get("password")) };
      if (mode === "signup") { payload.name = String(d.get("name")).trim(); payload.student_id = String(d.get("student_id")).trim(); }
      const button = f.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const result = await apiRequest(mode === "signup" ? "/auth/signup" : "/auth/login", { method: "POST", body: JSON.stringify(payload) });
        if (mode === "signup") { toast("가입 신청 완료! 운영진 승인을 기다려주세요."); go("login"); }
        else { authToken = result.access_token; sessionStorage.setItem(authTokenKey, authToken); authUser = result.user; toast("로그인했습니다."); go("settings"); }
      } catch (err) { const el = $("#auth-error"); if (el) el.textContent = err.message; }
      finally { button.disabled = false; }
    } else if (f.id === "booking-form") {
      const b = {
        id: f.dataset.id || uid(),
        owner: "me",
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
      const editing = Boolean(f.dataset.id);
      const payload = {
        date: b.date, start: b.start, end: b.end,
        purpose: b.purpose, name: b.name, people: b.people,
      };
      const submitButton = f.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const result = await apiRequest(
          editing ? `/reservations/${encodeURIComponent(f.dataset.id)}` : "/reservations",
          { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) },
        );
        const createdId = result?.id ?? result?.reservation_id ?? result?.reservation?.id;
        if (editing) rememberOwned(f.dataset.id);
        else if (createdId != null) rememberOwned(createdId);
        selectedDate = b.date;
        selectedSlot = { date: b.date, start: Math.min(b.end, 1350), end: Math.min(b.end + 60, 1380) };
        toast(editing ? "예약을 수정했어요" : "예약을 저장했어요");
        go("reservations");
        await loadReservations();
      } catch (err) {
        $("#booking-error").textContent = err.message;
      } finally { submitButton.disabled = false; }
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
      if (f.dataset.kind === "public") {
        const editing = Boolean(existing);
        const submitButton = f.querySelector('[type="submit"]');
        submitButton.disabled = true;
        try {
          const payload = {category: d.get("category"), title, body};
          const result = await apiRequest(editing ? `/posts/${encodeURIComponent(existing.id)}` : "/posts", {
            method: editing ? "PUT" : "POST",
            headers: editing ? {"X-Post-Token": postTokens[existing.id] || ""} : {},
            body: JSON.stringify(payload)
          });
          if (!editing) { postTokens[result.id] = result.edit_token; savePostTokens(); }
          boardKind = "public"; boardFilter = "전체";
          await loadPosts();
          toast(editing ? "글을 수정했어요" : "익명 글을 등록했어요");
          go(editing ? `post/${existing.id}` : "board");
        } catch (err) { $("#post-error").textContent = err.message; }
        finally { submitButton.disabled = false; }
      } else if (existing) {
        existing.title = title; existing.body = body;
        existing.category = d.get("category");
        save("글을 수정했어요"); go(`post/${existing.id}`);
      } else {
        const p = {id: uid(), kind: "inquiry", category: d.get("category"),
          title, body, owner: "me", createdAt: Date.now(), comments: [], status: "received"};
        state.posts.push(p); boardKind = "inquiry"; boardFilter = "전체";
        save("문의를 접수했어요"); go("board");
      }
    } else if (f.id === "comment-form") {
      const p = state.posts.find((p) => p.id === f.dataset.id),
        body = d.get("body").trim();
      if (!body) {
        $("#comment-error").textContent = "댓글 내용을 입력해주세요.";
        return;
      }
      if (!p || p.kind !== "public") return;
      const submitButton = f.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        await apiRequest(`/posts/${encodeURIComponent(p.id)}/comments`, {
          method: "POST", body: JSON.stringify({body})
        });
        await loadPosts(); toast("댓글을 등록했어요");
        $(".comment-form")?.scrollIntoView({ block: "end" });
      } catch (err) { $("#comment-error").textContent = err.message; }
      finally { submitButton.disabled = false; }
    }
  });
  window.addEventListener("hashchange", render);
  // 로컬 데모 예약 대신 서버의 실제 예약을 표시합니다.
  state.bookings = [];
  render();
  // 브라우저에 남아 있던 자유게시판 예시 글은 서버 게시글로 대체합니다.
  state.posts = state.posts.filter(p => p.kind === "inquiry");
  loadReservations();
  loadPosts();
  refreshAuth();
  if (!SaiData.persisted)
    toast("이 브라우저에서는 새로고침 후 데이터가 유지되지 않을 수 있어요.");
})();
