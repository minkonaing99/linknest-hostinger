(function () {
  'use strict';

  const store = window.LinkNestOfflineStore;
  const element = id => document.getElementById(id);
  let snapshot = null, busy = false, renderVersion = 0;

  async function verifyOnlineIdentity() {
    if (!navigator.onLine) throw new Error('Connect and sign in before downloading.');
    const expected = await store.getIdentity();
    const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      await store.invalidate('authentication');
      throw new Error('Authentication required. Sign in again.');
    }
    if (!response.ok) throw new Error('Could not verify your account.');
    const data = await response.json();
    if (typeof data.user?.id !== 'string' || !data.user.id || data.user.id.length > 36) {
      throw new Error('Could not verify your account.');
    }
    return store.verifyIdentity(data.user.id, expected);
  }

  async function download() {
    const identity = await verifyOnlineIdentity();
    const response = await fetch('/api/links/offline-snapshot', {
      credentials: 'same-origin', cache: 'no-store', headers: { 'X-LinkNest-User-ID': identity.userId },
    });
    if (response.status === 401 || response.status === 409) {
      await store.invalidate('authentication');
      throw new Error('Account changed or session expired. Sign in again.');
    }
    if (!response.ok) throw new Error('Could not download your library. Previous download kept.');
    const data = await response.json();
    await store.replaceLibrary(data, identity);
    return data;
  }

  function filterLinks(links, query, status) {
    const text = String(query || '').trim().toLowerCase();
    return links.filter(link => (!status || link.status === status) && (!text ||
      [link.title, link.url, ...(link.tags || []), link.notes, link.saveReason].some(value => String(value || '').toLowerCase().includes(text))));
  }

  function description(data) {
    if (!data) return 'No downloaded library. Connect and download in Settings.';
    const date = new Date(data.downloadedAt).toLocaleString();
    return `${data.links.length} of ${data.total} links downloaded ${date}.${data.complete ? '' : ' Partial library: newest updated links only.'}`;
  }

  function textNode(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function renderLink(link) {
    const row = textNode('article', '', 'surface surface--soft offline-library-row');
    const title = textNode('h2', '', 'section-title');
    const anchor = textNode('a', link.title || link.url);
    anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    title.appendChild(anchor); row.appendChild(title);
    row.appendChild(textNode('p', `${link.status} | ${link.tags.join(', ')}`, 'section-copy'));
    row.appendChild(textNode('p', link.url, 'offline-library-url'));
    if (link.saveReason) row.appendChild(textNode('p', `Why I saved this: ${link.saveReason}`, 'offline-library-note'));
    if (link.notes) row.appendChild(textNode('p', link.notes, 'offline-library-note'));
    return row;
  }

  function renderLinks() {
    const list = element('offline-library-list');
    if (!list) return;
    list.textContent = '';
    const links = filterLinks(snapshot?.links || [], element('offline-search')?.value, element('offline-status-filter')?.value);
    element('offline-result-count').textContent = `${links.length} links`;
    if (!links.length) list.appendChild(textNode('p', snapshot ? 'No matching downloaded links.' : 'Download your library in Settings while online.', 'empty-state'));
    links.forEach(link => list.appendChild(renderLink(link)));
  }

  async function refreshDisplay() {
    const version = ++renderVersion;
    const data = await store.readLibrary();
    if (version !== renderVersion) return;
    snapshot = data;
    const summary = element('offline-library-summary');
    if (summary) summary.textContent = description(data);
    const remove = element('offline-library-remove');
    if (remove) remove.disabled = busy || !data;
    const button = element('offline-library-download');
    if (button) { button.disabled = busy; button.textContent = data ? 'Refresh download' : 'Download library'; }
    renderLinks();
  }

  function setMessage(message, failed = false) {
    const target = element('offline-library-message');
    if (!target) return;
    target.textContent = message;
    target.setAttribute('role', failed ? 'alert' : 'status');
  }

  async function runAction(action) {
    if (busy) return;
    busy = true;
    element('offline-library-download')?.setAttribute('disabled', '');
    element('offline-library-remove')?.setAttribute('disabled', '');
    try {
      await action();
    } catch (error) {
      setMessage(error.message || 'Offline storage unavailable. Try again.', true);
    } finally {
      busy = false;
      await refreshDisplay().catch(() => setMessage('Offline storage unavailable. Try again.', true));
    }
  }

  function setupControls() {
    element('offline-library-download')?.addEventListener('click', () => runAction(async () => {
      setMessage('Downloading library...');
      await download();
      setMessage('Library downloaded. Available on this device offline.');
    }));
    element('offline-library-remove')?.addEventListener('click', () => runAction(async () => {
      await store.clearLibrary();
      setMessage('Download removed. Pending captures kept.');
    }));
    element('offline-library-persist')?.addEventListener('click', () => runAction(async () => {
      if (!await store.readLibrary()) throw new Error('Download your library first.');
      const granted = await navigator.storage?.persist?.();
      setMessage(granted ? 'Browser will protect storage from automatic eviction.' : 'Persistent storage unavailable or declined. You can still use your download.');
    }));
    element('offline-search')?.addEventListener('input', renderLinks);
    element('offline-status-filter')?.addEventListener('change', renderLinks);
    element('offline-retry')?.addEventListener('click', () => window.location.reload());
  }

  function clearVisibleLibrary() {
    ++renderVersion;
    snapshot = null;
    const summary = element('offline-library-summary');
    if (summary) summary.textContent = description(null);
    renderLinks();
  }

  async function init() {
    setupControls();
    if (document.body.dataset.page !== 'login' && navigator.onLine) {
      try { await verifyOnlineIdentity(); }
      catch (error) { setMessage(error.message, true); }
    }
    if (element('offline-library-summary')) await refreshDisplay().catch(() => setMessage('Offline storage unavailable. Connect and try again.', true));
  }

  window.LinkNestOfflineLibrary = { verifyOnlineIdentity, download, filterLinks };
  window.addEventListener('linknest:offline-invalidated', clearVisibleLibrary);
  window.addEventListener('linknest:offline-identity-change', () => {
    clearVisibleLibrary();
    if (element('offline-library-summary')) refreshDisplay().catch(() => clearVisibleLibrary());
  });
  window.addEventListener('linknest:offline-library-change', () => {
    if (element('offline-library-summary')) refreshDisplay().catch(() => clearVisibleLibrary());
  });
  window.addEventListener('DOMContentLoaded', () => init().catch(() => setMessage('Offline storage unavailable.', true)));
}());
