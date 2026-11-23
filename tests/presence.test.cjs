const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('unchanged room polling stays fresh and expired self check-in updates', async () => {
  const base = Date.now();
  let reply = {count: 1, referenceCapacity: 15, sequence: 7, checkedIn: true, observedAt: new Date(base - 120000).toISOString()};
  const ctx = {Date, Set, AbortController, setInterval: () => 1, clearInterval: () => {}, addEventListener: () => {}, document: {hidden: false, addEventListener: () => {}}};
  ctx.window = ctx;
  ctx.SAI_CONFIG = {staleAfterMs: 90000, pollIntervalMs: 30000};
  ctx.SaiBackend = {occupancy: async () => reply};
  vm.createContext(ctx);
  for (const file of ['liquid.js', 'presence.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
  ctx.SaiPresence.start();
  await new Promise(setImmediate);
  assert.equal(ctx.SaiPresence.current().status, 'stale');
  reply = {...reply, observedAt: new Date(base).toISOString()};
  await ctx.SaiPresence.refresh();
  assert.equal(ctx.SaiPresence.current().status, 'live');
  assert.equal(ctx.SaiPresence.current().snapshot.checkedIn, true);
  reply = {...reply, count: 0, sequence: 8, checkedIn: false, observedAt: new Date(base + 1).toISOString()};
  await ctx.SaiPresence.refresh();
  assert.equal(ctx.SaiPresence.current().snapshot.checkedIn, false);
  assert.equal(ctx.SaiPresence.current().snapshot.count, 0);
  ctx.SaiPresence.stop();
});

test('check-in refresh waits for a running poll then reads the post-write snapshot', async () => {
  let finishPoll,calls=0;
  const reply=sequence=>({count:sequence,referenceCapacity:15,sequence,checkedIn:sequence===2,observedAt:new Date().toISOString(),roster:{sequence,count:sequence}});
  const ctx={Date,Set,AbortController,setInterval:()=>1,clearInterval:()=>{},addEventListener:()=>{},document:{hidden:false,addEventListener:()=>{}}};ctx.window=ctx;
  ctx.SAI_CONFIG={staleAfterMs:90000,pollIntervalMs:30000};
  ctx.SaiBackend={occupancy:()=>{calls++;return calls===1?new Promise(resolve=>finishPoll=resolve):Promise.resolve(reply(2));}};
  vm.createContext(ctx);for(const file of ['liquid.js','presence.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),ctx);
  ctx.SaiPresence.start();const refresh=ctx.SaiPresence.refresh({afterWrite:true});finishPoll(reply(1));await refresh;
  assert.equal(calls,2);assert.equal(ctx.SaiPresence.current().snapshot.count,2);assert.equal(ctx.SaiPresence.current().snapshot.roster.sequence,2);ctx.SaiPresence.stop();
});
