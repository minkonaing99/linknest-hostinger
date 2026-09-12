const LIMIT = 50;
const SWIPE_THRESHOLD = 64;
const STATUS_CYCLE = ['saved', 'unread', 'useful'];

const initialReview = new URLSearchParams(window.location.search).get('review') === '1';
const initialYoutube = new URLSearchParams(window.location.search).get('youtube') === '1';
const state = { links: [], page: 1, totalPages: 1, total: 0, loading: false, requestId: 0, selectMode: false, selected: new Set(), quickFilter: initialReview ? 'review' : (initialYoutube ? 'youtube' : null), tagFilter: null, reviewSession: null };

const SORT_MAP = {
  recent:       { sort: 'updatedAt', order: 'desc' },
  'date-asc':   { sort: 'date',      order: 'asc'  },
  'title-asc':  { sort: 'title',     order: 'asc'  },
  'title-desc': { sort: 'title',     order: 'desc' },
};

const linkList          = document.getElementById('link-list');
const template          = document.getElementById('link-template');
const totalCount        = document.getElementById('total-count');
const visibleCount      = document.getElementById('visible-count');
const searchInput       = document.getElementById('search');
const statusFilter      = document.getElementById('status-filter');
const sortModeSelect    = document.getElementById('sort-mode');
const sentinel          = document.getElementById('scroll-sentinel');
const bulkBar           = document.getElementById('bulk-bar');
const bulkCount         = document.getElementById('bulk-count');
const bulkSelectAllBtn  = document.getElementById('bulk-select-all');
const bulkDeleteBtn     = document.getElementById('bulk-delete-btn');
const bulkCancelBtn     = document.getElementById('bulk-cancel-btn');
const selectToggleBtn   = document.getElementById('select-toggle-btn');
const bulkStatusSelect  = document.getElementById('bulk-status-select');
const tagChipsContainer = document.getElementById('tag-chips');
const reviewProgress    = document.getElementById('review-progress');
const libraryCounts     = document.getElementById('library-counts');

document.body.classList.toggle('is-youtube-view', state.quickFilter === 'youtube');
document.body.classList.toggle('is-review-view', state.quickFilter === 'review');

function updateReviewProgress() {
  const session = state.reviewSession;
  const reviewing = state.quickFilter === 'review';
  linkList.tabIndex = reviewing ? 0 : -1;
  linkList.toggleAttribute('role', reviewing);
  linkList.toggleAttribute('aria-label', reviewing);
  if (reviewing) {
    linkList.setAttribute('role', 'region');
    linkList.setAttribute('aria-label', 'Review queue');
    linkList.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp N O');
  } else {
    linkList.removeAttribute('aria-keyshortcuts');
  }
  reviewProgress.classList.toggle('hidden', !reviewing || !session?.total);
  libraryCounts.classList.toggle('hidden', reviewing);
  if (!reviewing || !session?.total) return;
  const current = Math.min(session.resolved.size + 1, session.total);
  reviewProgress.textContent = `Review ${current} of ${session.total}`;
}

function renderReviewComplete() {
  linkList.textContent = '';
  const complete = document.createElement('div');
  complete.className = 'review-complete';
  complete.tabIndex = -1;
  const heading = document.createElement('h3');
  heading.textContent = 'Review complete';
  const copy = document.createElement('p');
  copy.textContent = `You made a decision on all ${state.reviewSession.total} links.`;
  const back = document.createElement('a');
  back.className = 'button button--ghost';
  back.href = '/browse.html';
  back.textContent = 'Back to library';
  complete.append(heading, copy, back);
  linkList.appendChild(complete);
  complete.focus();
}

function resolveReviewItem(id) {
  if (state.quickFilter !== 'review' || !state.reviewSession) return;
  const resolved = new Set([...state.reviewSession.resolved, id]);
  state.reviewSession = { ...state.reviewSession, resolved };
  state.links = state.links.filter(link => link.id !== id);
  state.total = state.links.length;
  updateReviewProgress();
  if (resolved.size === state.reviewSession.total) renderReviewComplete();
  else render(state.links);
}

function hasMeaningfulRevisit(entry) {
  const createdAt = Date.parse(entry?.createdAt);
  const meaningfulAt = Date.parse(entry?.firstMeaningfulAt);
  return Number.isFinite(createdAt)
    && Number.isFinite(meaningfulAt)
    && meaningfulAt - createdAt >= 24 * 60 * 60 * 1000;
}

function beginRowAction(row) {
  if (row.getAttribute('aria-busy') === 'true') return false;
  row.setAttribute('aria-busy', 'true');
  return true;
}

function endRowAction(row) {
  row.removeAttribute('aria-busy');
}

function handleReviewShortcut(event) {
  if (state.quickFilter !== 'review' || event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
  const shortcuts = {
    ArrowLeft: '.delete-button',
    ArrowRight: '.mark-useful-button',
    ArrowUp: '.snooze-week-button',
    n: '.edit-link',
    o: '.library-row__title',
  };
  const row = event.target.closest('.library-row') || linkList.querySelector('.library-row');
  if (!row || row.getAttribute('aria-busy') === 'true') return;
  const selector = shortcuts[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  const control = selector && row.querySelector(selector);
  if (!control || control.classList.contains('hidden')) return;
  event.preventDefault();
  control.click();
}

function setupReviewSwipe(row) {
  let gesture = null;
  let suppressClick = false;
  const reset = () => {
    gesture = null;
    row.classList.remove('is-swiping');
    row.style.removeProperty('--swipe-x');
  };
  row.addEventListener('pointerdown', event => {
    if (state.quickFilter !== 'review' || !event.isPrimary) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (row.getAttribute('aria-busy') === 'true') return;
    if (event.target.closest('a, button, input, textarea, select, label, [contenteditable], .row-menu, .review-note-panel')) return;
    const verticalHandle = Boolean(event.target.closest('.library-row__status'));
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, verticalHandle };
    row.setPointerCapture(event.pointerId);
  });
  row.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture = { ...gesture, dx, dy };
    if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    row.classList.add('is-swiping');
    row.style.setProperty('--swipe-x', `${Math.max(-96, Math.min(96, dx))}px`);
  });
  row.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    let selector = null;
    if (dx <= -SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.25) selector = '.delete-button';
    else if (dx >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.25) selector = '.mark-useful-button';
    else if (gesture.verticalHandle && dy <= -SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx) * 1.25) selector = '.snooze-week-button';
    reset();
    if (!selector || row.getAttribute('aria-busy') === 'true') return;
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 400);
    row.querySelector(selector)?.click();
  });
  row.addEventListener('pointercancel', reset);
  row.addEventListener('lostpointercapture', reset);
  row.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }, true);
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.className = 'status-dot';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function groupLabel(dateString) {
  if (!dateString) return 'Unknown date';
  const today = Date.now();
  const todayStr = window.LinkNest.thailandDateString(today);
  const yesterdayStr = window.LinkNest.thailandDateString(today - 24 * 60 * 60 * 1000);
  if (dateString === todayStr) return 'Today';
  if (dateString === yesterdayStr) return 'Yesterday';
  return `Earlier · ${dateString}`;
}

async function togglePinned(item) {
  const nextPinned = !item.pinned;
  const res = await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: nextPinned }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update pin state');
  }
  item.pinned = nextPinned;
}

async function updateLinkFields(item, fields) {
  const res = await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to update link');
  if (state.quickFilter === 'review') {
    const updated = data.entry || { ...item, ...fields };
    state.links = state.links.map(link => link.id === item.id ? updated : link);
  } else {
    await fetchPage(1);
  }
  window.LinkNest.updateUnreadBadge();
  return data.entry;
}

function closeAllMenus() {
  document.querySelectorAll('.row-menu__popover').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.row-menu__trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('.row-menu').forEach(m => m.classList.remove('is-open'));
  document.querySelectorAll('.library-row').forEach(r => r.classList.remove('is-menu-open'));
}

function updateBulkBar() {
  const count = state.selected.size;
  bulkCount.textContent = `${count} selected`;
  bulkDeleteBtn.disabled = count === 0;
  const allIds = state.links.map(l => l.id);
  bulkSelectAllBtn.textContent = allIds.every(id => state.selected.has(id)) ? 'Deselect all' : 'Select all';
}

function enterSelectMode() {
  state.selectMode = true;
  state.selected.clear();
  document.body.classList.add('is-selecting');
  bulkBar.classList.remove('hidden');
  selectToggleBtn.textContent = 'Done';
  updateBulkBar();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  document.body.classList.remove('is-selecting');
  bulkBar.classList.add('hidden');
  selectToggleBtn.textContent = 'Select';
  document.querySelectorAll('.library-row.is-selected').forEach(r => r.classList.remove('is-selected'));
}

async function bulkDelete() {
  if (!state.selected.size) return;
  const ids = [...state.selected];
  await Promise.all(ids.map(id => window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' })));
  exitSelectMode();
  await fetchPage(state.page);
  window.LinkNest.updateUnreadBadge();
}

async function bulkChangeStatus(status) {
  if (!state.selected.size || !status) return;
  const ids = [...state.selected];
  try {
    const res = await window.LinkNest.apiFetch('/api/links/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
  } catch (err) {
    window.LinkNest.showToast(err.message);
  }
  exitSelectMode();
  await fetchPage(state.page);
  window.LinkNest.updateUnreadBadge();
}

async function loadTagChips() {
  if (!tagChipsContainer) return;
  try {
    const res = await window.LinkNest.apiFetch('/api/tags?limit=15');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.tags || !data.tags.length) return;
    tagChipsContainer.innerHTML = '';
    for (const { tag } of data.tags) {
      const chip = document.createElement('span');
      chip.className = 'badge tag tag-chip';
      chip.textContent = tag;
      chip.dataset.tag = tag;
      chip.addEventListener('click', () => {
        const isActive = chip.classList.contains('is-active');
        tagChipsContainer.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('is-active'));
        if (isActive) {
          state.tagFilter = null;
        } else {
          chip.classList.add('is-active');
          state.tagFilter = tag;
        }
        fetchPage(1);
      });
      tagChipsContainer.appendChild(chip);
    }
    tagChipsContainer.classList.remove('hidden');
  } catch {
    // non-critical — chips are a progressive enhancement
  }
}

function setupReviewNote(node, item, editLink) {
  const panel = node.querySelector('.review-note-panel');
  const reviewNoteInput = node.querySelector('.review-note-input');
  const save = node.querySelector('.review-note-save');
  const cancel = node.querySelector('.review-note-cancel');
  const close = () => {
    panel.classList.add('hidden');
    editLink.focus();
  };
  editLink.addEventListener('click', event => {
    if (state.quickFilter !== 'review') return;
    event.preventDefault();
    closeAllMenus();
    reviewNoteInput.value = item.notes || '';
    panel.classList.remove('hidden');
    reviewNoteInput.focus();
  });
  cancel.addEventListener('click', close);
  reviewNoteInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  save.addEventListener('click', async () => {
    const notes = reviewNoteInput.value.trim();
    if (notes === String(item.notes || '').trim()) return window.LinkNest.showToast('Note unchanged');
    save.disabled = true;
    try {
      const updated = await updateLinkFields(item, { notes });
      if (hasMeaningfulRevisit(updated)) resolveReviewItem(item.id);
      else {
        panel.classList.add('hidden');
        window.LinkNest.showToast('This note is saved, but it is too early to count as reviewed');
      }
    } catch (err) {
      window.LinkNest.showToast(err.message);
      save.disabled = false;
    }
  });
}

function buildRow(item) {
  const node = template.content.cloneNode(true);

  const rowArticle = node.querySelector('.library-row');
  setupReviewSwipe(rowArticle);
  if (state.selected.has(item.id)) rowArticle.classList.add('is-selected');
  rowArticle.classList.toggle('is-pinned', Boolean(item.pinned));

  // In select mode: whole row is a toggle; block link navigation
  rowArticle.addEventListener('click', e => {
    if (!state.selectMode) return;
    e.preventDefault();
    const nowSelected = !state.selected.has(item.id);
    if (nowSelected) { state.selected.add(item.id); rowArticle.classList.add('is-selected'); }
    else             { state.selected.delete(item.id); rowArticle.classList.remove('is-selected'); }
    updateBulkBar();
  });

  const host = item.host || safeHost(item.url);
  node.querySelector('.link-host').textContent = host;
  node.querySelector('.link-date').textContent = item.date || 'Unknown date';

  const statusDot = node.querySelector('.status-dot');
  const statusText = node.querySelector('.status-text');
  let currentStatus = item.status || 'saved';
  applyStatusStyles(statusDot, statusText, item.status);

  statusDot.title = 'Click to change status';
  statusDot.addEventListener('click', async event => {
    event.stopPropagation();
    if (state.selectMode || !beginRowAction(rowArticle)) return;
    const idx = STATUS_CYCLE.indexOf(currentStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    statusDot.classList.add('status-dot--transitioning');
    try {
      const res = await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, status: next }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      currentStatus = next;
      applyStatusStyles(statusDot, statusText, next);
      window.LinkNest.updateUnreadBadge();
      if (state.quickFilter === 'review' && next === 'useful') resolveReviewItem(item.id);
    } catch (err) {
      window.LinkNest.showToast(err.message);
    } finally {
      statusDot.classList.remove('status-dot--transitioning');
      endRowAction(rowArticle);
    }
  });

  const favoriteButton = node.querySelector('.favorite-button');
  favoriteButton.textContent = item.pinned ? 'Remove from Favorites' : 'Add to Favorites';
  favoriteButton.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      await togglePinned(item);
      rowArticle.classList.toggle('is-pinned', item.pinned);
      favoriteButton.textContent = item.pinned ? 'Remove from Favorites' : 'Add to Favorites';
      closeAllMenus();
    } catch (err) { window.LinkNest.showToast(err.message); }
  });

  const thumbnail = node.querySelector('.link-thumbnail');
  if (item.thumbnailUrl) {
    thumbnail.src = item.thumbnailUrl;
    thumbnail.classList.remove('hidden');
    rowArticle.classList.add('has-thumbnail');
    thumbnail.addEventListener('error', () => {
      thumbnail.classList.add('hidden');
      rowArticle.classList.remove('has-thumbnail');
    }, { once: true });
  }

  const titleEl = node.querySelector('.library-row__title');
  const rawTitle = item.title || item.url;
  titleEl.textContent = rawTitle;
  titleEl.href = item.url;
  titleEl.title = rawTitle;
  titleEl.addEventListener('click', () => {
    window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}/opened`, { method: 'POST' }).catch(() => {});
  });

  const notesEl = node.querySelector('.library-row__notes');
  if (item.notes) {
    notesEl.textContent = item.notes;
    notesEl.classList.remove('hidden');
  }

  const tagRow = node.querySelector('.library-row__tags');
  if (item.tags?.length) {
    tagRow.classList.remove('hidden');
    for (const tag of item.tags) {
      const el = document.createElement('span');
      el.className = 'badge tag';
      el.textContent = tag;
      el.addEventListener('click', event => {
        event.preventDefault();
        searchInput.value = tag;
        fetchPage(1);
        searchInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      tagRow.appendChild(el);
    }
  }

  const editLink = node.querySelector('.edit-link');
  const returnTo = state.quickFilter === 'review'
    ? '&returnTo=%2Fbrowse.html%3Freview%3D1'
    : (state.quickFilter === 'youtube' ? '&returnTo=%2Fbrowse.html%3Fyoutube%3D1' : '');
  editLink.href = `/editor.html?id=${encodeURIComponent(item.id)}${returnTo}#notes`;
  editLink.textContent = item.notes ? 'Edit note' : 'Add note';

  setupReviewNote(node, item, editLink);

  const usefulButton = node.querySelector('.mark-useful-button');
  usefulButton.classList.toggle('hidden', item.status === 'useful');
  usefulButton.addEventListener('click', async event => {
    event.stopPropagation();
    if (!beginRowAction(rowArticle)) return;
    try {
      await updateLinkFields(item, { status: 'useful' });
      resolveReviewItem(item.id);
    }
    catch (err) { window.LinkNest.showToast(err.message); }
    finally { endRowAction(rowArticle); }
  });

  node.querySelector('.snooze-week-button').addEventListener('click', async event => {
    event.stopPropagation();
    if (!beginRowAction(rowArticle)) return;
    const remindAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await updateLinkFields(item, { remindAt });
      window.LinkNest.showToast('Snoozed. Add a note, mark useful, or archive to finish review.', 'success');
    }
    catch (err) { window.LinkNest.showToast(err.message); }
    finally { endRowAction(rowArticle); }
  });

  node.querySelector('.row-menu__date').addEventListener('change', async event => {
    event.stopPropagation();
    if (!event.target.value) return;
    if (!beginRowAction(rowArticle)) return;
    const remindAt = new Date(`${event.target.value}T00:00:00`).toISOString();
    try {
      await updateLinkFields(item, { remindAt });
      window.LinkNest.showToast('Snoozed. Add a note, mark useful, or archive to finish review.', 'success');
    }
    catch (err) { window.LinkNest.showToast(err.message); }
    finally { endRowAction(rowArticle); }
  });

  node.querySelector('.delete-button').addEventListener('click', async event => {
    event.stopPropagation();
    if (!beginRowAction(rowArticle)) return;
    try {
      await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      window.LinkNest.showToast('Moved to archive', 'success');
      closeAllMenus();
      if (state.quickFilter === 'review') {
        resolveReviewItem(item.id);
        return;
      }
      const group = rowArticle.closest('.date-group');
      rowArticle.remove();
      if (!group.querySelector('.library-row')) group.remove();
      state.links = state.links.filter(link => link.id !== item.id);
      state.total = Math.max(0, state.total - 1);
      totalCount.textContent = String(state.total);
      visibleCount.textContent = String(state.links.length);
    } catch (err) {
      window.LinkNest.showToast(err.message);
    } finally {
      endRowAction(rowArticle);
    }
  });

  const menu    = node.querySelector('.row-menu');
  const trigger = menu.querySelector('.row-menu__trigger');
  const popover = menu.querySelector('.row-menu__popover');
  const row     = node.querySelector('.library-row');

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllMenus();
    popover.classList.toggle('hidden', !willOpen);
    trigger.setAttribute('aria-expanded', String(willOpen));
    menu.classList.toggle('is-open', willOpen);
    row.classList.toggle('is-menu-open', willOpen);
  });
  popover.addEventListener('click', event => event.stopPropagation());

  return node;
}

function render(items, append = false) {
  totalCount.textContent = String(state.total);
  visibleCount.textContent = String(state.links.length);

  if (!append) {
    linkList.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.quickFilter === 'review' ? 'Nothing ready for review.' : 'No links match your current filters.';
      linkList.appendChild(empty);
      return;
    }
  }

  const grouped = new Map();
  for (const item of items) {
    const label = state.quickFilter === 'review'
      ? 'Review queue'
      : (item.pinned ? 'Pinned' : groupLabel(item.date));
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(item);
  }

  for (const [label, groupItems] of grouped) {
    let wrapper = null;
    if (append) {
      for (const el of linkList.querySelectorAll('.date-group')) {
        if (el.querySelector('.date-group__header')?.textContent === label) {
          wrapper = el;
          break;
        }
      }
    }
    if (!wrapper) {
      wrapper = document.createElement('section');
      wrapper.className = label === 'Pinned' ? 'date-group date-group--pinned' : 'date-group';
      const header = document.createElement('div');
      header.className = 'date-group__header';
      header.textContent = label;
      wrapper.appendChild(header);
      linkList.appendChild(wrapper);
    }
    for (const item of groupItems) wrapper.appendChild(buildRow(item));
  }
}

function buildApiParams(page, quickFilter = state.quickFilter) {
  const params = new URLSearchParams({ page, limit: LIMIT });
  const q = searchInput.value.trim();
  const status = statusFilter.value;
  const { sort, order } = SORT_MAP[sortModeSelect.value] || SORT_MAP.recent;
  if (q) params.set('q', q);
  if (state.tagFilter) params.set('tag', state.tagFilter);
  if (status !== 'all') params.set('status', status);
  params.set('sort', sort);
  params.set('order', order);

  if (quickFilter === 'remind') {
    params.set('remindBefore', new Date().toISOString());
  }
  if (quickFilter === 'youtube') params.set('youtube', 'only');
  else params.set('youtube', 'exclude');

  return params;
}

function showSkeleton() {
  linkList.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('div');
    el.className = 'skeleton-row';
    linkList.appendChild(el);
  }
}

async function fetchPage(page, append = false) {
  if (append && state.loading) return;
  if (state.quickFilter === 'review' && state.reviewSession) {
    render(state.links);
    return;
  }
  const requestedFilter = state.quickFilter;
  const requestId = ++state.requestId;
  state.loading = true;
  if (!append) showSkeleton();

  try {
    const url = requestedFilter === 'review'
      ? '/api/links/review'
      : `/api/links?${buildApiParams(page, requestedFilter)}`;
    const res = await window.LinkNest.apiFetch(url);
    const data = await res.json();
    if (requestId !== state.requestId || requestedFilter !== state.quickFilter) return;
    if (!res.ok) throw new Error(data.error || 'Failed to load links');
    const newLinks = data.links || [];
    if (requestedFilter === 'review' && !state.reviewSession) {
      state.reviewSession = { total: newLinks.length, resolved: new Set() };
    }
    state.links = append ? [...state.links, ...newLinks] : newLinks;
    state.page = data.page || 1;
    state.totalPages = data.pages || 1;
    state.total = Number.isFinite(data.total) ? data.total : newLinks.length;
    updateReviewProgress();
    render(newLinks, append);
    if (requestedFilter === 'review') linkList.focus({ preventScroll: true });
  } catch (err) {
    if (requestId !== state.requestId || requestedFilter !== state.quickFilter) return;
    console.error(err);
    if (!append) linkList.innerHTML = '<div class="empty-state">Failed to load links. Please refresh.</div>';
  } finally {
    if (requestId === state.requestId) state.loading = false;
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('click', closeAllMenus);
linkList.addEventListener('keydown', handleReviewShortcut);
searchInput.addEventListener('input', debounce(() => {
  if (tagChipsContainer) {
    tagChipsContainer.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('is-active'));
  }
  state.tagFilter = null;
  fetchPage(1);
}, 300));
statusFilter.addEventListener('change', () => fetchPage(1));
sortModeSelect.addEventListener('change', () => fetchPage(1));

if (bulkStatusSelect) {
  bulkStatusSelect.addEventListener('change', async () => {
    const status = bulkStatusSelect.value;
    bulkStatusSelect.value = '';
    if (status) await bulkChangeStatus(status);
  });
}


selectToggleBtn.addEventListener('click', () => {
  if (state.selectMode) exitSelectMode();
  else enterSelectMode();
});

bulkCancelBtn.addEventListener('click', exitSelectMode);

bulkDeleteBtn.addEventListener('click', bulkDelete);

bulkSelectAllBtn.addEventListener('click', () => {
  const allIds = state.links.map(l => l.id);
  const allSelected = allIds.every(id => state.selected.has(id));
  const rows = document.querySelectorAll('.library-row');
  if (allSelected) {
    allIds.forEach(id => state.selected.delete(id));
    rows.forEach(r => r.classList.remove('is-selected'));
  } else {
    allIds.forEach(id => state.selected.add(id));
    rows.forEach(r => r.classList.add('is-selected'));
  }
  updateBulkBar();
});

document.querySelectorAll('.quick-filter-btn').forEach(btn => {
  btn.classList.toggle('is-active', btn.dataset.filter === state.quickFilter);
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter;
    const active = state.quickFilter === filter;
    state.quickFilter = active ? null : filter;
    state.reviewSession = null;
    document.body.classList.toggle('is-youtube-view', state.quickFilter === 'youtube');
    document.body.classList.toggle('is-review-view', state.quickFilter === 'review');
    document.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.toggle('is-active', b.dataset.filter === state.quickFilter));
    fetchPage(1);
  });
});

if (window.LinkNest.initPullToRefresh) {
  window.LinkNest.initPullToRefresh(() => fetchPage(1));
}

const scrollObserver = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && !state.loading && state.page < state.totalPages) {
    fetchPage(state.page + 1, true);
  }
}, { rootMargin: '200px' });

if (sentinel) scrollObserver.observe(sentinel);

fetchPage(1).catch(console.error);
loadTagChips().catch(() => {});
