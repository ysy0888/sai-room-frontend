const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { Math, Number, Date }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['liquid.js', 'soft-physics.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx);
const L = ctx.SaiLiquid;
const fill = (count, capacity) => { const w = ctx.SaiSoftPhysics.createWorld(); w.configure(count, capacity, Math.min(count, 15)); return w.config.pressure; };

test('count above the reference capacity stays exact while the gauge is capped at full', () => {
  const snap = { count: 22, referenceCapacity: 15, observedAt: new Date().toISOString(), sequence: 3 };
  assert.equal(L.validSnapshot(snap), true);                     // the exact number is accepted, not clamped
  assert.equal(L.acceptSnapshot(null, snap).count, 22);
  assert.equal(L.occupancyLabel(22, 15), '기준 인원 초과');
  assert.equal(fill(22, 15), fill(15, 15));                      // gauge fill: same as exactly full (capped)
  assert.equal(fill(15, 15), 1);
  assert.ok(fill(7, 15) < 1);                                     // below capacity is not full
});

test('server-provided reference capacity drives the gauge ratio', () => {
  assert.equal(L.occupancyLabel(1, 1), '기준 인원 도달');
  assert.equal(L.occupancyLabel(0, 15), '감지 인원 없음');
});
