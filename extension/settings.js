'use strict';

const form          = document.getElementById('settings-form');
const serverUrlInput = document.getElementById('server-url');
const apiTokenInput  = document.getElementById('api-token');
const statusEl       = document.getElementById('status');
const openSettingsLink = document.getElementById('open-settings-link');

// Load saved values
chrome.storage.local.get(['serverUrl', 'apiToken'], ({ serverUrl, apiToken }) => {
  if (serverUrl) serverUrlInput.value = serverUrl;
  if (apiToken)  apiTokenInput.value  = apiToken;
});

openSettingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  const base = serverUrlInput.value.trim().replace(/\/$/, '');
  if (base) {
    chrome.tabs.create({ url: `${base}/settings.html` });
  } else {
    statusEl.textContent = 'Enter your server URL first.';
    statusEl.className = 'status status--err';
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, '');
  const apiToken  = apiTokenInput.value.trim();

  if (!serverUrl || !apiToken) {
    statusEl.textContent = 'Both fields are required.';
    statusEl.className = 'status status--err';
    return;
  }

  // Verify the token works
  try {
    const res = await fetch(`${serverUrl}/api/me`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      statusEl.textContent = 'Token is invalid or expired.';
      statusEl.className = 'status status--err';
      return;
    }
    if (!res.ok) {
      statusEl.textContent = `Server returned ${res.status}. Check the URL.`;
      statusEl.className = 'status status--err';
      return;
    }
  } catch (err) {
    statusEl.textContent = 'Could not reach the server. Check the URL.';
    statusEl.className = 'status status--err';
    return;
  }

  chrome.storage.local.set({ serverUrl, apiToken }, () => {
    statusEl.textContent = 'Saved.';
    statusEl.className = 'status status--ok';
  });
});
