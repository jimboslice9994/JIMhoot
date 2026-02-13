export function roomCodeFromHash(hashValue) {
  const hash = String(hashValue || window.location.hash || '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query);
  return String(params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

import { sanitizeNickname } from './utils.js';

export function renderJoin(root, ws, playerId) {
  const prefilledRoom = roomCodeFromHash(window.location.hash);

  root.innerHTML = `<section class="card">
    <h2>Join Game</h2>
    <p id="joinWsState" class="muted">Connecting WebSocket…</p>
    <p id="joinLatency" class="muted">RTT: -- ms</p>
    <label>Room code</label><input id="joinRoom" maxlength="5" value="${prefilledRoom}" />
    <label>Nickname</label><input id="joinNick" />
    <button id="joinBtn" type="button">Join</button>
    <p id="joinState" class="muted" aria-live="polite"></p>
  </section>
  <section id="answerCard" class="card hidden">
    <h3 id="qTitle">Question</h3>
    <p>Time left: <span id="joinTimer">0</span>s</p>
    <div class="choices" id="choiceWrap">
      <button data-choice="A" type="button">A</button>
      <button data-choice="B" type="button">B</button>
      <button data-choice="C" type="button">C</button>
      <button data-choice="D" type="button">D</button>
    </div>
    <p id="ack" class="muted" aria-live="polite"></p>
  </section>`;

  let roomCode = '';
  let questionInstanceId = '';
  let timer = null;

  const choiceButtons = () => [...document.querySelectorAll('[data-choice]')];
  const lockChoices = (locked) => {
    choiceButtons().forEach((btn) => {
      btn.disabled = locked;
    });
  };

  document.getElementById('joinBtn')?.addEventListener('click', () => {
    roomCode = String(document.getElementById('joinRoom')?.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    const nickname = sanitizeNickname(document.getElementById('joinNick')?.value);
    ws.send('join_room', { role: 'player', roomCode, playerId, nickname });
    ws.setRejoinPayload({ roomCode, playerId, nickname });
  });

  choiceButtons().forEach((btn) => {
    btn.addEventListener('click', () => {
      ws.send('submit_answer', { roomCode, playerId, questionInstanceId, choice: btn.dataset.choice, clientSentTs: Date.now() });
    });
  });

  ws.on('connection_state', (state) => {
    const el = document.getElementById('joinWsState');
    if (el) el.textContent = state.connected
      ? `Realtime connected (reconnects: ${state.reconnectCount || 0})`
      : 'Realtime disconnected. Reconnecting…';
  });

  ws.on('latency', (data) => {
    const el = document.getElementById('joinLatency');
    if (el) el.textContent = `RTT: ${Number.isFinite(data.rttMs) ? data.rttMs : '--'} ms`;
  });

  ws.on('lobby_state', (payload) => {
    if (payload.roomCode !== roomCode) return;
    const stateEl = document.getElementById('joinState');
    if (stateEl) stateEl.textContent = `Connected. Players: ${payload.players.length} • State: ${payload.state} • Mode: ${payload.settings?.gameMode || 'classic'} • Timer: ${payload.settings?.timerSec || '--'}s`; 
  });

  ws.on('question', (payload) => {
    if (payload.roomCode !== roomCode) return;
    questionInstanceId = payload.questionInstanceId;
    document.getElementById('answerCard')?.classList.remove('hidden');
    const wrap = document.getElementById('choiceWrap');
    if (wrap) wrap.classList.add('fade-in');

    document.getElementById('qTitle').textContent = payload.prompt;
    document.querySelector('[data-choice="A"]').textContent = `A) ${payload.choices.A}`;
    document.querySelector('[data-choice="B"]').textContent = `B) ${payload.choices.B}`;
    document.querySelector('[data-choice="C"]').textContent = `C) ${payload.choices.C}`;
    document.querySelector('[data-choice="D"]').textContent = `D) ${payload.choices.D}`;

    const ackEl = document.getElementById('ack');
    if (ackEl) ackEl.textContent = payload.alreadySubmitted
      ? `Already submitted${payload.submittedChoice ? `: ${payload.submittedChoice}` : ''}`
      : '';

    lockChoices(Boolean(payload.alreadySubmitted));

    clearInterval(timer);
    timer = setInterval(() => {
      const msLeft = payload.serverStartTs + payload.timeLimitMs - Date.now();
      const sec = Math.max(0, Math.ceil(msLeft / 1000));
      const timerEl = document.getElementById('joinTimer');
      if (timerEl) timerEl.textContent = String(sec);
      if (sec <= 0) {
        clearInterval(timer);
        lockChoices(true);
      }
    }, 250);
  });

  ws.on('answer_ack', (payload) => {
    const ackEl = document.getElementById('ack');
    if (ackEl) ackEl.textContent = `Answer status: ${payload.status}`;
    if (payload.status === 'accepted' || payload.status === 'duplicate') lockChoices(true);
  });

  ws.on('phase_update', (payload) => {
    if (payload.roomCode !== roomCode) return;
    const stateEl = document.getElementById('joinState');
    if (stateEl) stateEl.textContent = `Phase: ${payload.state}`;
  });

  ws.on('reveal', (payload) => {
    if (payload.roomCode !== roomCode) return;
    const ackEl = document.getElementById('ack');
    if (ackEl) ackEl.textContent = `Correct answer: ${payload.correct}`;
  });
}
