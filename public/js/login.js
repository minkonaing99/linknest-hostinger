const form = document.getElementById('login-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const message = document.getElementById('login-message');

function setMessage(text, kind = '') {
  message.textContent = text;
  message.className = `form-message login-message ${kind}`.trim();
}

async function localIdentity() {
  try { return await window.LinkNestOfflineStore?.getIdentity(); }
  catch { return null; }
}

async function rememberIdentity(userId, expected) {
  if (!expected) return;
  try { await window.LinkNestOfflineStore?.verifyIdentity(userId, expected); }
  catch {
    await window.LinkNestOfflineStore?.invalidate('account-change').catch(() => {});
  }
}

(async function init() {
  username.focus();
  try {
    const expected = await localIdentity();
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      await rememberIdentity(data.user.id, expected);
      window.location.href = '/browse.html';
    } else if (res.status === 401) {
      await window.LinkNestOfflineStore?.invalidate('authentication');
    }
  } catch {
    // ignore
  }
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Signing in...');

  try {
    const expected = await localIdentity();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    await rememberIdentity(data.user.id, expected);
    setMessage('Signed in.', 'success');
    window.location.href = '/browse.html';
  } catch (error) {
    setMessage(error.message, 'error');
  }
});
