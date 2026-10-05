'use strict';

// Self-contained: Chrome serializes this function into the isolated top frame.
function articlePosition(mode, expectedUrl, position) {
  if (location.href !== expectedUrl) return { error: 'Page changed. Reopen the article and try again.' };
  if (window.top !== window || !['text/html', 'application/xhtml+xml'].includes(document.contentType)
    || !document.scrollingElement || document.querySelector('embed[type="application/pdf"], object[type="application/pdf"], [role="feed"], [data-virtualized]')) {
    return { error: 'Reading position supports ordinary HTML articles, not this reader or feed.' };
  }
  const height = Math.max(0, document.scrollingElement.scrollHeight - window.innerHeight);
  const scrollY = Math.min(height, Math.max(0, window.scrollY));
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).slice(0, 500)
    .filter(heading => heading.getClientRects().length && !heading.closest('form, nav, [contenteditable]'))
    .map(heading => ({ text: (heading.textContent || '').replace(/[\s\x00-\x1f\x7f]+/g, ' ').trim(),
      top: heading.getBoundingClientRect().top }))
    .filter(heading => heading.text && heading.text.length <= 200 && Math.abs(heading.top) <= 100000);
  if (mode === 'save') {
    const nearby = headings.reduce((best, heading) => !best || Math.abs(heading.top) < Math.abs(best.top) ? heading : best, null);
    return { url: location.href, position: { ratio: height ? scrollY / height : 0,
      offset: nearby ? nearby.top : 0, anchor: nearby ? nearby.text : '', scrollHeight: height } };
  }
  if (!position || !Number.isFinite(position.ratio) || position.ratio < 0 || position.ratio > 1
    || !Number.isFinite(position.offset) || Math.abs(position.offset) > 100000
    || typeof position.anchor !== 'string' || position.anchor.length > 200
    || !Number.isFinite(position.scrollHeight) || position.scrollHeight < 0 || position.scrollHeight > 100000000) {
    return { error: 'Saved position is invalid. Save a new position first.' };
  }
  const matches = headings.filter(heading => heading.text === position.anchor);
  const anchored = matches.length === 1;
  const target = anchored ? window.scrollY + matches[0].top - position.offset : height * position.ratio;
  window.scrollTo({ top: Math.min(height, Math.max(0, target)), behavior: 'instant' });
  return { url: location.href, approximate: !anchored || Math.abs(height - position.scrollHeight) > 2 };
}

function supportedReadingTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) throw new Error('Open an article tab first.');
  let parsed;
  try { parsed = new URL(tab.url); } catch { throw new Error('Open an HTTP/HTTPS article first.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || ['chromewebstore.google.com', 'chrome.google.com', 'addons.mozilla.org', 'microsoftedge.microsoft.com'].includes(parsed.hostname)
    || /\.pdf$/i.test(parsed.pathname)) {
    throw new Error('Reading position is unavailable on browser pages, extension stores, or PDFs.');
  }
  return { id: tab.id, url: tab.url };
}

async function readingRequest(target, apiToken, payload) {
  const response = await fetch(target, {
    method: payload ? 'PUT' : 'GET',
    headers: { 'Authorization': `Bearer ${apiToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not access reading position.');
  return body;
}

async function injectArticlePosition(tab, mode, position) {
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== tab.url) throw new Error('Page changed. Reopen the article and try again.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED',
    func: articlePosition, args: [mode, tab.url, position || null] });
  const result = results.find(item => item.frameId === 0)?.result;
  if (!result || result.error || result.url !== tab.url) throw new Error(result?.error || 'Could not read this article. Try an ordinary HTML page.');
  return result;
}

async function readingAction(mode, serverUrl, apiToken, isBusy) {
  if (isBusy()) return;
  setBusy(true);
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = supportedReadingTab(active);
    const lookup = await readingRequest(`${serverUrl}/api/links/lookup?url=${encodeURIComponent(tab.url)}`, apiToken);
    if (!lookup.entry) throw new Error('Save this article link first using Save Link, then save its reading position.');
    const endpoint = `${serverUrl}/api/links/${encodeURIComponent(lookup.entry.id)}/reading-position`;
    if (mode === 'save') {
      const captured = await injectArticlePosition(tab, 'save');
      await readingRequest(endpoint, apiToken, { ...captured.position, url: tab.url });
      showStatus('ok', `Reading position saved at ${Math.round(captured.position.ratio * 100)}%.`);
    } else {
      const saved = await readingRequest(`${endpoint}?url=${encodeURIComponent(tab.url)}`, apiToken);
      if (!saved.position) throw new Error('No reading position yet. Choose Save position first.');
      const resumed = await injectArticlePosition(tab, 'resume', saved.position);
      showStatus('ok', resumed.approximate ? 'Resumed at an approximate position; page layout or heading may have changed.' : 'Resumed at your saved reading position.');
    }
  } catch (error) {
    showStatus('err', escapeHtml(error.message));
  } finally {
    setBusy(false);
  }
}

function initReadingPosition(serverUrl, apiToken, isBusy) {
  const save = document.getElementById('save-position');
  const resume = document.getElementById('resume-reading');
  save.addEventListener('click', () => readingAction('save', serverUrl, apiToken, isBusy));
  resume.addEventListener('click', () => readingAction('resume', serverUrl, apiToken, isBusy));
}
