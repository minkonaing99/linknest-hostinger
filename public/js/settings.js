'use strict';

const createForm   = document.getElementById('create-token-form');
const nameInput    = document.getElementById('token-name');
const scopeSelect  = document.getElementById('token-scope');
const tokenReveal  = document.getElementById('token-reveal');
const tokenValue   = document.getElementById('token-reveal-value');
const copyButton   = document.getElementById('copy-token-button');
const tokenList    = document.getElementById('token-list');
const tokenEmpty   = document.getElementById('token-empty');
const logoutButton = document.getElementById('logout-button');

async function apiFetch(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

function formatDate(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderTokenRow(token) {
  const row = document.createElement('div');
  row.className = 'token-row' + (token.active ? '' : ' token-row--revoked');
  row.dataset.id = token.id;
  row.innerHTML = `
    <div class="token-row__info">
      <span class="token-row__name">${escapeHtml(token.name)}</span>
      <span class="token-row__meta">${token.scope} &middot; created ${formatDate(token.createdAt)} &middot; last used ${formatDate(token.lastUsedAt)}</span>
    </div>
    <div class="token-row__actions">
      ${token.active ? `<button class="button button--ghost button--small button--danger" data-revoke="${token.id}">Revoke</button>` : '<span class="token-row__revoked">Revoked</span>'}
    </div>
  `;
  return row;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function loadTokens() {
  try {
    const { tokens } = await apiFetch('GET', '/api/tokens');
    tokenList.querySelectorAll('.token-row').forEach(el => el.remove());
    if (tokens.length === 0) {
      tokenEmpty.classList.remove('hidden');
      return;
    }
    tokenEmpty.classList.add('hidden');
    for (const token of tokens) {
      tokenList.appendChild(renderTokenRow(token));
    }
  } catch (err) {
    console.error('Failed to load tokens', err);
  }
}

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const scope = scopeSelect.value;
  if (!name) return;
  try {
    const data = await apiFetch('POST', '/api/tokens', { name, scope });
    tokenValue.textContent = data.token;
    tokenReveal.classList.remove('hidden');
    nameInput.value = '';
    await loadTokens();
  } catch (err) {
    window.LinkNest.showToast('Failed to create token: ' + err.message);
  }
});

tokenList.addEventListener('click', async (e) => {
  const id = e.target.dataset.revoke;
  if (!id) return;
  try {
    await apiFetch('DELETE', `/api/tokens/${encodeURIComponent(id)}`);
    await loadTokens();
    tokenReveal.classList.add('hidden');
    window.LinkNest.showToast('Token revoked', 'success');
  } catch (err) {
    window.LinkNest.showToast('Failed to revoke token: ' + err.message);
  }
});

copyButton.addEventListener('click', () => {
  navigator.clipboard.writeText(tokenValue.textContent).then(() => {
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
  });
});

logoutButton.addEventListener('click', async () => {
  try { await apiFetch('POST', '/api/logout'); } catch {}
  window.location.href = '/login.html';
});

loadTokens();
