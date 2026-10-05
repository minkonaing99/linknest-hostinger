(function () {
  'use strict';

  const STORE = 'captures';
  const storage = window.LinkNestOfflineStore;
  let syncing = false;
  let renderVersion = 0;
  function storeRequest(mode, operation, expectedIdentity) {
    return storage.request(STORE, mode, operation, expectedIdentity);
  }

  async function listCaptures(includeQuarantined = false) {
    const owner = await storage.getIdentity();
    return storeRequest('readonly', store => store.getAll(), owner).then(records =>
      records.filter(record => includeQuarantined || (owner.userId && record.ownerId === owner.userId)).map(record => ({ ...record })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  }

  function saveCapture(record, expectedIdentity) {
    return storeRequest('readwrite', store => store.put({ ...record }), expectedIdentity);
  }

  function dismissCapture(id) {
    return storeRequest('readwrite', store => store.delete(String(id))).then(notifyChange);
  }

  function validateDraft(draft) {
    const parsed = new URL(String(draft.url || '').trim());
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) throw new Error('Enter a valid web link.');
    const title = String(draft.title || '');
    const notes = String(draft.notes || '');
    if (draft.saveReason !== undefined && typeof draft.saveReason !== 'string') {
      throw new Error('Save reason must be plain text.');
    }
    const saveReason = (draft.saveReason || '').trim();
    const tags = Array.isArray(draft.tags) ? draft.tags.map(tag => String(tag).trim()).filter(Boolean) : [];
    if (title.length > 300 || notes.length > 10000 || saveReason.length > 500 || tags.length > 20 || tags.some(tag => tag.length > 50)) {
      throw new Error('Capture is too large to save offline.');
    }
    return {
      url: parsed.toString(), title,
      date: String(draft.date || ''), status: String(draft.status || 'saved'), tags,
      notes, saveReason, remindAt: draft.remindAt || null,
      pinned: Boolean(draft.pinned),
    };
  }

  async function queueCapture(draft) {
    const owner = await storage.getIdentity();
    const records = await listCaptures(true);
    if (records.length >= 100) throw new Error('Offline queue is full. Connect to sync saved links.');
    const now = new Date().toISOString();
    const record = {
      ...validateDraft(draft), id: crypto.randomUUID(), state: 'pending', error: '',
      createdAt: now, updatedAt: now, serverId: null, ownerId: owner.userId,
    };
    await saveCapture(record, owner);
    notifyChange();
    navigator.serviceWorker?.ready.then(registration => registration.sync?.register('linknest-captures')).catch(() => {});
    return { ...record };
  }

  async function markRecord(record, changes, owner) {
    const updated = { ...record, ...changes, updatedAt: new Date().toISOString() };
    await saveCapture(updated, owner);
    notifyChange();
    return updated;
  }

  async function syncRecord(record, owner) {
    await markRecord(record, { state: 'syncing', error: '' }, owner);
    try {
      const params = new URLSearchParams({ url: record.url, title: record.title || record.url });
      const duplicateResponse = await fetch(`/api/links/duplicates?${params}`, { credentials: 'same-origin', headers: { 'X-LinkNest-User-ID': owner.userId } });
      if ([401, 409].includes(duplicateResponse.status)) { await storage.invalidate('unauthorized'); return false; }
      if (!duplicateResponse.ok) throw new Error('Could not check duplicates');
      const duplicateData = await duplicateResponse.json();
      if (duplicateData.candidates?.length) {
        await markRecord(record, { state: 'failed', error: 'Duplicate needs decision' }, owner);
        return true;
      }
      if (!storage.sameIdentity(await storage.getIdentity(), owner)) return false;
      const response = await fetch('/api/links', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-LinkNest-User-ID': owner.userId },
        body: JSON.stringify(validateDraft(record)),
      });
      if (response.status === 401) { await storage.invalidate('unauthorized'); return false; }
      const data = await response.json();
      if (response.status === 409 && /account changed/i.test(data.error || '')) {
        await storage.invalidate('account changed'); return false;
      }
      if (response.status === 409) {
        await markRecord(record, { state: 'failed', error: 'Duplicate needs decision' }, owner);
        return true;
      }
      if (response.status >= 500) throw new Error(data.error || 'Server unavailable');
      if (!response.ok) {
        await markRecord(record, { state: 'failed', error: data.error || 'Could not save link' }, owner);
        return true;
      }
      await markRecord(record, { state: 'saved', error: '', serverId: data.entry?.id || null }, owner);
      return true;
    } catch {
      if (storage.sameIdentity(await storage.getIdentity(), owner)) await markRecord(record, { state: 'pending', error: '' }, owner);
      return false;
    }
  }

  async function syncCaptures() {
    if (syncing || !navigator.onLine) return;
    syncing = true;
    try {
      const token = await storage.getIdentity();
      const response = await fetch('/api/me', { credentials: 'same-origin' });
      if (response.status === 401) { await storage.invalidate('unauthorized'); return; }
      if (!response.ok) return;
      const data = await response.json();
      const owner = await storage.verifyIdentity(data.user.id, token);
      const records = (await listCaptures()).filter(record => ['pending', 'syncing'].includes(record.state));
      for (const record of records) {
        if (!await syncRecord(record, owner)) break;
      }
    } catch {
      // Network or identity changes keep captures locally.
    } finally {
      syncing = false;
      notifyChange();
    }
  }

  async function retryCapture(id) {
    const record = (await listCaptures()).find(item => item.id === id);
    if (!record) return;
    await markRecord(record, { state: 'pending', error: '' }, await storage.getIdentity());
    await syncCaptures();
  }

  async function claimCapture(id) {
    const token = await storage.getIdentity();
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.status === 401) await storage.invalidate('unauthorized');
    if (!response.ok) throw new Error('Sign in before claiming a capture');
    const data = await response.json(); const owner = await storage.verifyIdentity(data.user.id, token);
    const record = (await listCaptures(true)).find(item => item.id === id);
    if (!record) throw new Error('Capture not found');
    await markRecord(record, { ownerId: owner.userId, state: 'pending', error: '' }, owner);
    await syncCaptures();
  }

  async function quarantinedCount() {
    const owner = await storage.getIdentity();
    return (await listCaptures(true)).filter(record => !owner.userId || record.ownerId !== owner.userId).length;
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
    const version = ++renderVersion;
    const list = document.getElementById('offline-capture-list');
    const section = document.getElementById('offline-captures');
    if (!list || !section) return;
    const owner = await storage.getIdentity();
    let records;
    try { records = await listCaptures(); } catch { records = []; }
    if (version !== renderVersion || !storage.sameIdentity(owner, await storage.getIdentity())) return;
    const quarantined = (await listCaptures(true)).filter(record => !owner.userId || record.ownerId !== owner.userId);
    if (version !== renderVersion || !storage.sameIdentity(owner, await storage.getIdentity())) return;
    section.hidden = records.length === 0 && quarantined.length === 0;
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
    quarantined.forEach((record, index) => {
      const row = document.createElement('div'); row.className = 'offline-capture-row';
      const text = document.createElement('span'); text.textContent = `Unassigned capture ${index + 1}`;
      row.appendChild(text);
      row.appendChild(queueAction('Claim after sign in', async () => {
        try { await claimCapture(record.id); } catch { text.textContent = 'Sign in online to claim this capture.'; }
      }));
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

  window.LinkNestOffline = { queueCapture, listCaptures, syncCaptures, retryCapture, dismissCapture, claimCapture, quarantinedCount };
  window.addEventListener('online', syncCaptures);
  window.addEventListener('linknest:offline-queue-change', renderQueue);
  window.addEventListener('linknest:offline-invalidated', () => {
    renderVersion++;
    const list = document.getElementById('offline-capture-list');
    if (list) list.textContent = '';
    renderQueue().catch(() => {});
  });
  window.addEventListener('linknest:offline-identity-change', renderQueue);
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data === 'linknest-sync-captures') syncCaptures();
  });
  window.addEventListener('DOMContentLoaded', () => { setupQueuePanel(); syncCaptures(); });
}());
