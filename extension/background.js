'use strict';

const MENU_ID = 'save-selection';
const NOTE_LIMIT = 10000;

function showBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function readSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'apiToken'], resolve);
  });
}

function httpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function secureServerUrl(value) {
  const parsed = httpUrl(value);
  if (!parsed) return null;
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsed.protocol !== 'https:' && !localHosts.has(parsed.hostname)) return null;
  return parsed;
}

async function saveSelection(info, tab) {
  const notes = String(info.selectionText || '').trim();
  const page = httpUrl(info.pageUrl);
  if (!notes || notes.length > NOTE_LIMIT || !page) {
    showBadge('ERR', '#c63c3c');
    return;
  }

  const { serverUrl, apiToken } = await readSettings();
  const server = secureServerUrl(serverUrl);
  if (!server || !apiToken) {
    showBadge('SETUP', '#6b7280');
    chrome.runtime.openOptionsPage();
    return;
  }

  const url = page.toString();
  const title = String(tab?.title || url).slice(0, 300);
  try {
    const response = await fetch(`${server.toString().replace(/\/$/, '')}/api/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ url, title, tags: [], notes }),
    });
    if (response.status === 409) showBadge('DUP', '#b7791f');
    else if (response.ok) showBadge('OK', '#1c8b51');
    else showBadge('ERR', '#c63c3c');
  } catch {
    showBadge('ERR', '#c63c3c');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Save selection to Link Nest',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  return saveSelection(info, tab);
});
