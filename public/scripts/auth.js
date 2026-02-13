import { track } from './analytics.js';

let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/auth/csrf');
  if (!res.ok) return null;
  const data = await res.json();
  csrfToken = data.csrfToken || null;
  return csrfToken;
}

async function postJson(url, payload = {}, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (options.requireCsrf) {
    const token = await ensureCsrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, data };
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  const data = await res.json();
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  return data.user || null;
}

export function renderAuthCard(root, flags) {
  if (!flags.auth) return;

  root.insertAdjacentHTML('afterbegin', `<section class="card" id="authCard">
    <h2>Account (optional)</h2>
    <p id="authState" class="muted" aria-live="polite">Checking session…</p>
    <div class="row">
      <label>Email<input id="authEmail" type="email" autocomplete="email" /></label>
      <label>Password<input id="authPassword" type="password" autocomplete="current-password" /></label>
    </div>
    <div class="row">
      <button id="authRegister" type="button">Register</button>
      <button id="authLogin" type="button">Login</button>
    </div>
    <button id="authLogout" type="button">Logout</button>
  </section>`);

  const stateEl = document.getElementById('authState');
  const emailEl = document.getElementById('authEmail');
  const passEl = document.getElementById('authPassword');

  async function refresh() {
    const user = await fetchMe();
    stateEl.textContent = user ? `Signed in as ${user.email}` : 'Not signed in.';
  }

  document.getElementById('authRegister')?.addEventListener('click', async () => {
    const r = await postJson('/api/auth/register', { email: emailEl.value, password: passEl.value });
    if (r.data.csrfToken) setCsrfToken(r.data.csrfToken);
    stateEl.textContent = r.ok ? `Registered: ${r.data.user.email}` : (r.data.error || 'Register failed');
    track('auth_register', { ok: r.ok, status: r.status });
  });

  document.getElementById('authLogin')?.addEventListener('click', async () => {
    const r = await postJson('/api/auth/login', { email: emailEl.value, password: passEl.value });
    if (r.data.csrfToken) setCsrfToken(r.data.csrfToken);
    stateEl.textContent = r.ok ? `Logged in: ${r.data.user.email}` : (r.data.error || 'Login failed');
    track('auth_login', { ok: r.ok, status: r.status });
  });

  document.getElementById('authLogout')?.addEventListener('click', async () => {
    await postJson('/api/auth/logout', {}, { requireCsrf: true });
    setCsrfToken(null);
    stateEl.textContent = 'Signed out';
    track('auth_logout');
  });

  refresh();
}
