const { spawn } = require('node:child_process');

const PORT = Number(process.env.BENCH_PORT || 3300);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server failed to start for benchmark');
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer();
    const rounds = 80;
    const latencies = [];

    for (let i = 0; i < rounds; i += 1) {
      const t0 = performance.now();
      const res = await fetch(`${BASE}/metrics`);
      if (!res.ok) throw new Error(`metrics returned ${res.status}`);
      await res.json();
      latencies.push(performance.now() - t0);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log(JSON.stringify({
      target: 'GET /metrics',
      rounds,
      avgMs: Number(avg.toFixed(2)),
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
    }, null, 2));
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
