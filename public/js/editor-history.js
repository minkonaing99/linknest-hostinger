'use strict';

(() => {
  const { apiFetch, queryParam, setMessage } = window.LinkNest;
  const linkId = queryParam('id');
  const section = document.getElementById('link-history');
  if (!linkId || !section) return;

  const list = document.getElementById('history-list');
  const status = document.getElementById('history-status');
  const more = document.getElementById('history-more');
  const retry = document.getElementById('history-retry');
  const summary = document.getElementById('history-summary');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const labels = {
    saved: 'Link saved', imported: 'Link imported', note_updated: 'Notes updated',
    marked_useful: 'Marked useful', status_changed: 'Status changed', snoozed: 'Snoozed',
    archived: 'Archived', restored: 'Restored', useful_review_completed: 'Useful review completed',
    save_reason_updated: 'Save reason updated', details_updated: 'Details updated', action_undone: 'Action undone',
  };
  let loaded = false;
  let pending = false;
  let cursor = null;
  let seenIds = new Set();

  function description(event) {
    const metadata = event.metadata || {};
    const parts = [labels[event.type] || 'Link updated'];
    if (metadata.fromStatus && metadata.toStatus && metadata.fromStatus !== metadata.toStatus) {
      parts.push(`Status: ${metadata.fromStatus} to ${metadata.toStatus}`);
    }
    const changed = metadata.changedFields || [];
    if (changed.includes('notes') && event.type !== 'note_updated') parts.push('Notes changed');
    if (changed.includes('saveReason') && event.type !== 'save_reason_updated') parts.push('Save reason changed');
    if (event.type === 'snoozed') parts[0] = metadata.remindAt
      ? `Snoozed until ${formatter.format(new Date(metadata.remindAt))} (Bangkok)` : 'Reminder cleared';
    return parts.join('. ') + '.';
  }

  function appendEvents(events) {
    const newEvents = events.filter(event => !seenIds.has(event.id));
    for (const event of newEvents) {
      const row = document.createElement('li');
      const text = document.createElement('p');
      text.textContent = description(event);
      const timestamp = document.createElement('time');
      timestamp.dateTime = event.occurredAt;
      timestamp.textContent = `${formatter.format(new Date(event.occurredAt))} (Bangkok)`;
      row.append(text, timestamp);
      list.appendChild(row);
      seenIds = new Set([...seenIds, event.id]);
    }
  }

  async function loadPage(restoreFocus = false) {
    if (pending) return;
    pending = true;
    more.disabled = true;
    retry.hidden = true;
    list.setAttribute('aria-busy', 'true');
    setMessage(status, 'Loading history...');
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) params.set('cursor', cursor);
      const response = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/history?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load history');
      appendEvents(data.events || []);
      cursor = data.nextCursor || null;
      loaded = true;
      more.hidden = !cursor;
      setMessage(status, list.children.length ? '' : 'No history yet. Recording begins after this feature is enabled.');
    } catch (error) {
      setMessage(status, error.message, 'error');
      retry.hidden = false;
    } finally {
      pending = false;
      more.disabled = false;
      list.setAttribute('aria-busy', 'false');
      if (restoreFocus) (retry.hidden ? (more.hidden ? summary : more) : retry).focus();
    }
  }

  section.hidden = false;
  section.addEventListener('toggle', () => {
    if (section.open && !loaded) return loadPage();
  });
  more.addEventListener('click', () => loadPage(true));
  retry.addEventListener('click', () => loadPage(true));
})();
