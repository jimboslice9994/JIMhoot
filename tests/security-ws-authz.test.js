const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const PORT = 3106;
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}/ws`;
let serverProc;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE_HTTP}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
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

function waitForEvent(ws, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timeout waiting for ${eventName}`));
    }, timeoutMs);

    function onMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.event !== eventName) return;
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

test('player socket cannot impersonate host to start game', async () => {
  const hostId = 'host_1';
  const playerId = 'player_2';

  const hostWs = await connectWs();
  sendEvent(hostWs, 'join_room', {
    role: 'host',
    playerId: hostId,
    nickname: 'Host',
    deckId: 'bio_mastery',
    gameMode: 'classic',
    timerSec: 10,
  });
  const hostLobby = await waitForEvent(hostWs, 'lobby_state');
  const roomCode = hostLobby.roomCode;
  assert.ok(roomCode);

  const playerWs = await connectWs();
  sendEvent(playerWs, 'join_room', {
    role: 'player',
    roomCode,
    playerId,
    nickname: 'Player',
  });
  await waitForEvent(playerWs, 'lobby_state');

  sendEvent(playerWs, 'start_game', { roomCode, playerId: hostId });
  const err = await waitForEvent(playerWs, 'error');
  assert.equal(err.code, 'UNAUTHORIZED');

  hostWs.close();
  playerWs.close();
});
