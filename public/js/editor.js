const { getLinks, setMessage, parseTags, queryParam, apiFetch, findDuplicateCandidates, thailandDateString: thailandDate } = window.LinkNest;

let allowDuplicateOnce = false;

const els = {
  form: document.getElementById('link-form'),
  id: document.getElementById('link-id'),
  title: document.getElementById('title'),
  url: document.getElementById('url'),
  date: document.getElementById('date'),
  status: document.getElementById('status'),
  tags: document.getElementById('tags'),
  notes: document.getElementById('notes'),
  remindAt: document.getElementById('remind-at'),
  fetchTitle: document.getElementById('fetch-title'),
  pasteClipboard: document.getElementById('paste-clipboard'),
  submitButton: document.getElementById('submit-button'),
  formHeading: document.getElementById('form-heading'),
  pageTitle: document.getElementById('page-title'),
  message: document.getElementById('form-message'),
  batchInput: document.getElementById('batch-input'),
  batchImport: document.getElementById('batch-import'),
  importMessage: document.getElementById('import-message'),
  bookmarksFile: document.getElementById('bookmarks-file'),
  bookmarksImport: document.getElementById('bookmarks-import'),
  bookmarksMessage: document.getElementById('bookmarks-message'),
};

els.date.value = thailandDate();

function payload() {
  return {
    id: els.id.value || undefined,
    title: els.title.value.trim(),
    url: els.url.value.trim(),
    date: els.date.value,
    status: els.status.value,
    tags: parseTags(els.tags.value),
    notes: els.notes.value.trim(),
    remindAt: els.remindAt.value || null,
  };
}

function parseBatchLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      const url = (parts[0] || '').trim();
      const title = parts.slice(1).join('|').trim();
      return { url, title };
    })
    .filter(item => item.url);
}

async function fetchTitleMetadata(rawUrl) {
  const res = await apiFetch(`/api/fetch-title?url=${encodeURIComponent(rawUrl)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not fetch title');
  return data;
}

function duplicateAction(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--ghost button--small';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function mergeCandidateNote(candidate, note) {
  const updateRes = await apiFetch(`/api/links/${encodeURIComponent(candidate.id)}/merge-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const updateData = await updateRes.json();
  if (!updateRes.ok) throw new Error(updateData.error || 'Could not merge note');
}

function renderDuplicateChoices(candidates, draft) {
  setMessage(els.message, 'Possible duplicate. Choose what to do.', 'error');
  els.message.classList.add('duplicate-panel');
  els.message.setAttribute('aria-label', 'Duplicate choices');
  const hasExact = candidates.some(candidate => candidate.exact);
  for (const candidate of candidates) {
    const row = document.createElement('span');
    row.className = 'duplicate-choice';
    const title = document.createElement('strong');
    title.textContent = candidate.title || candidate.url;
    const actions = document.createElement('span');
    actions.className = 'duplicate-choice__actions';
    const open = document.createElement('a');
    open.className = 'button button--ghost button--small';
    open.textContent = 'Open existing';
    open.href = `/editor.html?id=${encodeURIComponent(candidate.id)}`;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    actions.appendChild(open);
    if (candidate.archived) {
      actions.appendChild(duplicateAction('Restore', async () => {
        try {
          const res = await apiFetch(`/api/links/restore/${encodeURIComponent(candidate.id)}`, { method: 'POST' });
          if (!res.ok) throw new Error((await res.json()).error || 'Restore failed');
          setMessage(els.message, 'Link restored.', 'success');
        } catch (error) { setMessage(els.message, error.message, 'error'); }
      }));
    } else if (draft.notes) {
      actions.appendChild(duplicateAction('Merge note', async () => {
        try {
          await mergeCandidateNote(candidate, draft.notes);
          setMessage(els.message, 'Note merged into existing link.', 'success');
        } catch (error) { setMessage(els.message, error.message, 'error'); }
      }));
    }
    if (!candidate.exact && !hasExact) {
      actions.appendChild(duplicateAction('Save separately', () => {
        allowDuplicateOnce = true;
        els.form.requestSubmit();
      }));
    }
    row.append(title, actions);
    els.message.appendChild(row);
  }
  els.message.querySelector('a, button')?.focus();
}

async function loadForEdit() {
  const id = queryParam('id');
  if (!id) return;
  const res = await apiFetch(`/api/links/${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const data = await res.json();
  const item = data.entry;
  if (!item) return;
  els.id.value = item.id;
  els.title.value = item.title || '';
  els.url.value = item.url || '';
  els.date.value = item.date || thailandDate();
  els.status.value = item.status || 'saved';
  els.tags.value = (item.tags || []).join(', ');
  els.notes.value = item.notes || '';
  els.remindAt.value = item.remindAt ? item.remindAt.slice(0, 10) : '';
  els.formHeading.textContent = 'Edit link';
  els.pageTitle.textContent = 'Edit Link';
  els.submitButton.textContent = 'Save changes';
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const editing = Boolean(els.id.value);
  let draft = payload();
  const skipDuplicateCheck = allowDuplicateOnce;
  allowDuplicateOnce = false;
  setMessage(els.message, editing ? 'Saving changes...' : 'Saving...');
  try {
    if (!editing && !skipDuplicateCheck) {
      if (!draft.title) {
        const metadata = await fetchTitleMetadata(draft.url);
        draft = { ...draft, url: metadata.url || draft.url, title: metadata.title || draft.url };
        els.url.value = draft.url;
        els.title.value = draft.title;
      }
      const candidates = await findDuplicateCandidates(draft.url, draft.title);
      if (candidates.length) {
        renderDuplicateChoices(candidates, draft);
        return;
      }
    }
    const res = await apiFetch(editing ? `/api/links/${encodeURIComponent(els.id.value)}` : '/api/links', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (res.status === 409) {
      setMessage(els.message, data.error, 'error');
      const action = document.createElement('a');
      if (data.archived) {
        action.textContent = ' Restore it?';
        action.href = '#';
        action.addEventListener('click', async e => {
          e.preventDefault();
          setMessage(els.message, 'Restoring...');
          try {
            const r = await apiFetch(`/api/links/restore/${encodeURIComponent(data.id)}`, { method: 'POST' });
            if (!r.ok) throw new Error((await r.json()).error || 'Restore failed');
            setMessage(els.message, 'Link restored to library.', 'success');
          } catch (err) {
            setMessage(els.message, err.message, 'error');
          }
        });
      } else {
        action.textContent = ' Edit it?';
        action.href = `/editor.html?id=${encodeURIComponent(data.id)}`;
      }
      els.message.appendChild(action);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Failed to save link');
    setMessage(els.message, editing ? 'Link updated.' : 'Link saved.', 'success');
    const returnTo = queryParam('returnTo');
    const destination = returnTo === '/browse.html?review=1' ? returnTo : '/browse.html';
    setTimeout(() => { window.location.href = destination; }, 600);
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
});

async function fetchAndApplyTitle(rawUrl) {
  if (!rawUrl) {
    setMessage(els.message, 'Enter a URL first.', 'error');
    return;
  }
  els.title.value = '';
  setMessage(els.message, 'Fetching title...');
  try {
    const data = await fetchTitleMetadata(rawUrl);
    els.url.value = data.url || rawUrl;
    els.title.value = data.title || '';
    if (data.needsManualEntry) {
      setMessage(els.message, 'Could not fetch title (site may have bot protection) — please enter it manually.', 'error');
      els.title.focus();
    } else {
      setMessage(els.message, 'Title fetched.', 'success');
    }
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
}

els.fetchTitle.addEventListener('click', async () => {
  await fetchAndApplyTitle(els.url.value.trim());
});

els.pasteClipboard.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    setMessage(els.message, 'Clipboard read is not supported in this browser.', 'error');
    return;
  }
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setMessage(els.message, 'Clipboard is empty.', 'error');
      return;
    }
    let url;
    try {
      url = new URL(text).toString();
    } catch {
      setMessage(els.message, 'Clipboard does not contain a valid link.', 'error');
      return;
    }
    els.url.value = url;
    setMessage(els.message, 'Link pasted from clipboard.', 'success');
    await fetchAndApplyTitle(url);
  } catch {
    setMessage(els.message, 'Clipboard permission denied or unavailable.', 'error');
  }
});

els.batchImport.addEventListener('click', async () => {
  const raw = els.batchInput.value.trim();
  if (!raw) return setMessage(els.importMessage, 'Paste at least one line first.', 'error');

  const parsed = parseBatchLines(raw);
  if (!parsed.length) return setMessage(els.importMessage, 'No valid lines found.', 'error');

  setMessage(els.importMessage, `Preparing ${parsed.length} link(s)...`);
  const today = thailandDate();
  const links = [];

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    let finalUrl = item.url;
    let finalTitle = item.title;

    if (!finalTitle) {
      try {
        const metadata = await fetchTitleMetadata(item.url);
        finalUrl = metadata.url || item.url;
        finalTitle = metadata.title || '';
      } catch {
        finalTitle = '';
      }
    }

    links.push({
      url: finalUrl,
      title: finalTitle,
      date: today,
      status: 'saved',
      tags: [],
    });

    setMessage(els.importMessage, `Preparing ${i + 1}/${parsed.length}...`);
  }

  try {
    const res = await apiFetch('/api/links/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    setMessage(els.importMessage, `Imported ${data.imported} links.`, 'success');
    els.batchInput.value = '';
  } catch (error) {
    setMessage(els.importMessage, error.message, 'error');
  }
});

async function loadFromShareParams() {
  if (queryParam('id')) return;
  const urlParam = queryParam('url');
  if (!urlParam) return;
  els.url.value = urlParam;
  const titleParam = queryParam('title');
  if (titleParam) {
    els.title.value = titleParam;
  } else {
    await fetchAndApplyTitle(urlParam);
  }
}

const importExportToggle = document.getElementById('import-export-toggle');
const importExportBody   = document.getElementById('import-export-body');
if (importExportToggle && importExportBody) {
  importExportToggle.addEventListener('click', () => {
    const open = !importExportBody.classList.contains('hidden');
    importExportBody.classList.toggle('hidden', open);
    importExportToggle.classList.toggle('is-open', !open);
  });
}

if (els.bookmarksImport) {
  els.bookmarksImport.addEventListener('click', async () => {
    const file = els.bookmarksFile?.files?.[0];
    if (!file) return setMessage(els.bookmarksMessage, 'Choose a bookmarks HTML file first.', 'error');
    setMessage(els.bookmarksMessage, 'Reading file…');
    try {
      const html = await file.text();
      setMessage(els.bookmarksMessage, 'Importing…');
      const res = await apiFetch('/api/links/import-bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setMessage(els.bookmarksMessage, `Imported ${data.imported} of ${data.parsed} bookmarks.`, 'success');
      if (els.bookmarksFile) els.bookmarksFile.value = '';
    } catch (err) {
      setMessage(els.bookmarksMessage, err.message, 'error');
    }
  });
}

loadForEdit().catch(console.error);
loadFromShareParams().catch(console.error);
