const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { generateSyntheticData, writeSyntheticFile } = require('./generate-synthetic-data');

const PORT = Number(process.env.BENCH_PORT || 3301);
const BASE_HTTP = `http://127.0.0.1:${PORT}`;
const BASE_WS = `ws://127.0.0.1:${PORT}/ws`;

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(`${BASE_HTTP}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server failed to start for ws benchmark');
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_WS);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer();
    const synthetic = generateSyntheticData({ decks: 4, itemsPerDeck: 120, attempts: 2000, users: 120 });
    const syntheticPath = writeSyntheticFile(synthetic);

    const ws = await connectWs();
    const rounds = 70;
    const rtts = [];

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event !== 'pong') return;
      const sentTs = Number(msg.payload?.sentTs || 0);
      if (sentTs) rtts.push(Date.now() - sentTs);
    });

    for (let i = 0; i < rounds; i += 1) {
      ws.send(JSON.stringify({ event: 'ping', payload: { sentTs: Date.now() }, ts: Date.now() }));
      await new Promise((r) => setTimeout(r, 5));
    }

    await new Promise((r) => setTimeout(r, 400));
    ws.close();

    const p50 = percentile(rtts, 50);
    const p95 = percentile(rtts, 95);
    const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;

    const metricsRes = await fetch(`${BASE_HTTP}/metrics`);
    const metrics = await metricsRes.json();

    console.log(JSON.stringify({
      target: 'WS ping/pong',
      syntheticPath,
      syntheticSummary: synthetic.summary,
      rounds,
      observed: rtts.length,
      avgRttMs: Number(avg.toFixed(2)),
      p50RttMs: Number(p50.toFixed(2)),
      p95RttMs: Number(p95.toFixed(2)),
      serverWsHandleP95Ms: metrics.websocket.handleP95Ms,
      serverRssBytes: metrics.process.rssBytes,
    }, null, 2));
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
