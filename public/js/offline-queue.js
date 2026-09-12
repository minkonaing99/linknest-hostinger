(function () {
  'use strict';

  const DB_NAME = 'linknest-offline';
  const STORE = 'captures';
  let syncing = false;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('linknest-offline', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeRequest(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      let result;
      request.onsuccess = () => {
        result = request.result;
        if (mode === 'readonly') resolve(result);
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        database.close();
        if (mode !== 'readonly') resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Offline storage failed'));
    });
  }

  function listCaptures() {
    return storeRequest('readonly', store => store.getAll()).then(records =>
      records.map(record => ({ ...record })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  }

  function saveCapture(record) {
    return storeRequest('readwrite', store => store.put({ ...record }));
  }

  function dismissCapture(id) {
    return storeRequest('readwrite', store => store.delete(String(id))).then(notifyChange);
  }

  function validateDraft(draft) {
    const parsed = new URL(String(draft.url || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Enter a valid web link.');
    const title = String(draft.title || '');
    const notes = String(draft.notes || '');
    const tags = Array.isArray(draft.tags) ? draft.tags.map(tag => String(tag).trim()).filter(Boolean) : [];
    if (title.length > 300 || notes.length > 10000 || tags.length > 20 || tags.some(tag => tag.length > 50)) {
      throw new Error('Capture is too large to save offline.');
    }
    return {
      url: parsed.toString(), title,
      date: String(draft.date || ''), status: String(draft.status || 'saved'), tags,
      notes, remindAt: draft.remindAt || null,
      pinned: Boolean(draft.pinned),
    };
  }

  async function queueCapture(draft) {
    const records = await listCaptures();
    if (records.length >= 100) throw new Error('Offline queue is full. Connect to sync saved links.');
    const now = new Date().toISOString();
    const record = {
      ...validateDraft(draft), id: crypto.randomUUID(), state: 'pending', error: '',
      createdAt: now, updatedAt: now, serverId: null,
    };
    await saveCapture(record);
    notifyChange();
    navigator.serviceWorker?.ready.then(registration => registration.sync?.register('linknest-captures')).catch(() => {});
    return { ...record };
  }

  async function markRecord(record, changes) {
    const updated = { ...record, ...changes, updatedAt: new Date().toISOString() };
    await saveCapture(updated);
    notifyChange();
    return updated;
  }

  async function syncRecord(record) {
    await markRecord(record, { state: 'syncing', error: '' });
    try {
      const params = new URLSearchParams({ url: record.url, title: record.title || record.url });
      const duplicateResponse = await fetch(`/api/links/duplicates?${params}`, { credentials: 'same-origin' });
      if (!duplicateResponse.ok) throw new Error('Could not check duplicates');
      const duplicateData = await duplicateResponse.json();
      if (duplicateData.candidates?.length) {
        await markRecord(record, { state: 'failed', error: 'Duplicate needs decision' });
        return true;
      }
      const response = await fetch('/api/links', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validateDraft(record)),
      });
      const data = await response.json();
      if (response.status === 409) {
        await markRecord(record, { state: 'failed', error: 'Duplicate needs decision' });
        return true;
      }
      if (response.status >= 500) throw new Error(data.error || 'Server unavailable');
      if (!response.ok) {
        await markRecord(record, { state: 'failed', error: data.error || 'Could not save link' });
        return true;
      }
      await markRecord(record, { state: 'saved', error: '', serverId: data.entry?.id || null });
      return true;
    } catch {
      await markRecord(record, { state: 'pending', error: '' });
      return false;
    }
  }

  async function syncCaptures() {
    if (syncing || !navigator.onLine) return;
    syncing = true;
    try {
      const records = (await listCaptures()).filter(record => ['pending', 'syncing'].includes(record.state));
      for (const record of records) {
        if (!await syncRecord(record)) break;
      }
    } finally {
      syncing = false;
      notifyChange();
    }
  }

  async function retryCapture(id) {
    const record = (await listCaptures()).find(item => item.id === id);
    if (!record) return;
    await markRecord(record, { state: 'pending', error: '' });
    await syncCaptures();
  }

  function notifyChange() {
    window.dispatchEvent(new CustomEvent('linknest:offline-queue-change'));
  }

  function queueAction(label, handler, accessibleLabel = label) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button button--ghost button--small'; button.textContent = label;
    button.setAttribute('aria-label', accessibleLabel);
    button.addEventListener('click', handler);
    return button;
  }

  async function renderQueue() {
    const list = document.getElementById('offline-capture-list');
    const section = document.getElementById('offline-captures');
    if (!list || !section) return;
    const records = await listCaptures();
    section.hidden = records.length === 0;
    list.textContent = '';
    records.forEach(record => {
      const row = document.createElement('div'); row.className = 'offline-capture-row';
      const text = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = record.title || record.url;
      const status = document.createElement('span'); status.textContent = record.error || record.state;
      text.append(title, status); row.appendChild(text);
      if (record.state === 'failed') {
        const edit = document.createElement('a'); edit.className = 'button button--ghost button--small'; edit.textContent = 'Review';
        edit.href = `/editor.html?offlineId=${encodeURIComponent(record.id)}`;
        edit.setAttribute('aria-label', `Review ${record.title || record.url}`);
        row.append(edit, queueAction('Retry', () => retryCapture(record.id)));
      }
      if (record.state === 'saved' || record.state === 'failed') {
        row.appendChild(queueAction('Dismiss', () => dismissCapture(record.id), `Dismiss ${record.title || record.url}`));
      }
      list.appendChild(row);
    });
  }

  function setupQueuePanel() {
    if (document.body.dataset.page !== 'home') return;
    const section = document.createElement('section');
    section.id = 'offline-captures'; section.className = 'surface surface--soft surface--group'; section.hidden = true;
    const heading = document.createElement('h2'); heading.className = 'section-title'; heading.textContent = 'Offline captures';
    const list = document.createElement('div'); list.id = 'offline-capture-list'; list.className = 'offline-capture-list';
    list.setAttribute('aria-live', 'polite'); section.append(heading, list);
    document.querySelector('main')?.prepend(section);
    renderQueue();
  }

  window.LinkNestOffline = { queueCapture, listCaptures, syncCaptures, retryCapture, dismissCapture };
  window.addEventListener('online', syncCaptures);
  window.addEventListener('linknest:offline-queue-change', renderQueue);
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data === 'linknest-sync-captures') syncCaptures();
  });
  window.addEventListener('DOMContentLoaded', () => { setupQueuePanel(); syncCaptures(); });
}());
