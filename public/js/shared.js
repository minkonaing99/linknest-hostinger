async function linkNestApiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Authentication required');
  }

  return res;
}

function thailandDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

window.LinkNest = {
  apiFetch: linkNestApiFetch,
  thailandDateString,

  async getLinks() {
    const res = await linkNestApiFetch('/api/links');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load links');
    return data.links || [];
  },

  statusClass(status) {
    return `status-${status || 'saved'}`;
  },

  safeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  },

  setMessage(target, text, kind = '') {
    if (!target) return;
    target.textContent = text;
    target.className = `form-message ${kind}`.trim();
    target.removeAttribute('aria-label');
    target.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  },

  parseTags(value) {
    return String(value || '').split(',').map(t => t.trim()).filter(Boolean);
  },

  queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  },

  async logout() {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      window.location.href = '/login.html';
    }
  },
};

function renderUnreadBadge(count) {
  const badge = document.getElementById('unread-badge');
  if (!badge) return;
  const safeCount = Number(count) || 0;
  if (safeCount > 0) {
    badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function updateUnreadBadge() {
  try {
    const res = await linkNestApiFetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    renderUnreadBadge(data.unread);
  } catch {
    // silently ignore — badge is non-critical
  }
}

window.LinkNest.updateUnreadBadge = updateUnreadBadge;
window.LinkNest.renderUnreadBadge = renderUnreadBadge;

window.LinkNest.findDuplicateCandidates = async function(url, title) {
  const params = new URLSearchParams({ url, title: title || url });
  const res = await linkNestApiFetch(`/api/links/duplicates?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not check duplicates');
  return data.candidates || [];
};

window.LinkNest.showToast = function(message, kind = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
};

let commandState = {
  items: [], selected: 0, requestId: 0, controller: null, timer: null, busy: false,
};

function commandSelectedItem() {
  return commandState.items[commandState.selected] || null;
}

function setCommandBusy(busy) {
  commandState = { ...commandState, busy };
  document.querySelectorAll('.command-actions button, .command-note button')
    .forEach(button => { button.disabled = busy; });
}

function selectCommandResult(index) {
  if (!commandState.items.length) return;
  const selected = Math.max(0, Math.min(index, commandState.items.length - 1));
  toggleCommandNote(false);
  commandState = { ...commandState, selected };
  document.querySelectorAll('.command-result').forEach((result, resultIndex) => {
    const active = resultIndex === selected;
    result.classList.toggle('is-active', active);
    result.setAttribute('aria-selected', String(active));
  });
  const input = document.getElementById('command-search-input');
  input.setAttribute('aria-activedescendant', `command-result-${selected}`);
  document.querySelector('.command-actions').hidden = false;
}

function renderCommandResults(message = '') {
  const results = document.getElementById('command-results');
  const status = document.getElementById('command-status');
  results.textContent = '';
  status.textContent = message;
  commandState.items.forEach((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.id = `command-result-${index}`;
    option.className = 'command-result';
    option.tabIndex = -1;
    option.setAttribute('role', 'option');
    option.addEventListener('click', () => selectCommandResult(index));
    const title = document.createElement('strong');
    title.textContent = item.title || item.url;
    const host = document.createElement('span');
    host.textContent = window.LinkNest.safeHost(item.url);
    option.append(title, host);
    results.appendChild(option);
  });
  document.getElementById('command-search-input')
    .setAttribute('aria-expanded', String(commandState.items.length > 0));
  document.querySelector('.command-actions').hidden = !commandState.items.length;
  if (commandState.items.length) {
    selectCommandResult(0);
  } else {
    document.getElementById('command-search-input').removeAttribute('aria-activedescendant');
  }
}

async function searchCommandLinks() {
  const input = document.getElementById('command-search-input');
  const query = input.value.trim();
  commandState.controller?.abort();
  if (!query) {
    commandState = { ...commandState, items: [], controller: null };
    renderCommandResults('Type to search saved links.');
    return;
  }
  const controller = new AbortController();
  const requestId = commandState.requestId + 1;
  commandState = { ...commandState, controller, requestId };
  renderCommandResults('Searching...');
  const params = new URLSearchParams({ q: query, limit: '10', sort: 'updatedAt', order: 'desc' });
  try {
    const response = await linkNestApiFetch(`/api/links?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed');
    if (requestId !== commandState.requestId) return;
    commandState = { ...commandState, items: data.links || [], selected: 0 };
    renderCommandResults(commandState.items.length ? '' : 'No matching links.');
  } catch (error) {
    if (requestId !== commandState.requestId) return;
    if (error.name !== 'AbortError') renderCommandResults('Could not search links.');
  }
}

function queueCommandSearch() {
  clearTimeout(commandState.timer);
  const timer = setTimeout(searchCommandLinks, 275);
  commandState = { ...commandState, timer };
}

async function updateCommandItem(body, successMessage, remove = false) {
  const item = commandSelectedItem();
  if (!item || commandState.busy) return;
  setCommandBusy(true);
  try {
    const response = await linkNestApiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
      method: remove ? 'DELETE' : 'PUT',
      headers: remove ? undefined : { 'Content-Type': 'application/json' },
      body: remove ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Action failed');
    const items = remove
      ? commandState.items.filter(link => link.id !== item.id)
      : commandState.items.map(link => link.id === item.id ? (data.entry || { ...link, ...body }) : link);
    commandState = { ...commandState, items, selected: Math.min(commandState.selected, items.length - 1) };
    renderCommandResults(items.length ? '' : 'No matching links.');
    window.LinkNest.showToast(successMessage, 'success');
    updateUnreadBadge();
    return true;
  } catch (error) {
    window.LinkNest.showToast(error.message);
    return false;
  } finally {
    setCommandBusy(false);
  }
}

async function openCommandItem() {
  const item = commandSelectedItem();
  if (!item) return;
  window.open(item.url, '_blank', 'noopener,noreferrer');
  try { await linkNestApiFetch(`/api/links/${encodeURIComponent(item.id)}/opened`, { method: 'POST' }); } catch {}
}

function toggleCommandNote(show) {
  const panel = document.querySelector('.command-note');
  const note = document.getElementById('command-note-input');
  panel.hidden = !show;
  if (show) {
    note.value = commandSelectedItem()?.notes || '';
    note.focus();
  }
}

function buildCommandDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'command-dialog';
  dialog.setAttribute('aria-labelledby', 'command-heading');
  const heading = document.createElement('h2');
  heading.id = 'command-heading';
  heading.textContent = 'Search links';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'command-close'; close.textContent = 'Close';
  const header = document.createElement('div');
  header.className = 'command-header'; header.append(heading, close);
  const input = document.createElement('input');
  input.id = 'command-search-input'; input.className = 'field command-input';
  input.type = 'search'; input.maxLength = 200; input.placeholder = 'Search saved links';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'command-results'); input.setAttribute('aria-expanded', 'false');
  const status = document.createElement('p');
  status.id = 'command-status'; status.className = 'command-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = document.createElement('div');
  results.id = 'command-results'; results.className = 'command-results'; results.setAttribute('role', 'listbox');
  const actions = buildCommandActions();
  dialog.append(header, input, status, results, actions.toolbar, actions.notePanel);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  input.addEventListener('input', queueCommandSearch);
  input.addEventListener('keydown', handleCommandInputKey);
  document.body.appendChild(dialog);
  return dialog;
}

function buildCommandActions() {
  const toolbar = document.createElement('div');
  toolbar.className = 'command-actions'; toolbar.hidden = true;
  const actions = [
    ['Open', openCommandItem], ['Add note', () => toggleCommandNote(true)],
    ['Useful', () => updateCommandItem({ status: 'useful' }, 'Marked useful')],
    ['Snooze', () => updateCommandItem({ remindAt: new Date(Date.now() + 604800000).toISOString() }, 'Snoozed one week')],
    ['Archive', () => updateCommandItem({}, 'Archived', true)],
  ];
  actions.forEach(([label, handler]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button button--ghost button--small';
    button.textContent = label; button.addEventListener('click', handler); toolbar.appendChild(button);
  });
  const notePanel = document.createElement('div');
  notePanel.className = 'command-note'; notePanel.hidden = true;
  const note = document.createElement('textarea');
  note.id = 'command-note-input'; note.className = 'field'; note.maxLength = 10000; note.rows = 4;
  note.placeholder = 'Add a note';
  note.setAttribute('aria-label', 'Note');
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'button button--primary button--small'; save.textContent = 'Save note';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'button button--ghost button--small'; cancel.textContent = 'Cancel';
  save.addEventListener('click', async () => {
    const saved = await updateCommandItem({ notes: note.value.trim() }, 'Note saved');
    if (saved) toggleCommandNote(false);
  });
  cancel.addEventListener('click', () => toggleCommandNote(false));
  note.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggleCommandNote(false); }
  });
  notePanel.append(note, save, cancel);
  return { toolbar, notePanel };
}

function handleCommandInputKey(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    selectCommandResult(commandState.selected + (event.key === 'ArrowDown' ? 1 : -1));
  }
  if (event.key === 'Enter' && commandSelectedItem()) {
    event.preventDefault(); openCommandItem();
  }
}

function setupCommandSearch(logoutButton) {
  if (document.body.dataset.page === 'login' || !logoutButton) return;
  const dialog = buildCommandDialog();
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'button button--ghost button--small command-open-button';
  open.textContent = 'Search'; open.setAttribute('aria-keyshortcuts', '/ Meta+K Control+K');
  open.addEventListener('click', () => { dialog.showModal(); document.getElementById('command-search-input').focus(); });
  logoutButton.before(open);
}

window.addEventListener('DOMContentLoaded', () => {
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      window.LinkNest.logout().catch(() => {
        window.location.href = '/login.html';
      });
    });
  }
  setupCommandSearch(logoutButton);
  if (document.body.dataset.page !== 'home') updateUnreadBadge();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('keydown', event => {
  const inInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')
    || document.activeElement?.isContentEditable;
  const commandKey = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
  if ((event.key === '/' && !inInput && !event.metaKey && !event.ctrlKey) || commandKey) {
    const dialog = document.querySelector('.command-dialog');
    if (!dialog) return;
    event.preventDefault();
    if (!dialog.open) dialog.showModal();
    document.getElementById('command-search-input').focus();
  }
});

// Pull-to-refresh utility for mobile
window.LinkNest.initPullToRefresh = function (onRefresh) {
  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  document.body.appendChild(indicator);

  let startY = 0;
  let active = false;
  const THRESHOLD = 65;

  document.addEventListener('touchstart', e => {
    if (window.scrollY <= 0) { startY = e.touches[0].clientY; active = true; }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!active) return;
    indicator.classList.toggle('ptr-visible', e.touches[0].clientY - startY > 30);
  }, { passive: true });

  document.addEventListener('touchend', async e => {
    if (!active) return;
    active = false;
    if (e.changedTouches[0].clientY - startY > THRESHOLD) {
      indicator.classList.add('ptr-visible', 'ptr-spinning');
      try { await onRefresh(); } finally {
        indicator.classList.remove('ptr-visible', 'ptr-spinning');
      }
    } else {
      indicator.classList.remove('ptr-visible');
    }
  }, { passive: true });
};
