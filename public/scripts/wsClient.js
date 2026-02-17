const REJOIN_STORAGE_KEY = 'study.rejoinPayload';

import { log } from './debug.js';

export class WsClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.manualClose = false;
    this.backoff = 600;
    this.maxBackoff = 8000;
    this.rejoinPayload = this.loadRejoinPayload();
    this.pingTimer = null;
    this.reconnectCount = 0;
    this.latencySamples = [];
    this.latencySummaryCache = { avg: null, max: null, p50: null, p95: null, count: 0 };
  }

  on(event, cb) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(cb);
  }

  emit(event, payload) {
    (this.handlers.get(event) || []).forEach((cb) => cb(payload));
  }

  startClientPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const sentTs = Date.now();
      this.send('ping', { sentTs });
    }, 5000);
  }

  stopClientPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws`;
    log('ws.connect', { url });
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      log('ws.open');
      this.backoff = 600;
      this.emit('connection_state', { connected: true, reconnectCount: this.reconnectCount });
      this.startClientPing();
      if (this.rejoinPayload) this.send('rejoin_room', this.rejoinPayload);
    });

    this.ws.addEventListener('message', (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }


      if (data.event === 'session_info' && data.payload?.roomCode && data.payload?.playerId && data.payload?.reconnectKey) {
        this.rejoinPayload = {
          ...(this.rejoinPayload || {}),
          roomCode: data.payload.roomCode,
          playerId: data.payload.playerId,
          reconnectKey: data.payload.reconnectKey,
        };
        this.persistRejoinPayload();
      }

      if (data.event === 'pong') {
        const sentTs = Number(data.payload?.sentTs || 0);
        const rttMs = sentTs ? Date.now() - sentTs : null;
        if (Number.isFinite(rttMs)) {
          this.latencySamples.push(rttMs);
          if (this.latencySamples.length > 200) this.latencySamples.shift();
        }
        this.emit('latency', { rttMs, serverTs: data.payload?.serverTs || null, summary: this.getLatencySummary() });
      }

      log('ws.message', { event: data.event });
      this.emit(data.event, data.payload);
    });

    this.ws.addEventListener('close', () => {
      log('ws.close');
      this.stopClientPing();
      if (!this.manualClose) this.reconnectCount += 1;
      this.emit('connection_state', { connected: false, reconnectCount: this.reconnectCount });
      if (this.manualClose) return;
      const jitter = Math.floor(Math.random() * 200);
      const delay = this.backoff + jitter;
      setTimeout(() => this.connect(), delay);
      this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    });

    this.ws.addEventListener('error', (e) => log('ws.error', { type: e.type }));
  }

  send(event, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log('ws.send.skip', { event });
      return false;
    }
    this.ws.send(JSON.stringify({ event, payload, ts: Date.now() }));
    return true;
  }

  setRejoinPayload(payload) {
    this.rejoinPayload = { ...(this.rejoinPayload || {}), ...(payload || {}) };
    this.persistRejoinPayload();
  }

  persistRejoinPayload() {
    try {
      if (!this.rejoinPayload) return;
      localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify(this.rejoinPayload));
    } catch {}
  }

  loadRejoinPayload() {
    try {
      const raw = localStorage.getItem(REJOIN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  getLatencySummary() {
    if (!this.latencySamples.length) {
      this.latencySummaryCache = { avg: null, max: null, p50: null, p95: null, count: 0 };
      return this.latencySummaryCache;
    }

    if (this.latencySummaryCache.count === this.latencySamples.length && this.latencySamples.length % 5 !== 0) {
      return this.latencySummaryCache;
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const pick = (p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)))];
    const sum = this.latencySamples.reduce((acc, n) => acc + n, 0);
    this.latencySummaryCache = {
      avg: Math.round((sum / this.latencySamples.length) * 100) / 100,
      max: sorted[sorted.length - 1],
      p50: pick(0.5),
      p95: pick(0.95),
      count: this.latencySamples.length,
    };
    return this.latencySummaryCache;
  }

  close() {

    this.manualClose = true;
    this.stopClientPing();
    this.ws?.close();
  }
}
