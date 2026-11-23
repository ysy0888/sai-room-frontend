const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the browser module in isolation. SaiBackend is absent, so only SaiBeaconCore is exported.
// Values created inside the vm context are compared by property, not deepEqual (different realm).
const ctx = { Date, Math, Number, Set, setInterval, clearInterval, console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/beacon.js'), 'utf8'), ctx);
const { createTracker, createController, simulatorDriver, nativeDriver } = ctx.SaiBeaconCore;

const S = 1000;

test('a single strong spike does not enter; two strong readings do', () => {
  const t = createTracker({});
  assert.equal(t.push(-60, 0).length, 0);
  assert.equal(t.state, 'outside');
  assert.equal(t.push(-62, 2 * S)[0].type, 'enter');
  assert.equal(t.state, 'inside');
});

test('strong readings that are too far apart do not add up to an entry', () => {
  const t = createTracker({ enterWindowMs: 15 * S });
  t.push(-60, 0);
  assert.equal(t.push(-60, 20 * S).length, 0);
  assert.equal(t.state, 'outside');
});

test('weak readings between exit and enter thresholds cannot enter', () => {
  const t = createTracker({ enterRssi: -75, exitRssi: -85 });
  for (let i = 0; i < 10; i++) assert.equal(t.push(-80, i * S).length, 0);
  assert.equal(t.state, 'outside');
});

test('a short dropout does not exit; a long one does, and exit is reported once', () => {
  const t = createTracker({ exitTimeoutMs: 90 * S });
  t.push(-60, 0); t.push(-60, S);
  assert.equal(t.tick(60 * S).length, 0);          // 59 s of silence: still inside
  assert.equal(t.push(-65, 61 * S).length, 0);     // signal returns: no phantom exit/enter
  assert.equal(t.state, 'inside');
  assert.equal(t.tick(61 * S + 90 * S)[0].type, 'exit');
  assert.equal(t.tick(61 * S + 91 * S).length, 0); // not reported twice
});

test('staying inside only needs the weaker exit threshold', () => {
  const t = createTracker({ exitTimeoutMs: 90 * S, reportIntervalMs: 30 * S });
  t.push(-60, 0); t.push(-60, S);
  for (let i = 2; i < 100; i++) { t.push(-82, i * S); t.tick(i * S); }
  assert.equal(t.state, 'inside');
});

test('heartbeats are sent on schedule only while real readings keep arriving', () => {
  const t = createTracker({ reportIntervalMs: 30 * S, exitTimeoutMs: 90 * S });
  t.push(-60, 0); t.push(-60, S);
  t.push(-60, 25 * S);
  assert.equal(t.tick(29 * S).length, 0);
  const beat = t.tick(31 * S);
  assert.equal(beat[0].type, 'heartbeat'); assert.equal(beat[0].rssi, -60);
  assert.equal(t.tick(62 * S).length, 0);          // silence: no heartbeat is fabricated
});

test('a stale last reading never produces a heartbeat (no null/invented rssi)', () => {
  const t = createTracker({ reportIntervalMs: 30 * S, exitTimeoutMs: 90 * S });
  t.push(-60, 0); t.push(-60, S);
  t.push(-60, 15 * S);                             // 16 s old at tick time > 10 s smoothing window
  assert.equal(t.tick(31 * S).length, 0);
  t.push(-61, 32 * S);                             // a fresh reading unlocks it
  assert.equal(t.tick(33 * S)[0].rssi, -61);
});

test('heartbeat rssi is smoothed so one outlier does not decide', () => {
  const t = createTracker({ reportIntervalMs: 30 * S });
  t.push(-60, 0); t.push(-60, S);
  for (const [v, at] of [[-61, 25 * S], [-120, 26 * S], [-62, 27 * S], [-63, 28 * S], [-60, 29 * S]]) t.push(v, at);
  assert.ok(t.tick(31 * S)[0].rssi >= -63);
});

test('a failed report is retried soon with the next real reading', () => {
  const t = createTracker({ reportIntervalMs: 30 * S, exitTimeoutMs: 90 * S });
  t.push(-60, 0); t.push(-60, S);
  t.push(-60, 30 * S); t.tick(31 * S);             // heartbeat sent
  t.push(-60, 32 * S);
  t.markUnsent(32 * S, 5 * S);
  assert.equal(t.tick(34 * S).length, 0);
  assert.equal(t.tick(37 * S)[0].type, 'heartbeat');
});

test('plain browser has no native driver', () => {
  assert.equal(nativeDriver(), null);
});

/* ---------------- controller with fakes ---------------- */
function rig({ config, driver, backendOverrides = {}, storage = new Map() } = {}) {
  const reports = [];
  let now = 1_000_000, nextId = 1; const timers = new Map();
  const cfg = Object.assign({
    enabled: true, configured: true, uuid: '11111111-2222-3333-4444-555555555555', major: 1, minor: 1,
    enterRssi: -75, exitRssi: -85, reportIntervalSeconds: 30, exitGraceSeconds: 120, simulatorAllowed: false
  }, config);
  const backend = Object.assign({
    beaconConfig: async () => cfg,
    reportBeacon: async body => { reports.push(body); return { accepted: true, present: body.state === 'inside' }; }
  }, backendOverrides);
  let readingCb = null, stateCb = null, started = 0, stopped = 0;
  const fake = driver === null ? null : Object.assign({
    id: 'native',
    status: async () => ({ bluetooth: 'on', permission: 'granted' }),
    requestPermissions: async () => ({ permission: 'granted' }),
    start: async (_b, onReading, onState) => { started++; readingCb = onReading; stateCb = onState; },
    stop: async () => { stopped++; }
  }, driver);
  const c = createController({
    backend, clock: () => now, schedule: fn => { const id = nextId++; timers.set(id, fn); return id; }, cancel: id => { timers.delete(id); },
    storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    makeNative: () => fake, makeSimulator: () => simulatorDriver(), doc: null, win: null
  });
  return {
    c, reports, storage,
    reading: rssi => readingCb(rssi, now),
    advance: ms => { now += ms; [...timers.values()].forEach(fn => fn()); },
    get timers() { return timers.size; },
    flush: () => new Promise(setImmediate),
    state: obj => stateCb(obj),
    get started() { return started; }, get stopped() { return stopped; }
  };
}

test('controller reports entry once, heartbeats on schedule, and exit on stop', async () => {
  const r = rig();
  await r.c.start({ userInitiated: true });
  assert.equal(r.c.status.code, 'scanning');
  r.reading(-60); r.reading(-60); await r.flush();
  assert.equal(r.reports.length, 1);
  assert.equal(r.reports[0].state, 'inside');
  assert.equal(r.reports[0].uuid, '11111111-2222-3333-4444-555555555555');
  assert.ok(!('userId' in r.reports[0]), 'the client never sends a user id');
  assert.equal(r.c.status.code, 'inside');
  for (let i = 0; i < 5; i++) { r.advance(S); r.reading(-60); }
  assert.equal(r.reports.length, 1);               // not before the interval
  r.advance(30 * S); r.reading(-60); r.advance(S); await r.flush();
  assert.equal(r.reports.length, 2);
  await r.c.stop(); await r.flush();
  assert.equal(r.reports.at(-1).state, 'outside');
  assert.equal(r.c.status.code, 'off');
});

test('server failure is shown as an error, never as success, and recovers', async () => {
  let fail = true;
  const r = rig({ backendOverrides: { reportBeacon: async body => {
    r.reports.push(body);
    if (fail) { const e = new Error('연결을 확인한 후 다시 시도해주세요.'); e.status = 0; throw e; }
    return { accepted: true, present: true };
  } } });
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush();
  assert.equal(r.c.status.code, 'server-error');
  assert.equal(r.c.status.inside, false);
  fail = false;
  for (let i = 0; i < 8; i++) { r.advance(S); r.reading(-60); }
  await r.flush();
  assert.equal(r.c.status.code, 'inside');
});

test('bluetooth turned off while running leaves the room and says so', async () => {
  const r = rig();
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush();
  r.state({ bluetooth: 'off' }); await r.flush();
  assert.equal(r.reports.at(-1).state, 'outside');
  assert.equal(r.c.status.code, 'bluetooth-off');  // not overwritten by the exit report
  assert.equal(r.c.running, false);
  assert.equal(r.stopped, 1);
});

test('permission revoked while running leaves the room and explains why', async () => {
  const r = rig();
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush();
  r.state({ permission: 'denied' }); await r.flush();
  assert.equal(r.reports.at(-1).state, 'outside');
  assert.equal(r.c.status.code, 'permission-denied');
});

test('denied permission at start: no scanning, no reports', async () => {
  const r = rig({ driver: { status: async () => ({ bluetooth: 'on', permission: 'denied' }), requestPermissions: async () => ({ permission: 'denied' }) } });
  await r.c.start({ userInitiated: true });
  assert.equal(r.c.status.code, 'permission-denied');
  assert.equal(r.started, 0); assert.equal(r.reports.length, 0);
});

test('automatic restore never opens a permission prompt', async () => {
  let asked = 0;
  const storage = new Map([['sai.beacon.enabled', '1']]);
  const r = rig({ storage, driver: { status: async () => ({ bluetooth: 'on', permission: 'prompt' }), requestPermissions: async () => { asked++; return { permission: 'granted' }; } } });
  await r.c.restore();
  assert.equal(asked, 0); assert.equal(r.c.status.code, 'permission-denied');
});

test('plain browser without the native plugin reports unsupported honestly', async () => {
  const r = rig({ driver: null });
  await r.c.start({ userInitiated: true });
  assert.equal(r.c.status.code, 'unsupported'); assert.equal(r.reports.length, 0);
});

test('simulator is unavailable unless the server allows it AND the user opts in', async () => {
  const off = rig({ driver: null, config: { simulatorAllowed: false } });
  off.c.useSimulator(true); await off.c.start({ userInitiated: true });
  assert.equal(off.c.status.code, 'unsupported');

  const on = rig({ driver: null, config: { simulatorAllowed: true } });
  await on.c.start({ userInitiated: true });
  assert.equal(on.c.status.code, 'unsupported');   // allowed but not chosen
  on.c.useSimulator(true); await on.c.start({ userInitiated: true });
  assert.equal(on.c.status.code, 'scanning'); assert.equal(on.c.simulator.id, 'simulator');
  await on.c.stop({ report: false });
});

test('simulated reports are labelled so the server can refuse them in production', async () => {
  const r = rig({ driver: null, config: { simulatorAllowed: true } });
  r.c.useSimulator(true); await r.c.start({ userInitiated: true });
  r.c.simulator.setMode('strong');
  await new Promise(res => setTimeout(res, 2300)); // simulator emits 1 reading / s on a real timer
  await r.flush();
  assert.ok(r.reports.length >= 1 && r.reports[0].source === 'simulator');
  await r.c.stop({ report: false });
});

test('beacon not configured or disabled by staff: nothing is scanned', async () => {
  for (const config of [{ enabled: false }, { configured: false }]) {
    const r = rig({ config });
    await r.c.start({ userInitiated: true });
    assert.equal(r.c.status.code, 'not-configured'); assert.equal(r.started, 0);
  }
});

test('a 401 from the server stops detection without trying to report', async () => {
  const r = rig({ backendOverrides: { reportBeacon: async () => { const e = new Error('로그인이 필요합니다.'); e.status = 401; throw e; } } });
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush(); await r.flush();
  assert.equal(r.c.running, false); assert.equal(r.c.status.code, 'off');
});

test('server refusing a reading (not accepted) resets instead of claiming presence', async () => {
  const r = rig({ backendOverrides: { reportBeacon: async () => ({ accepted: false, present: false }) } });
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush();
  assert.equal(r.c.status.code, 'weak'); assert.equal(r.c.status.inside, false);
});

test('bluetooth hardware missing is reported as unsupported', async () => {
  const r = rig({ driver: { status: async () => ({ bluetooth: 'unsupported', permission: 'granted' }) } });
  await r.c.start({ userInitiated: true });
  assert.equal(r.c.status.code, 'unsupported'); assert.equal(r.started, 0);
});

test('after bluetooth is switched back on, detection resumes by itself (no prompt)', async () => {
  let bt = 'on', asked = 0;
  const r = rig({ driver: { status: async () => ({ bluetooth: bt, permission: 'granted' }), requestPermissions: async () => { asked++; return { permission: 'granted' }; } } });
  await r.c.start({ userInitiated: true });
  r.reading(-60); r.reading(-60); await r.flush();
  bt = 'off'; r.state({ bluetooth: 'off' }); await r.flush();
  assert.equal(r.c.status.code, 'bluetooth-off');
  r.advance(5 * S); await r.flush();
  assert.equal(r.c.running, false);                 // still off: keeps waiting
  bt = 'on'; r.advance(5 * S); await r.flush(); await r.flush();
  assert.equal(r.c.running, true); assert.equal(r.c.status.code, 'scanning'); assert.equal(asked, 0);
  await r.c.stop({ report: false });
  assert.equal(r.timers, 0);                         // no timers left behind
});

test('a native scan error stops pretending to scan and reports it', async () => {
  const r = rig();
  await r.c.start({ userInitiated: true });
  r.state({ error: 'SCAN_FAILED_2' }); await r.flush();
  assert.equal(r.c.status.code, 'scan-error'); assert.equal(r.c.running, false);
});

test('native start failing (bluetooth turned off in between) is not shown as scanning', async () => {
  const r = rig({ driver: { start: async () => { const e = new Error('Bluetooth is off'); e.code = 'BLUETOOTH_OFF'; throw e; } } });
  await r.c.start({ userInitiated: true });
  assert.equal(r.c.status.code, 'bluetooth-off'); assert.equal(r.c.running, false);
});
