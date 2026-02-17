const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const PORT = 3112;
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}/ws`;
let serverProc;

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(`${BASE_HTTP}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('server did not start');
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_WS);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendEvent(ws, event, payload) {
  ws.send(JSON.stringify({ event, payload, ts: Date.now() }));
}

function waitForEvent(ws, eventName, matcher = null, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timeout waiting for ${eventName}`));
    }, timeoutMs);

    function onMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event !== eventName) return;
      if (matcher && !matcher(msg.payload || {})) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg.payload);
    }

    ws.on('message', onMessage);
  });
}

test.before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), FEATURE_MULTIPLAYER: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

test.after(() => {
  if (serverProc) serverProc.kill('SIGTERM');
});

test('host can create and start room using imported quiz deck payload', async () => {
  const host = await connectWs();
  sendEvent(host, 'join_room', {
    role: 'host',
    playerId: 'host_import_1',
    nickname: 'Host',
    deckId: 'imported_quizdex_1',
    importedDeck: {
      id: 'imported_quizdex_1',
      title: 'Imported Quizdex',
      modes: {
        quiz: [
          {
            id: 'q1',
            question: 'What is 2+2?',
            choices: { A: '1', B: '2', C: '3', D: '4' },
            correctChoice: 'D',
            explanation: 'Basic math',
          },
        ],
      },
    },
    gameMode: 'classic',
    timerSec: 12,
  });

  const lobby = await waitForEvent(host, 'lobby_state');
  assert.equal(lobby.deck.id, 'imported_quizdex_1');
  assert.equal(lobby.deck.count, 1);

  sendEvent(host, 'start_game', { roomCode: lobby.roomCode, playerId: 'host_import_1' });
  const q = await waitForEvent(host, 'question', (p) => p.roomCode === lobby.roomCode);
  assert.equal(q.prompt, 'What is 2+2?');
  assert.equal(q.choices.D, '4');

  host.close();
});
