const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 3113;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

test.after(() => {
  if (serverProc) serverProc.kill('SIGTERM');
});

test('healthz supports GET and HEAD and returns deployment fields', async () => {
  const getRes = await fetch(`${BASE}/healthz`);
  assert.equal(getRes.status, 200);
  const body = await getRes.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.rooms, 'number');
  assert.equal(typeof body.wsClients, 'number');
  assert.equal(typeof body.uptimeSec, 'number');

  const headRes = await fetch(`${BASE}/healthz`, { method: 'HEAD' });
  assert.equal(headRes.status, 200);
  const headText = await headRes.text();
  assert.equal(headText, '');
});


test('readyz returns 200 while process is healthy', async () => {
  const res = await fetch(`${BASE}/readyz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.shuttingDown, false);
});

