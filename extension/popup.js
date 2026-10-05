'use strict';

const urlInput      = document.getElementById('url');
const titleInput    = document.getElementById('title');
const tagsInput     = document.getElementById('tags');
const notesInput    = document.getElementById('notes');
const saveReasonInput = document.getElementById('save-reason');
const saveButton    = document.getElementById('save');
const pasteSaveButton = document.getElementById('paste-save');
const statusDiv     = document.getElementById('status');
const mainDiv       = document.getElementById('main');
const notConfigured = document.getElementById('not-configured');
const openSettings  = document.getElementById('open-settings');
let busy = false;
let needsClipboardPermission = false;

function showStatus(type, html) {
  statusDiv.className = `status status--${type}`;
  statusDiv.innerHTML = html;
  statusDiv.style.display = 'block';
}

function parseTags(raw) {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function isSecureServerUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    const localHosts = ['localhost', '127.0.0.1', '[::1]'];
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localHosts.includes(parsed.hostname));
  } catch {
    return false;
  }
}

function validateCaptureUrl(raw) {
  const value = raw.trim();
  try {
    if (!/^https?:\/\//i.test(value) || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) throw new Error();
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new Error();
    return value;
  } catch {
    throw new Error('Enter one HTTP or HTTPS URL, without credentials (maximum 2,048 characters).');
  }
}

function setBusy(value) {
  busy = value;
  for (const control of [saveButton, pasteSaveButton, urlInput, titleInput, tagsInput, notesInput, saveReasonInput]) {
    control.disabled = value;
  }
  saveButton.textContent = value ? 'Saving...' : 'Save Link';
  pasteSaveButton.textContent = value ? 'Working...' : (needsClipboardPermission ? 'Allow clipboard and save' : 'Paste and save');
}

async function readClipboardUrl() {
  if (!navigator.clipboard?.readText) {
    throw new Error('Clipboard access is unavailable. Paste a URL into the URL field, then choose Save Link.');
  }
  if (needsClipboardPermission) {
    const granted = await chrome.permissions.request({ permissions: ['clipboardRead'] });
    if (!granted) throw new Error('Clipboard permission denied. Paste a URL into the URL field, then choose Save Link.');
  }
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch {
    needsClipboardPermission = true;
    throw new Error('Clipboard access failed. Choose Allow clipboard and save, or paste a URL into the URL field.');
  }
  needsClipboardPermission = false;
  return validateCaptureUrl(text);
}

async function fetchCaptureTitle(url, serverUrl, apiToken) {
  try {
    const res = await fetch(`${serverUrl}/api/fetch-title?url=${encodeURIComponent(url)}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return url;
    const data = await res.json();
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : url;
  } catch {
    return url;
  }
}

async function captureLink(payload, serverUrl, apiToken) {
  const res = await fetch(`${serverUrl}/api/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  const browseUrl = `${serverUrl}/browse.html`;
  if (res.status === 409) {
    showStatus('err', `Link already exists. <a href="${escapeHtml(browseUrl)}" target="_blank">Browse</a>`);
    return;
  }
  if (!res.ok) {
    showStatus('err', escapeHtml(data.error || 'Save failed.'));
    return;
  }
  let msg = `Saved. <a href="${escapeHtml(browseUrl)}" target="_blank">Browse</a>`;
  if (Array.isArray(data.duplicateCandidates) && data.duplicateCandidates.length > 0) {
    msg += ` - ${data.duplicateCandidates.length} possible duplicate(s) found.`;
    showStatus('dup', msg);
  } else {
    showStatus('ok', msg);
  }
}

async function saveLink(fromClipboard, serverUrl, apiToken) {
  if (busy) return;
  setBusy(true);
  try {
    const url = fromClipboard ? await readClipboardUrl() : validateCaptureUrl(urlInput.value);
    if (url !== urlInput.value.trim()) titleInput.value = '';
    urlInput.value = url;
    const title = titleInput.value.trim();
    const tags = parseTags(tagsInput.value);
    const notes = notesInput.value.trim();
    const saveReason = saveReasonInput.value.trim();
    const captureTitle = title || await fetchCaptureTitle(url, serverUrl, apiToken);
    titleInput.value = captureTitle;
    await captureLink({ url, title: captureTitle, tags, notes, saveReason }, serverUrl, apiToken);
  } catch (err) {
    showStatus('err', escapeHtml(err.message));
  } finally {
    setBusy(false);
  }
}

openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.local.get(['serverUrl', 'apiToken'], async ({ serverUrl, apiToken }) => {
  if (!isSecureServerUrl(serverUrl) || !apiToken) {
    mainDiv.style.display = 'none';
    notConfigured.style.display = 'block';
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      urlInput.value = tab.url || '';
      titleInput.value = tab.title || '';
    }
  } catch {
    // Manual and clipboard capture remain available when the active tab is unavailable.
  }
  const baseUrl = serverUrl.replace(/\/$/, '');
  urlInput.addEventListener('input', () => { titleInput.value = ''; });
  saveButton.addEventListener('click', () => saveLink(false, baseUrl, apiToken));
  pasteSaveButton.addEventListener('click', () => saveLink(true, baseUrl, apiToken));
  setBusy(false);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
