'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(indexedDB = {}, caches) {
  const context = { URL, TextEncoder, structuredClone, self: {}, indexedDB, caches, Response, console };
  vm.runInNewContext(fs.readFileSync('public/js/offline-store.js', 'utf8'), context, { filename: require('node:path').resolve('public/js/offline-store.js') });
  return context.self.LinkNestOfflineStore;
}
const snapshot = () => ({ schemaVersion: 1, userId: 'owner', links: [{ id: '1', title: 'Title', url: 'https://example.com', status: 'saved', tags: ['tag'], notes: 'Note', saveReason: 'Reason', pinned: false, date: '', createdAt: '', updatedAt: '' }], total: 1, complete: true, downloadedAt: new Date().toISOString() });
it('validates and copies bounded safe offline snapshots', () => {
  const store = load(); const original = snapshot(); const copy = store.validateLibrary(original);
  assert.notEqual(copy, original); assert.notEqual(copy.links, original.links);
  original.links[0].notes = 'changed'; assert.equal(copy.links[0].notes, 'Note');
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com']) {
    const invalid = snapshot(); invalid.links[0].url = url;
    assert.throws(() => store.validateLibrary(invalid));
  }
  assert.throws(() => store.validateLibrary({ ...snapshot(), complete: false }));
  assert.equal(store.validateLibrary({ ...snapshot(), total: 2, complete: false }).complete, false);
  assert.throws(() => store.validateLibrary({ ...snapshot(), links: Array(2001).fill(snapshot().links[0]), total: 2001 }));
});

function memoryDatabase() {
  const stores = new Map([['captures', new Map([['legacy', { id: 'legacy', notes: 'private' }]])]]);
  let tail = Promise.resolve();
  return { stores, failOpen: false, failNextLibraryPut: false, failNextCommit: false, open() {
    const request = {};
    const database = this;
    setImmediate(() => {
      if (database.failOpen) { request.error = new Error('Storage blocked'); request.onerror?.(); return; }
      request.result = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore: name => stores.set(name, new Map()), close() {},
        transaction(names) {
          const tx = {}; const tasks = []; let pending = 0; let active = false; let finished = false;
          const before = tail; let release; tail = new Promise(resolve => { release = resolve; });
          let draft;
          function finish() { setImmediate(() => {
            if (pending || finished) return;
            if (database.failNextCommit) { database.failNextCommit = false; tx.error = new Error('Commit aborted'); tx.abort(); return; }
            finished = true; for (const name of names) stores.set(name, draft.get(name));
            tx.oncomplete?.(); release();
          }); }
          function execute(task) { setImmediate(() => {
            if (finished) return;
            task(); pending--; finish();
          }); }
          tx.abort = () => { finished = true; setImmediate(() => { tx.onabort?.(); release(); }); };
          tx.objectStore = name => {
            function operation(action) {
              const result = {}; pending++;
              const task = () => {
                try { result.result = structuredClone(action(draft.get(name))); result.onsuccess?.(); }
                catch (error) { tx.error = error; tx.onerror?.(); tx.abort(); }
              };
              if (active) execute(task); else tasks.push(task);
              return result;
            }
            return { get: id => operation(store => store.get(id)), getAll: () => operation(store => [...store.values()]),
              put: value => operation(store => { if (name === 'library' && database.failNextLibraryPut) { database.failNextLibraryPut = false; throw new Error('Quota exceeded'); } store.set(value.id, structuredClone(value)); return value.id; }),
              clear: () => operation(store => store.clear()), delete: id => operation(store => store.delete(id)) };
          };
          before.then(() => { draft = new Map(names.map(name => [name, new Map(stores.get(name))])); active = true; tasks.forEach(execute); });
          return tx;
        },
      };
      request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } };
}
it('upgrade preserves captures and identity generations block late writes and identity rebinding', async () => {
  const database = memoryDatabase(); const store = load(database);
  const initial = await store.getIdentity(); assert.equal(initial.userId, null);
  assert.equal(database.stores.get('captures').get('legacy').notes, 'private');
  const owner = await store.verifyIdentity('owner', initial);
  await store.replaceLibrary(snapshot(), owner); assert.equal((await store.readLibrary()).links[0].notes, 'Note');
  await store.invalidate('logout'); assert.equal(await store.readLibrary(), null);
  await assert.rejects(store.replaceLibrary(snapshot(), owner), /Account changed/);
  await assert.rejects(store.verifyIdentity('owner', owner), /Account changed/);
  const next = await store.verifyIdentity('owner', await store.getIdentity());
  await store.replaceLibrary(snapshot(), next); await store.clearLibrary();
  assert.equal((await store.getIdentity()).userId, 'owner'); assert.equal(await store.readLibrary(), null);
  await assert.rejects(store.replaceLibrary(snapshot(), next), /Account changed/);
  assert.equal(database.stores.get('captures').size, 1);
});
it('different verified account clears library and preserves quarantined captures', async () => {
  const database = memoryDatabase(); const store = load(database);
  const owner = await store.verifyIdentity('owner', await store.getIdentity());
  await store.replaceLibrary(snapshot(), owner);
  const other = await store.verifyIdentity('other', owner);
  assert.equal(other.userId, 'other'); assert.equal(await store.readLibrary(), null);
  assert.equal(database.stores.get('captures').size, 1);
  await assert.rejects(store.request('captures', 'readwrite', records => records.put({ id: 'late' }), owner));
  assert.equal(database.stores.get('captures').has('late'), false);
});

it('failed invalidation leaves durable marker; next tab clears old identity/library before reading', async () => {
  const data = new Map();
  const caches = { open: async () => ({ put: async (key, value) => data.set(key, value), match: async key => data.get(key), delete: async key => data.delete(key) }) };
  const database = memoryDatabase(); const store = load(database, caches);
  const token = await store.verifyIdentity('owner', await store.getIdentity()); await store.replaceLibrary(snapshot(), token);
  database.failOpen = true; await assert.rejects(store.invalidate('logout'), /Storage blocked/);
  assert.equal(data.size, 1); await assert.rejects(store.readLibrary());
  database.failOpen = false; const nextTab = load(database, caches);
  assert.equal(await nextTab.readLibrary(), null); assert.equal((await nextTab.getIdentity()).userId, null); assert.equal(data.size, 0);
  await assert.rejects(nextTab.verifyIdentity('owner', token), /Account changed/);
});

it('quota and transaction commit failures keep previous library and pending captures intact', async () => {
  const database = memoryDatabase(); const store = load(database);
  const owner = await store.verifyIdentity('owner', await store.getIdentity()); await store.replaceLibrary(snapshot(), owner);
  const changed = snapshot(); changed.links[0].notes = 'New notes';
  database.failNextLibraryPut = true;
  await assert.rejects(store.replaceLibrary(changed, owner), /Quota exceeded/);
  assert.equal((await store.readLibrary()).links[0].notes, 'Note');
  database.failNextCommit = true;
  await assert.rejects(store.replaceLibrary(changed, owner), /Commit aborted/);
  assert.equal((await store.readLibrary()).links[0].notes, 'Note');
  assert.equal(database.stores.get('captures').get('legacy').notes, 'private');
});
it('blocked upgrade rejects promptly and closes late connections; versionchange closes live connections', async () => {
  let request; let closed = 0;
  const store = load({ open() { request = {}; return request; } });
  const blocked = store.openDatabase(); request.onblocked();
  await assert.rejects(blocked, /Close older Link Nest tabs and retry/);
  request.result = { close() { closed++; } }; request.onsuccess(); assert.equal(closed, 1);
  const opened = store.openDatabase(); request.result = { close() { closed++; } }; request.onsuccess();
  const database = await opened; database.onversionchange(); assert.equal(closed, 2);
});
it('storage eviction returns an empty library and identity after reload', async () => {
  const database = memoryDatabase(); const store = load(database);
  const owner = await store.verifyIdentity('owner', await store.getIdentity()); await store.replaceLibrary(snapshot(), owner);
  database.stores.clear(); const reloaded = load(database);
  assert.equal(await reloaded.readLibrary(), null); assert.equal((await reloaded.getIdentity()).userId, null);
});
