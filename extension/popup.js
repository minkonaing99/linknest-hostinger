'use strict';

const urlInput      = document.getElementById('url');
const titleInput    = document.getElementById('title');
const tagsInput     = document.getElementById('tags');
const saveButton    = document.getElementById('save');
const statusDiv     = document.getElementById('status');
const mainDiv       = document.getElementById('main');
const notConfigured = document.getElementById('not-configured');
const openSettings  = document.getElementById('open-settings');

function showStatus(type, html) {
  statusDiv.className = `status status--${type}`;
  statusDiv.innerHTML = html;
  statusDiv.style.display = 'block';
}

function parseTags(raw) {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.local.get(['serverUrl', 'apiToken'], async ({ serverUrl, apiToken }) => {
  if (!serverUrl || !apiToken) {
    mainDiv.style.display = 'none';
    notConfigured.style.display = 'block';
    return;
  }

  // Pre-fill from active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    urlInput.value  = tab.url  || '';
    titleInput.value = tab.title || '';
  }

  saveButton.addEventListener('click', async () => {
    const url   = urlInput.value.trim();
    const title = titleInput.value.trim();
    const tags  = parseTags(tagsInput.value);

    if (!url) { showStatus('err', 'URL is required.'); return; }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ url, title, tags }),
      });

      const data = await res.json();

      if (res.status === 409) {
        const browseUrl = `${serverUrl.replace(/\/$/, '')}/browse.html`;
        showStatus('err', `Link already exists. <a href="${escapeHtml(browseUrl)}" target="_blank">Browse</a>`);
        return;
      }

      if (!res.ok) {
        showStatus('err', escapeHtml(data.error || 'Save failed.'));
        return;
      }

      const browseUrl = `${serverUrl.replace(/\/$/, '')}/browse.html`;
      let msg = `Saved. <a href="${escapeHtml(browseUrl)}" target="_blank">Browse</a>`;

      if (data.duplicateCandidates && data.duplicateCandidates.length > 0) {
        msg += ` &mdash; ${data.duplicateCandidates.length} possible duplicate(s) found.`;
        showStatus('dup', msg);
      } else {
        showStatus('ok', msg);
      }

      saveButton.textContent = 'Saved';
    } catch (err) {
      showStatus('err', 'Network error: ' + escapeHtml(err.message));
      saveButton.disabled = false;
      saveButton.textContent = 'Save Link';
    }
  });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
