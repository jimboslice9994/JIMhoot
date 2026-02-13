import { log } from './debug.js';

export class WsClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.manualClose = false;
    this.backoff = 600;
    this.maxBackoff = 8000;
    this.rejoinPayload = null;
    this.pingTimer = null;
    this.reconnectCount = 0;
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
      }

      if (data.event === 'pong') {
        const sentTs = Number(data.payload?.sentTs || 0);
        const rttMs = sentTs ? Date.now() - sentTs : null;
        this.emit('latency', { rttMs, serverTs: data.payload?.serverTs || null });
      }

      log('ws.message', { event: data.event });
      this.emit(data.event, data.payload);
    });

    this.ws.addEventListener('close', () => {
      log('ws.close');
      this.stopClientPing();
      this.emit('connection_state', { connected: false, reconnectCount: this.reconnectCount });
      if (this.manualClose) return;
      this.reconnectCount += 1;
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
  }

  close() {
    this.manualClose = true;
    this.stopClientPing();
    this.ws?.close();
  }
}
