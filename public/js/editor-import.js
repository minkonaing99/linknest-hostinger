'use strict';

(() => {
  const { apiFetch, setMessage } = window.LinkNest;
  const elements = {
    jsonFile: document.getElementById('json-file'),
    csvFile: document.getElementById('csv-file'),
    bookmarksFile: document.getElementById('bookmarks-file'),
    batchInput: document.getElementById('batch-input'),
    preview: document.getElementById('import-preview'),
    summary: document.getElementById('import-summary'),
    rows: document.getElementById('import-preview-rows'),
    limit: document.getElementById('import-preview-limit'),
    confirm: document.getElementById('import-confirm'),
    cancel: document.getElementById('import-cancel'),
    progress: document.getElementById('import-progress'),
    progressBar: document.getElementById('import-progress-bar'),
    progressText: document.getElementById('import-progress-text'),
    message: document.getElementById('import-message'),
  };
  if (!elements.preview) return;

  const MAX_IMPORT_FILE_BYTES = 512_000_000;
  let readyLinks = [], readyRelationships = [];

  function sourceButton(id, action) {
    document.getElementById(id)?.addEventListener('click', action);
  }

  async function fileText(input, label) {
    const file = input?.files?.[0];
    if (!file) throw new Error(`Choose a ${label} file first.`);
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('Import file must be 512 MB or smaller.');
    return file.text();
  }

  async function prepareBatch() {
    const text = elements.batchInput.value.trim();
    if (!text) throw new Error('Paste at least one line first.');
    const items = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const parts = line.split('|');
      return { url: (parts.shift() || '').trim(), title: parts.join('|').trim() };
    });
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].title || !items[index].url) continue;
      setMessage(elements.message, `Fetching titles ${index + 1}/${items.length}...`);
      try {
        const res = await apiFetch(`/api/fetch-title?url=${encodeURIComponent(items[index].url)}`);
        const data = await res.json();
        if (res.ok) items[index] = { ...items[index], url: data.url || items[index].url, title: data.title || '' };
      } catch {}
    }
    return { links: items, relationships: [] };
  }

  function rowLabel(row) {
    const wrapper = document.createElement('span');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    const entry = row.entry || row.input || {};
    title.textContent = entry.title || entry.url || `Row ${row.index}`;
    detail.textContent = row.error || row.reason || entry.url || '';
    wrapper.append(title, detail);
    return wrapper;
  }

  function renderPreview(data) {
    readyLinks = [...data.readyLinks];
    readyRelationships = [...(data.readyRelationships || [])];
    const { total, ready, invalid, duplicates } = data.summary;
    const relationText = readyRelationships.length ? ` ${readyRelationships.length} related-link connections included.` : '';
    elements.summary.textContent = `${total} found, ${ready} ready, ${duplicates} duplicate, ${invalid} invalid.${relationText}`;
    elements.rows.replaceChildren();
    for (const row of data.rows) {
      const item = document.createElement('div');
      const state = document.createElement('span');
      item.className = 'import-preview__row';
      state.className = `import-preview__state import-preview__state--${row.state}`;
      state.textContent = row.state;
      item.append(rowLabel(row), state);
      elements.rows.appendChild(item);
    }
    elements.limit.hidden = total <= data.rows.length;
    elements.confirm.disabled = ready + readyRelationships.length === 0;
    elements.preview.hidden = false;
    elements.progress.hidden = true;
    elements.confirm.focus();
  }

  async function previewRequest(format, data) {
    const res = await apiFetch('/api/links/import-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, data }),
      });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Could not preview import');
    return result;
  }

  async function previewJson(data) {
    const links = Array.isArray(data) ? data : data?.links;
    if (!Array.isArray(links)) throw new Error('JSON import must contain a links array.');
    if (links.length > 5000) throw new Error('Import batch cannot exceed 5000 items.');
    const combined = { summary: { total: 0, ready: 0, invalid: 0, duplicates: 0 }, rows: [], readyLinks: [] };
    const sourceIds = new Map(), urlTargets = new Map();
    for (let offset = 0; offset < links.length; offset += 100) {
      setMessage(elements.message, `Preparing preview ${Math.min(offset + 100, links.length)}/${links.length}...`);
      const part = await previewRequest('json', { links: links.slice(offset, offset + 100) });
      for (const row of part.rows) {
        const sourceId = row.entry?.id || row.input?.id;
        const url = row.entry?.url || row.input?.url;
        const repeatedTarget = row.state === 'ready' ? urlTargets.get(url) : null;
        const targetId = repeatedTarget || row.entry?.id || row.existing?.id;
        if (sourceId && targetId) sourceIds.set(sourceId, targetId);
        const state = repeatedTarget ? 'duplicate' : row.state;
        combined.summary.total += 1;
        combined.summary[state === 'duplicate' ? 'duplicates' : state] += 1;
        if (state === 'ready') {
          urlTargets.set(url, targetId);
          combined.readyLinks.push(row.entry);
        }
        combined.rows.push({ ...row, state, index: row.index + offset,
          ...(repeatedTarget ? { input: row.entry, reason: 'Repeated in import' } : {}) });
      }
    }
    const relationships = (data?.relationships || []).map(item => ({ ...item,
      linkIdA: sourceIds.get(item.linkIdA) || item.linkIdA,
      linkIdB: sourceIds.get(item.linkIdB) || item.linkIdB,
    }));
    const relationshipSummary = { total: 0, ready: 0, invalid: 0, duplicates: 0 };
    const readyRelationshipList = [], relationshipPairs = new Set();
    for (let offset = 0; offset < relationships.length; offset += 100) {
      const part = await previewRequest('json', { links: [], relationships: relationships.slice(offset, offset + 100) });
      relationshipSummary.total += part.relationshipSummary.total;
      relationshipSummary.invalid += part.relationshipSummary.invalid;
      relationshipSummary.duplicates += part.relationshipSummary.duplicates;
      for (const relationship of part.readyRelationships) {
        const key = `${relationship.linkIdA}:${relationship.linkIdB}`;
        if (relationshipPairs.has(key)) relationshipSummary.duplicates += 1;
        else {
          relationshipPairs.add(key);
          relationshipSummary.ready += 1;
          readyRelationshipList.push(relationship);
        }
      }
    }
    return { ...combined, rows: combined.rows.slice(0, 100),
      readyRelationships: readyRelationshipList, relationshipSummary };
  }

  async function requestPreview(format, data) {
    setMessage(elements.message, 'Preparing preview...');
    try {
      const result = format === 'json' && typeof data !== 'string'
        ? await previewJson(data) : await previewRequest(format, data);
      renderPreview(result);
      setMessage(elements.message, 'Review before importing.');
    } catch (error) { setMessage(elements.message, error.message, 'error'); }
  }

  async function previewFile(format, input, label) {
    try {
      const text = await fileText(input, label);
      await requestPreview(format, format === 'json' ? JSON.parse(text) : text);
    }
    catch (error) { setMessage(elements.message, error.message, 'error'); }
  }

  function clearPreview() {
    readyLinks = [];
    readyRelationships = [];
    elements.rows.replaceChildren();
    elements.preview.hidden = true;
    elements.progress.hidden = true;
  }

  async function confirmImport() {
    elements.confirm.disabled = true;
    elements.cancel.disabled = true;
    elements.progress.hidden = false;
    const totalWork = readyLinks.length + readyRelationships.length;
    elements.progressBar.max = Math.max(totalWork, 1);
    let imported = 0, duplicates = 0, invalid = 0;
    let finished = false;
    try {
      for (let offset = 0; offset < readyLinks.length; offset += 100) {
        const links = readyLinks.slice(offset, offset + 100);
        const res = await apiFetch('/api/links/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        imported += data.imported || 0;
        duplicates += data.duplicates || 0;
        invalid += data.invalid || 0;
        elements.progressBar.value = Math.min(offset + links.length, readyLinks.length);
        elements.progressText.textContent = `${elements.progressBar.value}/${totalWork}`;
      }
      let relationshipInvalid = 0, relationshipDuplicates = 0;
      for (let offset = 0; offset < readyRelationships.length; offset += 100) {
        const relationships = readyRelationships.slice(offset, offset + 100);
        const res = await apiFetch('/api/links/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links: [], relationships }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Related links import failed');
        relationshipInvalid += data.relationships?.invalid || 0;
        relationshipDuplicates += data.relationships?.duplicates || 0;
        elements.progressBar.value = Math.min(readyLinks.length + offset + relationships.length, totalWork);
        elements.progressText.textContent = `${elements.progressBar.value}/${totalWork}`;
      }
      const relationshipSkipped = relationshipInvalid + relationshipDuplicates;
      finished = true;
      if (relationshipSkipped) {
        elements.confirm.disabled = true;
        elements.summary.textContent += ` ${relationshipSkipped} related-link connections could not be restored.`;
        setMessage(elements.message, `Imported ${imported} links. ${relationshipSkipped} related-link connections were skipped.`, 'error');
      } else {
        clearPreview();
        setMessage(elements.message, `Imported ${imported}. Skipped ${duplicates} duplicate and ${invalid} invalid.`, 'success');
      }
    } catch (error) {
      setMessage(elements.message, `${error.message} ${imported} imported before failure.`, 'error');
    } finally {
      elements.confirm.disabled = finished;
      elements.cancel.disabled = false;
    }
  }

  sourceButton('json-import', () => previewFile('json', elements.jsonFile, 'JSON'));
  sourceButton('csv-import', () => previewFile('csv', elements.csvFile, 'CSV'));
  sourceButton('bookmarks-import', () => previewFile('bookmarks', elements.bookmarksFile, 'bookmarks'));
  sourceButton('batch-import', async () => {
    try { await requestPreview('json', await prepareBatch()); }
    catch (error) { setMessage(elements.message, error.message, 'error'); }
  });
  elements.confirm.addEventListener('click', confirmImport);
  elements.cancel.addEventListener('click', clearPreview);
})();
