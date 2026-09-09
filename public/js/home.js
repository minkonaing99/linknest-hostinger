const { safeHost, apiFetch, setMessage, thailandDateString: thailandDate } = window.LinkNest;

const recentLinks = document.getElementById('recent-links');
const reviewLinks = document.getElementById('review-links');
const reviewBadge = document.getElementById('review-badge');
const revisitSummary = document.getElementById('revisit-summary');
const librarySummary = document.getElementById('library-summary');
const template = document.getElementById('link-template');
const quickAddForm = document.getElementById('quick-add-form');
const quickAddUrl = document.getElementById('quick-add-url');
const quickAddPaste = document.getElementById('quick-add-paste');
const quickAddMessage = document.getElementById('quick-add-message');

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function emptyState(text) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = text;
  return empty;
}

function isDue(item) {
  return item.remindAt && Date.parse(item.remindAt) <= Date.now();
}

function closeHomeMenus() {
  document.querySelectorAll('.row-menu__popover').forEach(menu => menu.classList.add('hidden'));
  document.querySelectorAll('.row-menu__trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('.row-menu').forEach(menu => menu.classList.remove('is-open'));
  document.querySelectorAll('.recent-row').forEach(row => row.classList.remove('is-menu-open'));
}

function fillLinkRow(node, item) {
  node.querySelector('.link-date').textContent = item.date
    || (item.createdAt ? thailandDate(item.createdAt) : 'Unknown date');
  node.querySelector('.link-host').textContent = item.host || safeHost(item.url);
  applyStatusStyles(node.querySelector('.status-dot'), node.querySelector('.status-text'), item.status);

  const rawTitle = item.title || item.url;
  const title = node.querySelector('.recent-row__title');
  title.textContent = rawTitle;
  title.href = item.url;
  title.title = rawTitle;
  title.addEventListener('click', () => trackOpen(item));

  const favoriteButton = node.querySelector('.favorite-button');
  favoriteButton.textContent = item.pinned ? 'Remove from Favorites' : 'Add to Favorites';
  favoriteButton.addEventListener('click', async event => {
    event.stopPropagation();
    try {
      const res = await apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !item.pinned }),
      });
      if (!res.ok) throw new Error('Failed to update pin');
      closeHomeMenus();
      await loadHome();
    } catch (error) {
      window.LinkNest.showToast(error.message);
    }
  });

  const menu = node.querySelector('.row-menu');
  const trigger = menu.querySelector('.row-menu__trigger');
  const popover = menu.querySelector('.row-menu__popover');
  const row = node.querySelector('.recent-row');
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeHomeMenus();
    popover.classList.toggle('hidden', !willOpen);
    trigger.setAttribute('aria-expanded', String(willOpen));
    menu.classList.toggle('is-open', willOpen);
    row.classList.toggle('is-menu-open', willOpen);
  });
  popover.addEventListener('click', event => event.stopPropagation());
  return node;
}

function trackOpen(item) {
  apiFetch(`/api/links/${encodeURIComponent(item.id)}/opened`, { method: 'POST' }).catch(() => {});
}

function renderRecent(items) {
  recentLinks.innerHTML = '';
  if (!items.length) {
    recentLinks.appendChild(emptyState('No links saved yet.'));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = template.content.cloneNode(true);
    fillLinkRow(node, item);
    const edit = node.querySelector('.home-edit-link');
    edit.href = `/editor.html?id=${encodeURIComponent(item.id)}`;
    fragment.appendChild(node);
  }
  recentLinks.appendChild(fragment);
}

function renderReview(items) {
  reviewLinks.innerHTML = '';
  reviewBadge.classList.toggle('hidden', items.length === 0);
  reviewBadge.textContent = String(items.length);
  if (!items.length) {
    reviewLinks.appendChild(emptyState('Nothing ready for review.'));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = template.content.cloneNode(true);
    fillLinkRow(node, item);
    if (isDue(item)) node.querySelector('.status-text').textContent = 'due';
    const decide = node.querySelector('.home-edit-link');
    decide.setAttribute('aria-label', 'Review link');
    decide.textContent = 'Review';
    decide.href = '/browse.html?review=1';
    fragment.appendChild(node);
  }
  reviewLinks.appendChild(fragment);
}

async function fetchTitleMetadata(rawUrl) {
  const res = await apiFetch(`/api/fetch-title?url=${encodeURIComponent(rawUrl)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not fetch title');
  return data;
}

function renderStats(stats) {
  const revisit = stats.revisit || {};
  if (revisit.buildingBaseline || revisit.current?.rate == null) {
    revisitSummary.textContent = 'Building baseline';
  } else {
    const change = revisit.percentagePointChange;
    const comparison = change == null ? '' : `, ${change >= 0 ? '+' : ''}${change} pp vs previous`;
    const target = revisit.targetRate == null ? '' : `, target ${revisit.targetRate}%`;
    revisitSummary.textContent = `${revisit.current.rate}% meaningfully revisited${comparison}${target}`;
  }
  librarySummary.textContent = `${stats.total || 0} active links, ${stats.unread || 0} unread, ${stats.useful || 0} useful`;
}

async function loadHome() {
  apiFetch('/api/stats').then(async res => {
    if (res.ok) renderStats(await res.json());
  }).catch(() => {});

  const [reviewRes, recentRes] = await Promise.all([
    apiFetch('/api/links/review'),
    apiFetch('/api/links?limit=5&sort=createdAt&order=desc&youtube=exclude'),
  ]);
  const [review, recent] = await Promise.all([reviewRes.json(), recentRes.json()]);
  if (!reviewRes.ok || !recentRes.ok) throw new Error('Failed to load home');
  renderReview(review.links || []);
  renderRecent(recent.links || []);
}

async function saveQuickAdd(rawUrl) {
  if (!rawUrl) {
    setMessage(quickAddMessage, 'Paste a URL first.', 'error');
    return;
  }

  quickAddUrl.disabled = true;
  quickAddPaste.disabled = true;
  setMessage(quickAddMessage, 'Fetching title...');

  try {
    const metadata = await fetchTitleMetadata(rawUrl);
    setMessage(quickAddMessage, 'Saving link...');

    const res = await apiFetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: metadata.url || rawUrl,
        title: metadata.title || metadata.url || rawUrl,
        date: thailandDate(),
        status: 'saved',
        tags: [],
        pinned: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save link');

    quickAddForm.reset();
    setMessage(quickAddMessage, 'Link saved.', 'success');
    await loadHome();
  } catch (error) {
    setMessage(quickAddMessage, error.message, 'error');
  } finally {
    quickAddUrl.disabled = false;
    quickAddPaste.disabled = false;
  }
}

quickAddForm.addEventListener('submit', async event => {
  event.preventDefault();
  await saveQuickAdd(quickAddUrl.value.trim());
});

quickAddPaste.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    setMessage(quickAddMessage, 'Clipboard read is not supported in this browser.', 'error');
    return;
  }

  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setMessage(quickAddMessage, 'Clipboard is empty.', 'error');
      return;
    }

    let url;
    try {
      url = new URL(text).toString();
    } catch {
      setMessage(quickAddMessage, 'Clipboard does not contain a valid link.', 'error');
      return;
    }

    quickAddUrl.value = url;
    await saveQuickAdd(url);
  } catch {
    setMessage(quickAddMessage, 'Clipboard permission denied or unavailable.', 'error');
  }
});

document.addEventListener('click', closeHomeMenus);

if (window.LinkNest.initPullToRefresh) {
  window.LinkNest.initPullToRefresh(() => loadHome());
}

loadHome().catch(console.error);
