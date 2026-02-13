const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3105;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

function parseCookies(setCookieHeaders) {
  const cookies = [];
  for (const raw of setCookieHeaders) cookies.push(raw.split(';')[0]);
  return cookies.join('; ');
}

test.before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), FEATURE_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

test.after(() => {
  if (serverProc) serverProc.kill('SIGTERM');
});

test('auth endpoints rotate session and enforce csrf on logout', async () => {
  const email = `security_${Date.now()}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  assert.equal(reg.status, 201);
  const regData = await reg.json();
  assert.ok(regData.csrfToken);

  const regCookies = parseCookies(reg.headers.getSetCookie());
  assert.match(regCookies, /sid=/);
  assert.match(regCookies, /csrf=/);

  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: regCookies } });
  assert.equal(me.status, 200);
  const meData = await me.json();
  assert.equal(meData.user.email, email.toLowerCase());
  assert.ok(meData.csrfToken);

  const logoutNoCsrf = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: regCookies, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(logoutNoCsrf.status, 403);

  const logoutWithCsrf = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: regCookies, 'content-type': 'application/json', 'x-csrf-token': meData.csrfToken },
    body: JSON.stringify({}),
  });
  assert.equal(logoutWithCsrf.status, 204);
});
