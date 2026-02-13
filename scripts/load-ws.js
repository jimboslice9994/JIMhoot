const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { generateSyntheticData, writeSyntheticFile } = require('./generate-synthetic-data');

const PORT = Number(process.env.LOAD_PORT || 3400);
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}/ws`;
const CLIENTS = Number(process.env.LOAD_CLIENTS || 120);
const ROOMS = Number(process.env.LOAD_ROOMS || 6);
const ROOM_CAP = 20;

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const res = await fetch(`${BASE_HTTP}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('server failed to start for load test');
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_WS);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function createHost(roomIdx) {
  const ws = await connectWs();
  const playerId = `host_${roomIdx}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('host join timeout')), 4000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event === 'lobby_state' && msg.payload?.roomCode) {
        clearTimeout(timeout);
        resolve({ ws, roomCode: msg.payload.roomCode, playerId });
      }
    });

    ws.send(JSON.stringify({
      event: 'join_room',
      payload: {
        role: 'host',
        playerId,
        nickname: `Host${roomIdx}`,
        deckId: 'bio_mastery',
        gameMode: 'classic',
        timerSec: 10,
      },
      ts: Date.now(),
    }));
  });
}

async function runPlayer(roomCode, idx) {
  const ws = await connectWs();
  const playerId = `load_p_${idx}`;
  const t0 = Date.now();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('player join timeout'));
    }, 6000);

    let joinMs = null;
    let rttMs = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (!joinMs && msg.event === 'lobby_state' && msg.payload?.roomCode === roomCode) {
        joinMs = Date.now() - t0;
        ws.send(JSON.stringify({ event: 'ping', payload: { sentTs: Date.now() }, ts: Date.now() }));
      }

      if (msg.event === 'pong') {
        const sentTs = Number(msg.payload?.sentTs || 0);
        if (sentTs) rttMs = Date.now() - sentTs;
      }

      if (joinMs !== null && rttMs !== null) {
        clearTimeout(timeout);
        ws.close();
        resolve({ joinMs, rttMs });
      }
    });

    ws.send(JSON.stringify({
      event: 'join_room',
      payload: {
        role: 'player',
        roomCode,
        playerId,
        nickname: `Player${idx}`,
      },
      ts: Date.now(),
    }));
  });
}

async function runWithRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn(); } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer();

    const synthetic = generateSyntheticData({ decks: 6, itemsPerDeck: 180, attempts: 7000, users: 600 });
    const syntheticPath = writeSyntheticFile(synthetic);

    const hosts = [];
    for (let i = 0; i < ROOMS; i += 1) hosts.push(await createHost(i + 1));

    const results = [];
    const failures = [];
    const maxPlayersPerRoom = Math.max(1, ROOM_CAP - 1);
    const requestedPlayersPerRoom = Math.max(1, Math.floor(CLIENTS / hosts.length));
    const playersPerRoom = Math.min(maxPlayersPerRoom, requestedPlayersPerRoom);
    const capacityLimited = requestedPlayersPerRoom > maxPlayersPerRoom;

    const tasks = [];
    let id = 1;
    for (const host of hosts) {
      for (let i = 0; i < playersPerRoom; i += 1) {
        const thisId = id++;
        tasks.push({ roomCode: host.roomCode, id: thisId });
      }
    }

    const batchSize = 24;
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      await Promise.all(batch.map((t) => runWithRetry(() => runPlayer(t.roomCode, t.id), 2)
        .then((res) => results.push(res))
        .catch((err) => failures.push(err.message))));
    }

    hosts.forEach((h) => h.ws.close());

    const joins = results.map((r) => r.joinMs);
    const rtts = results.map((r) => r.rttMs);

    const metricsRes = await fetch(`${BASE_HTTP}/metrics`);
    const metrics = await metricsRes.json();

    console.log(JSON.stringify({
      target: 'WS multi-room load',
      configured: { clients: CLIENTS, rooms: ROOMS, roomCap: ROOM_CAP, effectiveClientsTarget: playersPerRoom * hosts.length, capacityLimited },
      syntheticPath,
      syntheticSummary: synthetic.summary,
      completedClients: results.length,
      failures: failures.length,
      joinMs: {
        p50: Number(percentile(joins, 50).toFixed(2)),
        p95: Number(percentile(joins, 95).toFixed(2)),
      },
      pingRttMs: {
        p50: Number(percentile(rtts, 50).toFixed(2)),
        p95: Number(percentile(rtts, 95).toFixed(2)),
      },
      server: {
        wsHandleP95Ms: metrics.websocket.handleP95Ms,
        rssBytes: metrics.process.rssBytes,
        activeRooms: metrics.rooms?.active,
      },
    }, null, 2));
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
