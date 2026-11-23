/* Room-beacon detection on the member's phone.
 *
 * Layers:
 *   1. createTracker  – pure enter/stay/exit decision (debounce, hysteresis, heartbeat timing). Unit-tested.
 *   2. drivers        – where RSSI readings come from. All drivers share one interface:
 *                         { id, status() -> {bluetooth, permission}, requestPermissions(),
 *                           start(beaconConfig, onReading, onState), stop() }
 *                       "native"    : Capacitor plugin `SaiBeacon` (real BLE; only exists inside the SAI mobile app)
 *                       "simulator" : synthetic readings, only when the SERVER says simulatorAllowed (never in production)
 *                       none        : plain browser – automatic detection is NOT available
 *   3. SaiBeacon      – controller: loads server config, runs the tracker, reports to the backend, exposes status.
 *
 * A plain browser cannot scan iBeacon advertisements, and mobile browsers do not run pages in the background,
 * so this module never pretends otherwise. The server decides who is "present"; this only reports readings.
 */
(function () {
  'use strict';

  const median = list => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /* ---------- 1. pure decision logic ---------- */
  function createTracker(options) {
    const cfg = Object.assign({
      enterRssi: -75, exitRssi: -85,
      enterReadings: 2, enterWindowMs: 15000,   // need 2 strong readings within 15 s to enter
      exitTimeoutMs: 90000,                      // no acceptable reading for this long => exit (stays below the server grace)
      reportIntervalMs: 30000, smoothing: 5, smoothingWindowMs: 10000
    }, options);
    let state = 'outside', strong = [], recent = [], lastGoodAt = 0, lastReportAt = 0, goodSinceReport = false;

    const smoothed = t => {
      recent = recent.filter(r => t - r.t <= cfg.smoothingWindowMs).slice(-cfg.smoothing);
      return recent.length ? Math.round(median(recent.map(r => r.rssi))) : null;
    };
    function push(rssi, t) {
      const events = [];
      recent.push({ rssi, t });
      if (state === 'outside') {
        strong = strong.filter(r => t - r.t <= cfg.enterWindowMs);
        if (rssi >= cfg.enterRssi) strong.push({ t });
        if (strong.length >= cfg.enterReadings) {
          state = 'inside'; strong = []; lastGoodAt = t; lastReportAt = t; goodSinceReport = false;
          events.push({ type: 'enter', rssi: smoothed(t) });
        }
      } else if (rssi >= cfg.exitRssi) {
        lastGoodAt = t; goodSinceReport = true;
      }
      return events;
    }
    function tick(t) {
      if (state !== 'inside') return [];
      if (t - lastGoodAt >= cfg.exitTimeoutMs) { state = 'outside'; strong = []; recent = []; return [{ type: 'exit' }]; }
      // Heartbeat only if a usable reading arrived since the last report: silence must not refresh the server.
      if (t - lastReportAt >= cfg.reportIntervalMs && goodSinceReport) {
        const rssi = smoothed(t);
        if (rssi == null) return [];  // last reading is too old to vouch for: report nothing rather than guess
        lastReportAt = t; goodSinceReport = false;
        return [{ type: 'heartbeat', rssi }];
      }
      return [];
    }
    // A report failed: retry soon with the next REAL reading, never with an invented one.
    function markUnsent(t, retryMs = 5000) { if (state === 'inside') { goodSinceReport = true; lastReportAt = t - cfg.reportIntervalMs + retryMs; } }
    function reset() { const was = state; state = 'outside'; strong = []; recent = []; return was === 'inside' ? [{ type: 'exit' }] : []; }
    return { push, tick, reset, markUnsent, get state() { return state; }, get config() { return cfg; } };
  }

  /* ---------- 2. drivers ---------- */
  function nativeDriver() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable('SaiBeacon')) return null;
    const plugin = (cap.Plugins && cap.Plugins.SaiBeacon) || (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('SaiBeacon') : null);
    if (!plugin) return null;
    let handles = [];
    return {
      id: 'native',
      status: () => plugin.checkStatus(),
      requestPermissions: () => plugin.requestAccess(),
      async start(beacon, onReading, onState) {
        handles = [await plugin.addListener('reading', r => onReading(r.rssi, Date.now())), await plugin.addListener('state', onState)];
        await plugin.start({ uuid: beacon.uuid, major: beacon.major, minor: beacon.minor });
      },
      async stop() { await plugin.stop().catch(() => {}); handles.forEach(h => h && h.remove && h.remove()); handles = []; }
    };
  }

  const SIM_LEVELS = { strong: -60, edge: -80, weak: -95, lost: null };
  function simulatorDriver() {
    let timer = null, mode = 'off';
    return {
      id: 'simulator',
      get mode() { return mode; },
      setMode(next) { if (next in SIM_LEVELS || next === 'off') mode = next; },
      status: async () => ({ bluetooth: 'on', permission: 'granted' }),
      requestPermissions: async () => ({ permission: 'granted' }),
      async start(_beacon, onReading) {
        clearInterval(timer);
        timer = setInterval(() => { const rssi = SIM_LEVELS[mode]; if (rssi != null) onReading(rssi, Date.now()); }, 1000);
      },
      async stop() { clearInterval(timer); timer = null; mode = 'off'; }
    };
  }

  /* ---------- 3. controller ---------- */
  const STORE_KEY = 'sai.beacon.enabled', DEVICE_KEY = 'sai.beacon.device';
  const TEXT = {
    'off': '자동 감지가 꺼져 있습니다.',
    'starting': '자동 감지를 준비하고 있습니다.',
    'scanning': '동방 신호를 찾는 중입니다.',
    'inside': '동방 신호를 감지했습니다.',
    'weak': '신호가 약해 아직 동방으로 인식하지 못했습니다.',
    'unsupported': '이 환경에서는 자동 감지를 사용할 수 없습니다. SAI 모바일 앱에서 사용할 수 있습니다.',
    'not-configured': '운영진이 동방 비콘을 아직 등록하지 않았거나 자동 감지를 켜지 않았습니다.',
    'bluetooth-off': '블루투스가 꺼져 있습니다. 켜면 다시 감지합니다.',
    'permission-denied': '위치·근처 기기 권한이 필요합니다. 설정에서 허용해주세요.',
    'server-error': '서버에 감지 상태를 전달하지 못했습니다. 연결을 확인하고 있습니다.',
    'scan-error': '휴대폰이 신호 검색을 멈췄습니다. 잠시 후 다시 시도합니다.'
  };

  function createController(deps) {
    const { backend, storage, clock, schedule, cancel, makeNative, makeSimulator, doc, win } = deps;
    const listeners = new Set();
    let recovery = null, driver = null, tracker = null, beacon = null, timer = null, running = false, sending = false, pending = null, run = 0;
    let status = { code: 'off', text: TEXT.off, inside: false, lastReportAt: null, simulatorAllowed: false, driver: null };

    const deviceId = () => {
      let id = null; try { id = storage.getItem(DEVICE_KEY); } catch (e) { /* storage may be blocked */ }
      if (!id) { id = 'app-' + Math.random().toString(36).slice(2, 12); try { storage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ } }
      return id;
    };
    const emit = patch => { status = Object.assign({}, status, patch); if (patch.code) status.text = patch.text || TEXT[patch.code] || ''; listeners.forEach(fn => fn(status)); };
    const remember = on => { try { on ? storage.setItem(STORE_KEY, '1') : storage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } };

    async function send(event) {
      // One request at a time; if more arrive meanwhile, only the latest matters.
      if (sending) { pending = event; return; }
      sending = true;
      try {
        const body = event.type === 'exit'
          ? { state: 'outside', deviceId: deviceId() }
          : { state: 'inside', rssi: event.rssi, uuid: beacon.uuid, major: beacon.major, minor: beacon.minor, deviceId: deviceId() };
        if (driver && driver.id === 'simulator') body.source = 'simulator';
        const reply = await backend.reportBeacon(body);
        if (event.type === 'exit') emit(Object.assign({ inside: false, lastReportAt: clock() }, running ? { code: 'scanning' } : {}));
        else if (reply.accepted) emit({ code: 'inside', inside: true, lastReportAt: clock() });
        else { tracker && tracker.reset(); emit({ code: 'weak', inside: false }); } // server did not accept it: start over cleanly
      } catch (error) {
        // Never fake success. Keep the real state and retry with the next real reading.
        if (error && error.status === 401) { stop({ report: false }); return; }
        if (error && ['BEACON_DISABLED', 'BEACON_NOT_CONFIGURED'].includes(error.code)) { stop({ report: false }).then(() => emit({ code: 'not-configured' })); return; }
        emit({ code: 'server-error', text: (error && error.message) || TEXT['server-error'] });
        if (event.type === 'exit') pending = null; else if (tracker) tracker.markUnsent(clock());
      } finally {
        sending = false;
        const next = pending; pending = null;
        if (next && running) send(next);
      }
    }
    const apply = events => events.forEach(send);

    function onReading(rssi, t) { if (running && tracker && Number.isFinite(rssi)) apply(tracker.push(rssi, t)); }
    function onDriverState(next) {
      if (!running) return;
      if (next && next.bluetooth === 'off') goIdle('bluetooth-off');
      else if (next && ['denied', 'restricted'].includes(next.permission)) goIdle('permission-denied');
      else if (next && next.error) goIdle('scan-error');
    }
    function goIdle(code) {
      // Bluetooth off / permission revoked: scanning has effectively stopped, so leave the room.
      const events = tracker ? tracker.reset() : [];
      running = false; cancel(timer); timer = null;
      if (driver) driver.stop();
      events.forEach(e => { pending = null; sending = false; send(e); });
      emit({ code, inside: false });
      watchForRecovery();
    }
    // While idle for a recoverable reason, check the phone every 5 s (only while the app is visible) and
    // resume by itself once Bluetooth/permission are back. Never prompts the user.
    function watchForRecovery() {
      cancel(recovery);
      recovery = schedule(async () => {
        if (running || !api.wasEnabled() || !['bluetooth-off', 'permission-denied', 'scan-error'].includes(status.code)) { cancel(recovery); recovery = null; return; }
        if (doc && doc.hidden) return;
        const probe = driver || makeNative();
        if (!probe) return;
        try {
          const st = await probe.status();
          if (st.bluetooth !== 'off' && st.permission === 'granted') { cancel(recovery); recovery = null; start({ userInitiated: false }); }
        } catch (e) { /* try again next tick */ }
      }, 5000);
    }

    async function load() {
      const cfg = await backend.beaconConfig();
      emit({ simulatorAllowed: cfg.simulatorAllowed === true, config: cfg });
      return cfg;
    }

    async function start({ userInitiated = false } = {}) {
      if (running) return status;
      const my = ++run;
      emit({ code: 'starting' });
      let cfg;
      try { cfg = await load(); } catch (e) { emit({ code: 'server-error', text: e.message || TEXT['server-error'] }); return status; }
      if (my !== run) return status;
      if (!cfg.enabled || !cfg.configured) { emit({ code: 'not-configured' }); return status; }
      driver = makeNative() || (cfg.simulatorAllowed && status.useSimulator ? makeSimulator() : null);
      if (!driver) { emit({ code: 'unsupported', driver: null }); return status; }
      let st = await driver.status();
      if (st.bluetooth === 'unsupported') { emit({ code: 'unsupported', driver: null }); return status; }
      if (st.bluetooth === 'off') { emit({ code: 'bluetooth-off', driver: driver.id }); if (!userInitiated || api.wasEnabled()) { remember(true); watchForRecovery(); } return status; }
      if (st.permission !== 'granted') {
        if (!userInitiated) { emit({ code: 'permission-denied', driver: driver.id }); return status; }
        st = Object.assign({}, st, await driver.requestPermissions());
        if (st.permission !== 'granted') { emit({ code: 'permission-denied', driver: driver.id }); return status; }
      }
      if (my !== run) return status;
      beacon = { uuid: cfg.uuid, major: cfg.major, minor: cfg.minor };
      const graceMs = cfg.exitGraceSeconds * 1000, intervalMs = cfg.reportIntervalSeconds * 1000;
      tracker = createTracker({
        enterRssi: cfg.enterRssi, exitRssi: cfg.exitRssi, reportIntervalMs: intervalMs,
        // Leave on our own before the server would drop us, so both sides agree.
        exitTimeoutMs: Math.max(intervalMs * 2, graceMs - intervalMs)
      });
      running = true; remember(true); cancel(recovery); recovery = null;
      try { await driver.start(beacon, onReading, onDriverState); }
      catch (e) { running = false; emit({ code: e && e.code === 'BLUETOOTH_OFF' ? 'bluetooth-off' : e && e.code === 'PERMISSION_DENIED' ? 'permission-denied' : 'scan-error' }); watchForRecovery(); return status; }
      timer = schedule(() => apply(tracker.tick(clock())), 1000);
      emit({ code: 'scanning', driver: driver.id });
      return status;
    }

    async function stop({ report = true } = {}) {
      run++;
      const events = report && tracker ? tracker.reset() : [];
      running = false; cancel(timer); timer = null; cancel(recovery); recovery = null; remember(false);
      if (driver) await driver.stop();
      if (events.length) { pending = null; sending = false; for (const e of events) await send(e); }
      tracker = null; emit({ code: 'off', inside: false });
    }

    // Returning to the app / regaining network: re-check the platform state and report right away.
    function resume() {
      if (!running) {
        // Bluetooth turned back on or permission granted in Settings: pick up again without prompting.
        if (['bluetooth-off', 'permission-denied'].includes(status.code) && api.wasEnabled()) start({ userInitiated: false });
        return;
      }
      driver.status().then(st => {
        if (st.bluetooth === 'off') goIdle('bluetooth-off');
        else if (st.permission !== 'granted') goIdle('permission-denied');
        else { if (status.code === 'server-error' && tracker) tracker.markUnsent(clock(), 0); apply(tracker.tick(clock())); }
      }).catch(() => {});
    }
    if (doc) doc.addEventListener('visibilitychange', () => { if (!doc.hidden) resume(); });
    if (win) { win.addEventListener('online', resume); win.addEventListener('sai:session-expired', () => { if (running) stop({ report: false }); }); }

    const api = {
      subscribe(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); },
      get status() { return status; },
      load, start, stop, resume,
      get running() { return running; },
      wasEnabled() { try { return storage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } },
      // Resume after an app restart, only if the member had turned it on. Never prompts for permissions by itself.
      async restore() { if (api.wasEnabled()) return start({ userInitiated: false }); },
      useSimulator(on) { emit({ useSimulator: !!on }); },
      reset() { emit({ config: undefined, simulatorAllowed: false, useSimulator: false, lastReportAt: null }); },
      get simulator() { return driver && driver.id === 'simulator' ? driver : null; }
    };
    return api;
  }

  window.SaiBeaconCore = { createTracker, createController, simulatorDriver, nativeDriver, TEXT };
  if (typeof window.SaiBackend !== 'undefined') {
    window.SaiBeacon = createController({
      backend: window.SaiBackend, storage: window.localStorage, clock: () => Date.now(),
      schedule: (fn, ms) => setInterval(fn, ms), cancel: id => clearInterval(id),
      makeNative: nativeDriver, makeSimulator: simulatorDriver, doc: document, win: window
    });
  }
})();
