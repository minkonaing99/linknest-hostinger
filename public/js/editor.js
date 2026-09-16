const { getLinks, setMessage, parseTags, queryParam, apiFetch, findDuplicateCandidates, thailandDateString: thailandDate } = window.LinkNest;

let allowDuplicateOnce = false;
let loadedItem = null;

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

function shouldQueueOffline(error) {
  return !navigator.onLine || error instanceof TypeError || /offline|network|fetch/i.test(error.message);
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
  loadedItem = { ...item };
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
    if (draft.status === 'useful' && loadedItem?.status !== 'useful' && !String(loadedItem?.notes || '').trim() && !draft.notes) {
      const fields = await window.LinkNest.usefulUpdate({ ...loadedItem, id: draft.id, notes: draft.notes });
      if (!fields) return;
      draft = { ...draft, ...fields };
      if (editing) {
        const { notes, ...withoutNotes } = draft;
        draft = withoutNotes;
      }
    }
    if (!editing && !navigator.onLine) {
      await window.LinkNestOffline.queueCapture(draft);
      els.form.reset();
      els.date.value = thailandDate();
      setMessage(els.message, 'Pending - saves when online.', 'success');
      return;
    }
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
    if (!editing && shouldQueueOffline(error)) {
      await window.LinkNestOffline.queueCapture(draft);
      setMessage(els.message, 'Pending - saves when online.', 'success');
    } else {
      setMessage(els.message, error.message, 'error');
    }
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

function sharedHttpUrl() {
  const candidates = [queryParam('url'), ...(String(queryParam('text') || '').match(/https?:\/\/[^\s<>"']+/g) || [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(String(candidate).trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (parsed.username || parsed.password) continue;
      return parsed.toString();
    } catch {}
  }
  return null;
}

async function loadFromShareParams() {
  if (queryParam('id') || queryParam('offlineId')) return;
  if (!queryParam('url') && !queryParam('text')) return;
  const urlParam = sharedHttpUrl();
  if (!urlParam) {
    setMessage(els.message, 'Shared content does not contain a valid web link.', 'error');
    return;
  }
  const titleParam = queryParam('title');
  if (titleParam && titleParam.length > 300) {
    setMessage(els.message, 'Shared title must be 300 characters or fewer.', 'error');
    return;
  }
  els.url.value = urlParam;
  if (titleParam) {
    els.title.value = titleParam;
  } else {
    if (navigator.onLine) await fetchAndApplyTitle(urlParam);
  }
}

async function loadOfflineDraft() {
  const offlineId = queryParam('offlineId');
  if (!offlineId || !window.LinkNestOffline) return;
  const item = (await window.LinkNestOffline.listCaptures()).find(record => record.id === offlineId);
  if (!item) return;
  els.url.value = item.url;
  els.title.value = item.title || '';
  els.date.value = item.date || thailandDate();
  els.status.value = item.status || 'saved';
  els.tags.value = (item.tags || []).join(', ');
  els.notes.value = item.notes || '';
  els.remindAt.value = item.remindAt ? item.remindAt.slice(0, 10) : '';
  setMessage(els.message, 'Offline capture loaded. Save or resolve duplicate, then dismiss queued copy.');
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

loadForEdit().catch(console.error);
loadFromShareParams().catch(console.error);
loadOfflineDraft().catch(console.error);
