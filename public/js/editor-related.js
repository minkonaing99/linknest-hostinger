'use strict';

(() => {
  const { apiFetch, queryParam, setMessage } = window.LinkNest;
  const linkId = queryParam('id');
  const section = document.getElementById('related-links');
  if (!linkId || !section) return;

  const elements = {
    toggle: document.getElementById('related-add-toggle'),
    panel: document.getElementById('related-search-panel'),
    search: document.getElementById('related-search'),
    results: document.getElementById('related-search-results'),
    list: document.getElementById('related-list'),
    viewAll: document.getElementById('related-view-all'),
    status: document.getElementById('related-status'),
    suggestions: document.getElementById('suggestions-list'),
    suggestionStatus: document.getElementById('suggestions-status'),
    suggestionRetry: document.getElementById('suggestions-retry'),
    suggestionHeading: document.getElementById('suggestions-heading'),
  };
  let relatedLinks = [];
  let expanded = false;
  let searchTimer;
  let searchRequest = 0;
  let suggestions = [];
  let suggestionRequest = 0;
  let skippedIds = new Set();
  let pendingIds = new Set();
  let relatedRequest = 0;

  function actionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function linkLabel(link) {
    const label = document.createElement('span');
    const title = document.createElement('strong');
    const host = document.createElement('small');
    title.textContent = link.title || link.url;
    try { host.textContent = new URL(link.url).hostname.replace(/^www\./, ''); }
    catch { host.textContent = link.url; }
    label.append(title, host);
    return label;
  }

  async function removeLink(relatedId) {
    try {
      const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/related/${encodeURIComponent(relatedId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove related link');
      relatedRequest += 1;
      relatedLinks = relatedLinks.filter(link => link.id !== relatedId);
      renderRelated();
      (elements.list.querySelector('button') || (!elements.viewAll.hidden ? elements.viewAll : elements.toggle)).focus();
      setMessage(elements.status, 'Related link removed.', 'success');
      await loadSuggestions();
    } catch (error) { setMessage(elements.status, error.message, 'error'); }
  }

  function renderRelated() {
    elements.list.replaceChildren();
    const visible = expanded ? relatedLinks : relatedLinks.slice(0, 3);
    for (const link of visible) {
      const row = document.createElement('div');
      row.className = 'related-row';
      const anchor = document.createElement('a');
      anchor.href = `/editor.html?id=${encodeURIComponent(link.id)}`;
      anchor.appendChild(linkLabel(link));
      const remove = actionButton('Remove', 'button button--ghost button--small', () => removeLink(link.id));
      row.append(anchor, remove);
      elements.list.appendChild(row);
    }
    elements.viewAll.hidden = relatedLinks.length <= 3;
    elements.viewAll.setAttribute('aria-expanded', String(expanded));
    elements.viewAll.textContent = expanded ? 'Show less' : `View all (${relatedLinks.length})`;
    if (!relatedLinks.length) setMessage(elements.status, 'No related links yet.');
    renderSuggestions();
  }

  async function addLink(relatedId, fromSuggestion = false) {
    if (pendingIds.has(relatedId)) return;
    pendingIds = new Set([...pendingIds, relatedId]);
    renderSuggestions();
    const message = fromSuggestion ? elements.suggestionStatus : elements.status;
    try {
      const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/related`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedId }),
      });
      const data = await res.json();
      const alreadyConnected = res.status === 409;
      if (alreadyConnected) {
        await loadRelated();
        if (!relatedLinks.some(link => link.id === relatedId)) throw new Error('Could not confirm this connection. Try again.');
      } else {
        if (!res.ok) throw new Error(data.error || 'Could not add related link');
        relatedRequest += 1;
        relatedLinks = [...relatedLinks.filter(link => link.id !== data.link.id), data.link];
        await loadRelated();
      }
      elements.search.value = '';
      elements.results.replaceChildren();
      renderRelated();
      const refreshed = await loadSuggestions();
      if (!fromSuggestion || refreshed) setMessage(message, alreadyConnected ? 'Already connected.' : 'Related link added.', 'success');
    } catch (error) { setMessage(message, error.message, 'error'); }
    finally {
      pendingIds = new Set([...pendingIds].filter(id => id !== relatedId));
      renderSuggestions();
      if (fromSuggestion) focusSuggestion();
    }
  }

  function focusSuggestion() {
    (elements.suggestions.querySelector('button') || elements.suggestionHeading).focus();
  }

  function renderSuggestions() {
    const connected = new Set(relatedLinks.map(link => link.id));
    elements.suggestions.replaceChildren();
    for (const item of suggestions.filter(item => !connected.has(item.link.id) && !skippedIds.has(item.link.id))) {
      const row = document.createElement('div');
      row.className = 'related-row suggestion-row';
      const anchor = document.createElement('a');
      anchor.href = `/editor.html?id=${encodeURIComponent(item.link.id)}`;
      const reason = document.createElement('small');
      reason.className = 'suggestion-reason';
      reason.textContent = item.reason;
      anchor.append(linkLabel(item.link), reason);
      const actions = document.createElement('div');
      actions.className = 'suggestion-actions';
      const connect = actionButton('Connect', 'button button--ghost button--small', () => addLink(item.link.id, true));
      const skip = actionButton('Skip for now', 'button button--ghost button--small', () => {
        skippedIds = new Set([...skippedIds, item.link.id]);
        renderSuggestions();
        focusSuggestion();
      });
      connect.disabled = pendingIds.has(item.link.id);
      skip.disabled = connect.disabled;
      connect.setAttribute('aria-label', `Connect ${item.link.title || item.link.url}`);
      skip.setAttribute('aria-label', `Skip ${item.link.title || item.link.url} for now`);
      actions.append(connect, skip);
      row.append(anchor, actions);
      elements.suggestions.appendChild(row);
    }
  }

  async function loadSuggestions() {
    const requestId = ++suggestionRequest;
    elements.suggestionRetry.hidden = true;
    setMessage(elements.suggestionStatus, 'Finding suggested connections...');
    try {
      const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/suggestions`);
      const data = await res.json();
      if (requestId !== suggestionRequest) return false;
      if (!res.ok) throw new Error(data.error || 'Could not load suggested connections');
      suggestions = [...(data.suggestions || [])].slice(0, 5);
      renderSuggestions();
      setMessage(elements.suggestionStatus, elements.suggestions.children.length ? '' : 'No suggested connections right now.');
      return true;
    } catch (error) {
      if (requestId !== suggestionRequest) return false;
      setMessage(elements.suggestionStatus, error.message, 'error');
      elements.suggestionRetry.hidden = false;
      return false;
    }
  }

  async function searchLinks() {
    const query = elements.search.value.trim();
    const requestId = ++searchRequest;
    elements.results.replaceChildren();
    if (!query) return;
    try {
      const params = new URLSearchParams({ q: query, limit: '10' });
      const res = await apiFetch(`/api/links?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      if (requestId !== searchRequest || query !== elements.search.value.trim()) return;
      const relatedIds = new Set(relatedLinks.map(link => link.id));
      const matches = (data.links || []).filter(link => link.id !== linkId && !relatedIds.has(link.id));
      for (const link of matches) {
        const button = actionButton('', 'related-search__result', () => addLink(link.id));
        button.setAttribute('aria-label', `Add ${link.title || link.url}`);
        button.appendChild(linkLabel(link));
        elements.results.appendChild(button);
      }
      if (!matches.length) setMessage(elements.status, 'No available links found.');
    } catch (error) { setMessage(elements.status, error.message, 'error'); }
  }

  async function loadRelated() {
    const requestId = ++relatedRequest;
    const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/related`);
    const data = await res.json();
    if (requestId !== relatedRequest) return;
    if (!res.ok) throw new Error(data.error || 'Could not load related links');
    relatedLinks = [...(data.links || [])];
    renderRelated();
  }

  section.hidden = false;
  elements.toggle.addEventListener('click', () => {
    elements.panel.hidden = !elements.panel.hidden;
    elements.toggle.setAttribute('aria-expanded', String(!elements.panel.hidden));
    if (!elements.panel.hidden) elements.search.focus();
  });
  elements.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchLinks, 200);
  });
  elements.viewAll.addEventListener('click', () => {
    expanded = !expanded;
    renderRelated();
  });
  loadRelated().catch(error => setMessage(elements.status, error.message, 'error'));
  elements.suggestionRetry.addEventListener('click', loadSuggestions);
  loadSuggestions();
})();
