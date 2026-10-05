(function (scope) {
  'use strict';
  const PRIVACY_CACHE = 'linknest-offline-privacy';
  const INVALIDATED = '/__offline-invalidated';
  let invalidationPending = false;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('linknest-offline') : null;
  function emit(name) {
    if (scope.dispatchEvent && typeof CustomEvent === 'function') scope.dispatchEvent(new CustomEvent(name));
    channel?.postMessage(name);
  }
  if (channel) channel.onmessage = event => {
    if (scope.dispatchEvent && typeof CustomEvent === 'function') scope.dispatchEvent(new CustomEvent(event.data));
  };
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('linknest-offline', 2);
      request.onupgradeneeded = () => {
        for (const name of ['captures', 'library', 'meta']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
        }
      };
      let blocked = false;
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Close older Link Nest tabs and retry.')); };
    });
  }
  async function rawTransaction(names, mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(names, mode);
      let result;
      let failure;
      const abort = error => { failure = error; tx.abort(); };
      try { operation(tx, value => { result = value; }, abort); } catch (error) { abort(error); }
      tx.oncomplete = () => { database.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { database.close(); reject(failure || tx.error || new Error('Offline storage failed')); };
    });
  }
  async function marker(operation) {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(PRIVACY_CACHE);
    if (operation === 'write') return cache.put(INVALIDATED, new Response('pending'));
    if (operation === 'delete') return cache.delete(INVALIDATED);
    return Boolean(await cache.match(INVALIDATED));
  }
  function clearIdentity() {
    return rawTransaction(['meta', 'library'], 'readwrite', (tx, done) => {
      const meta = tx.objectStore('meta'); const request = meta.get('identity');
      request.onsuccess = () => {
        const next = { userId: null, generation: identity(request.result).generation + 1 };
        meta.put({ id: 'identity', ...next }); tx.objectStore('library').clear(); done(next);
      };
    });
  }
  async function transaction(names, mode, operation) {
    if (invalidationPending || await marker('read')) {
      invalidationPending = true;
      await clearIdentity();
      await marker('delete');
      invalidationPending = false;
    }
    return rawTransaction(names, mode, operation);
  }
  function identity(value) { return { userId: value?.userId || null, generation: value?.generation || 0 }; }
  function sameIdentity(a, b) { return a?.userId === b?.userId && a?.generation === b?.generation; }
  function getIdentity() {
    return transaction(['meta'], 'readonly', (tx, done) => {
      const request = tx.objectStore('meta').get('identity'); request.onsuccess = () => done(identity(request.result));
    });
  }
  function verifyIdentity(userId, expectedToken) {
    if (typeof userId !== 'string' || !userId || userId.length > 36) return Promise.reject(new Error('Invalid account identity'));
    let changedOwner = false;
    return transaction(['meta', 'library'], 'readwrite', (tx, done, abort) => {
      const meta = tx.objectStore('meta'); const request = meta.get('identity');
      request.onsuccess = () => {
        const current = identity(request.result);
        if (expectedToken && !sameIdentity(current, expectedToken)) return abort(new Error('Account changed. Retry.'));
        changedOwner = Boolean(current.userId && current.userId !== userId);
        const next = current.userId === userId ? current : { userId, generation: current.generation + 1 };
        if (current.userId !== userId) tx.objectStore('library').clear();
        meta.put({ id: 'identity', ...next }); done(next);
      };
    }).then(result => { if (changedOwner) emit('linknest:offline-invalidated'); emit('linknest:offline-identity-change'); return result; });
  }
  async function invalidate(reason) {
    invalidationPending = true;
    emit('linknest:offline-invalidated'); emit('linknest:offline-library-change');
    try { await marker('write'); } catch {}
    const result = await clearIdentity();
    await marker('delete');
    invalidationPending = false;
    return result;
  }
  function clearLibrary() {
    return transaction(['meta', 'library'], 'readwrite', (tx, done) => {
      const meta = tx.objectStore('meta'); const request = meta.get('identity');
      request.onsuccess = () => {
        const current = identity(request.result); const next = { ...current, generation: current.generation + 1 };
        meta.put({ id: 'identity', ...next }); tx.objectStore('library').clear(); done(next);
      };
    }).then(result => { emit('linknest:offline-library-change'); return result; });
  }
  function validateLibrary(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.userId !== 'string' || !snapshot.userId || snapshot.userId.length > 36 || typeof snapshot.complete !== 'boolean' || !Array.isArray(snapshot.links) || snapshot.links.length > 2000 || !Number.isInteger(snapshot.total) || snapshot.total < snapshot.links.length || snapshot.complete !== (snapshot.total === snapshot.links.length) || !Number.isFinite(Date.parse(snapshot.downloadedAt))) throw new Error('Invalid or incomplete library download');
    const seen = new Set();
    const links = snapshot.links.map(link => {
      if (!link || typeof link.id !== 'string' || !link.id || link.id.length > 36 || seen.has(link.id)) throw new Error('Invalid library link');
      seen.add(link.id);
      const parsed = new URL(link.url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || String(link.url).length > 4096) throw new Error('Invalid library URL');
      if (!['saved', 'unread', 'useful', 'archived'].includes(link.status) || !Array.isArray(link.tags) || link.tags.length > 20 || link.tags.some(tag => typeof tag !== 'string' || tag.length > 50)) throw new Error('Invalid library fields');
      const copy = { id: link.id, url: parsed.href, status: link.status, tags: [...link.tags], pinned: Boolean(link.pinned) };
      for (const [field, max] of [['title', 300], ['notes', 10000], ['saveReason', 500], ['date', 40], ['createdAt', 40], ['updatedAt', 40]]) {
        if (['createdAt', 'updatedAt'].includes(field) && link[field] === null) { copy[field] = null; continue; }
        if (typeof link[field] !== 'string' || link[field].length > max) throw new Error('Invalid library text');
        copy[field] = link[field];
      }
      return copy;
    });
    const copy = { schemaVersion: 1, userId: snapshot.userId, links, total: snapshot.total, complete: snapshot.complete, downloadedAt: snapshot.downloadedAt };
    if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > 25 * 1024 * 1024) throw new Error('Library exceeds 25 MiB');
    return copy;
  }
  function replaceLibrary(snapshot, expectedIdentity) {
    const copy = validateLibrary(snapshot);
    return transaction(['meta', 'library'], 'readwrite', (tx, done, abort) => {
      const request = tx.objectStore('meta').get('identity'); request.onsuccess = () => {
        const current = identity(request.result);
        if (!sameIdentity(current, expectedIdentity) || current.userId !== copy.userId) return abort(new Error('Account changed. Download discarded.'));
        tx.objectStore('library').put({ id: 'snapshot', identity: current, snapshot: copy }); done(copy);
      };
    }).then(result => { emit('linknest:offline-library-change'); return result; });
  }
  function readLibrary() {
    return transaction(['meta', 'library'], 'readonly', (tx, done) => {
      const request = tx.objectStore('meta').get('identity'); request.onsuccess = () => {
        const current = identity(request.result); const library = tx.objectStore('library').get('snapshot');
        library.onsuccess = () => done(current.userId && sameIdentity(current, library.result?.identity) ? library.result.snapshot : null);
      };
    });
  }
  function request(storeName, mode, operation, expectedIdentity) {
    return transaction([storeName, 'meta'], mode, (tx, done, abort) => {
      const check = tx.objectStore('meta').get('identity'); check.onsuccess = () => {
        if (expectedIdentity && !sameIdentity(identity(check.result), expectedIdentity)) return abort(new Error('Account changed'));
        const request = operation(tx.objectStore(storeName)); request.onsuccess = () => done(request.result);
      };
    });
  }
  scope.LinkNestOfflineStore = { openDatabase, getIdentity, verifyIdentity, invalidate, readLibrary, replaceLibrary, clearLibrary, validateLibrary, request, sameIdentity };
}(typeof window === 'undefined' ? self : window));
