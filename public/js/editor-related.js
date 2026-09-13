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
  };
  let relatedLinks = [];
  let expanded = false;
  let searchTimer;
  let searchRequest = 0;

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
      relatedLinks = relatedLinks.filter(link => link.id !== relatedId);
      renderRelated();
      (elements.list.querySelector('button') || (!elements.viewAll.hidden ? elements.viewAll : elements.toggle)).focus();
      setMessage(elements.status, 'Related link removed.', 'success');
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
  }

  async function addLink(relatedId) {
    try {
      const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/related`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add related link');
      relatedLinks = [...relatedLinks, data.link];
      elements.search.value = '';
      elements.results.replaceChildren();
      renderRelated();
      setMessage(elements.status, 'Related link added.', 'success');
    } catch (error) { setMessage(elements.status, error.message, 'error'); }
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
    const res = await apiFetch(`/api/links/${encodeURIComponent(linkId)}/related`);
    const data = await res.json();
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
})();
