'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

it('undo snapshots get bounded cleanup at startup and periodically without keeping the process alive', async () => {
  let cleanups = 0, callback, interval, unref = false;
  const context = { require: name => name === './lib/config' ? { PORT: 3000 }
    : name === './lib/db' ? { connectDb: async () => {}, ensureAdminUser: async () => {}, closeDb: async () => {} }
    : name === './lib/link-actions' ? { cleanupExpiredActions: async () => { cleanups += 1; } }
    : { server: { setTimeout() {}, listen(_port, onListen) { onListen(); } } },
  console: { log() {}, error() {} }, process: { on() {}, exit() {} },
  setInterval(work, delay) { callback = work; interval = delay; return { unref() { unref = true; } }; } };
  vm.runInNewContext(fs.readFileSync('server.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cleanups, 1);
  assert.equal(interval, 60000);
  assert.equal(unref, true);
  await callback();
  assert.equal(cleanups, 2);
});
