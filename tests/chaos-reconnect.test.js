const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const PORT = 3110;
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

test('player reconnects mid-question and receives question snapshot', async () => {
  const host = await connectWs();
  sendEvent(host, 'join_room', {
    role: 'host',
    playerId: 'host_reconnect_1',
    nickname: 'Host',
    deckId: 'bio_mastery',
    gameMode: 'classic',
    timerSec: 20,
  });
  const hostLobby = await waitForEvent(host, 'lobby_state');
  const roomCode = hostLobby.roomCode;

  const playerId = 'player_reconnect_1';
  const player = await connectWs();
  sendEvent(player, 'join_room', {
    role: 'player',
    roomCode,
    playerId,
    nickname: 'Player',
  });
  await waitForEvent(player, 'lobby_state', (p) => p.roomCode === roomCode);

  sendEvent(host, 'start_game', { roomCode, playerId: 'host_reconnect_1' });
  await waitForEvent(player, 'question', (p) => p.roomCode === roomCode);

  player.close();
  await new Promise((r) => setTimeout(r, 180));

  const rejoin = await connectWs();
  sendEvent(rejoin, 'rejoin_room', { roomCode, playerId, nickname: 'Player' });
  const q = await waitForEvent(rejoin, 'question', (p) => p.roomCode === roomCode);
  assert.equal(q.roomCode, roomCode);
  assert.equal(typeof q.questionInstanceId, 'string');

  rejoin.close();
  host.close();
});
