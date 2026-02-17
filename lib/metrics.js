const { monitorEventLoopDelay } = require('perf_hooks');

const CORE_CACHE_TTL_MS = 250;

function createMetricsTracker() {
  const startedAt = Date.now();
  const wsEvents = Object.create(null);
  const wsHandleDurationsMs = [];
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  let cacheTs = 0;
  let cachedCore = null;

  function invalidateCache() {
    cacheTs = 0;
  }

  function observeWsMessage(event) {
    const key = String(event || 'unknown');
    wsEvents[key] = (wsEvents[key] || 0) + 1;
    invalidateCache();
  }

  function observeWsHandle(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    wsHandleDurationsMs.push(durationMs);
    if (wsHandleDurationsMs.length > 5000) wsHandleDurationsMs.shift();
    invalidateCache();
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return Number(sorted[idx].toFixed(3));
  }

  function coreSnapshot(now) {
    if (cachedCore && now - cacheTs <= CORE_CACHE_TTL_MS) return cachedCore;
    const mem = process.memoryUsage();
    cachedCore = {
      ts: now,
      uptimeSec: Math.floor(process.uptime()),
      startedAt,
      process: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        arrayBuffersBytes: mem.arrayBuffers,
      },
      eventLoop: {
        lagP50Ms: Number((eventLoop.percentile(50) / 1e6).toFixed(3)),
        lagP95Ms: Number((eventLoop.percentile(95) / 1e6).toFixed(3)),
        lagMaxMs: Number((eventLoop.max / 1e6).toFixed(3)),
      },
      websocket: {
        messageCountByEvent: { ...wsEvents },
        handleP50Ms: percentile(wsHandleDurationsMs, 50),
        handleP95Ms: percentile(wsHandleDurationsMs, 95),
        sampleSize: wsHandleDurationsMs.length,
      },
    };
    cacheTs = now;
    return cachedCore;
  }

  function snapshot(extra = {}) {
    const now = Date.now();
    return {
      ...coreSnapshot(now),
      ...extra,
    };
  }

  return {
    observeWsMessage,
    observeWsHandle,
    snapshot,
  };
}

module.exports = { createMetricsTracker };
