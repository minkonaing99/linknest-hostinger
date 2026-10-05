(() => {
  const KEY = 'linknest-last-undo';
  let current = null;

  function store() {
    try {
      if (!current) sessionStorage.removeItem(KEY);
      else sessionStorage.setItem(KEY, JSON.stringify({ id: current.id, expires: current.expires,
        remaining: remainingTime(), savedAt: Date.now() }));
    } catch {}
  }

  function remainingTime() {
    return current.paused ? current.remaining : Math.max(0, current.remaining - (Date.now() - current.started));
  }

  function clearUndo() {
    if (current) {
      clearTimeout(current.timer); clearTimeout(current.expiryTimer); current.toast.remove();
    }
    current = null; store();
  }

  function schedule() {
    clearTimeout(current.timer);
    current.started = Date.now();
    if (!current.paused) current.timer = setTimeout(clearUndo, current.remaining);
    store();
  }

  function pause(reason, value) {
    if (!current) return;
    current.remaining = remainingTime();
    current[reason] = value;
    current.paused = current.hovered || current.focused || current.pending;
    schedule();
  }

  async function undo(action) {
    if (current !== action || action.pending) return;
    pause('pending', true); action.button.disabled = true; action.message.textContent = 'Undoing...';
    try {
      const response = await window.LinkNest.apiFetch(`/api/actions/${encodeURIComponent(action.id)}/undo`, { method: 'POST' });
      const data = await response.json();
      if (current !== action) {
        if (response.ok) window.location.reload();
        return;
      }
      if (!response.ok) {
        if ([404, 409, 410].includes(response.status)) {
          clearUndo(); window.LinkNest.showToast(data.error || 'Undo is no longer available'); return;
        }
        throw new Error(data.error || 'Could not undo. Try again.');
      }
      clearUndo(); window.location.reload();
    } catch (error) {
      if (current === action) action.message.textContent = error.message || 'Could not undo. Try again.';
    } finally {
      if (current === action) { action.button.disabled = false; pause('pending', false); }
    }
  }

  function render(record, label) {
    clearUndo();
    const toast = document.createElement('div');
    toast.className = 'toast toast--success toast--undo toast--visible';
    const message = document.createElement('span'); message.textContent = label || 'Action saved';
    message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Undo';
    button.className = 'button button--ghost button--small';
    toast.append(message, button); document.body.appendChild(toast);
    current = { ...record, toast, message, button, hovered: false, focused: false, pending: false, paused: false };
    const action = current;
    button.addEventListener('click', () => undo(action));
    toast.addEventListener('mouseenter', () => pause('hovered', true));
    toast.addEventListener('mouseleave', () => pause('hovered', false));
    toast.addEventListener('focusin', () => pause('focused', true));
    toast.addEventListener('focusout', event => { if (!toast.contains(event.relatedTarget)) pause('focused', false); });
    current.expiryTimer = setTimeout(clearUndo, record.expires - Date.now()); schedule();
  }

  window.LinkNest.clearUndo = clearUndo;
  window.LinkNest.rememberUndo = (data, label) => {
    const action = data.action;
    if (!action) return;
    const expires = Date.parse(action.undoExpiresAt);
    if (typeof action.id !== 'string' || !Number.isFinite(expires) || expires <= Date.now()) return;
    render({ id: action.id, expires, remaining: 15000 }, label);
  };
  window.LinkNest.performAction = async fields => {
    const body = JSON.stringify({ ...fields, requestId: crypto.randomUUID() });
    let response, data;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await window.LinkNest.apiFetch('/api/links/actions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
        data = await response.json(); break;
      } catch (error) {
        if (attempt || error.message === 'Authentication required') throw error;
      }
    }
    if (!response.ok) throw new Error(data.error || 'Action failed');
    window.LinkNest.rememberUndo(data, fields.kind === 'archive' ? 'Moved to archive' : 'Status updated');
    return data;
  };
  window.addEventListener('pagehide', store);
  try {
    const record = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (document.body.dataset.page === 'login') clearUndo();
    else if (record && typeof record.id === 'string' && Number.isFinite(record.expires) && Number.isFinite(record.remaining) && Number.isFinite(record.savedAt)) {
      const remaining = Math.min(15000, record.remaining - Math.max(0, Date.now() - record.savedAt));
      if (remaining > 0 && record.expires > Date.now()) render({ id: record.id, expires: record.expires, remaining });
      else clearUndo();
    }
  } catch { clearUndo(); }
})();
