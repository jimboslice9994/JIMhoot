import { sanitizeNickname } from './utils.js';

export function renderJoin(root, ws, playerId) {
  root.innerHTML = `<section class="card">
    <h2>Join Game</h2>
    <label>Room code</label><input id="joinRoom" maxlength="5" />
    <label>Nickname</label><input id="joinNick" />
    <button id="joinBtn">Join</button>
    <p id="joinState" class="muted"></p>
  </section>
  <section id="answerCard" class="card hidden">
    <h3 id="qTitle">Question</h3>
    <p>Time left: <span id="joinTimer">0</span>s</p>
    <div class="choices">
      <button data-choice="A">A</button>
      <button data-choice="B">B</button>
      <button data-choice="C">C</button>
      <button data-choice="D">D</button>
    </div>
    <p id="ack" class="muted"></p>
  </section>`;

  let roomCode = '';
  let questionInstanceId = '';
  let timer = null;

  document.getElementById('joinBtn')?.addEventListener('click', () => {
    roomCode = String(document.getElementById('joinRoom')?.value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    const nickname = sanitizeNickname(document.getElementById('joinNick')?.value);
    ws.send('join_room', { role: 'player', roomCode, playerId, nickname });
    ws.setRejoinPayload({ roomCode, playerId, nickname });
  });

  document.querySelectorAll('[data-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ws.send('submit_answer', { roomCode, playerId, questionInstanceId, choice: btn.dataset.choice, clientSentTs: Date.now() });
    });
  });

  ws.on('lobby_state', (payload) => {
    if (payload.roomCode !== roomCode) return;
    document.getElementById('joinState').textContent = `Connected. Players: ${payload.players.length}`;
  });

  ws.on('question', (payload) => {
    if (payload.roomCode !== roomCode) return;
    questionInstanceId = payload.questionInstanceId;
    document.getElementById('answerCard').classList.remove('hidden');
    document.getElementById('qTitle').textContent = payload.prompt;
    document.querySelector('[data-choice="A"]').textContent = `A) ${payload.choices.A}`;
    document.querySelector('[data-choice="B"]').textContent = `B) ${payload.choices.B}`;
    document.querySelector('[data-choice="C"]').textContent = `C) ${payload.choices.C}`;
    document.querySelector('[data-choice="D"]').textContent = `D) ${payload.choices.D}`;

    clearInterval(timer);
    timer = setInterval(() => {
      const msLeft = payload.serverStartTs + payload.timeLimitMs - Date.now();
      const sec = Math.max(0, Math.ceil(msLeft / 1000));
      document.getElementById('joinTimer').textContent = String(sec);
      if (sec <= 0) clearInterval(timer);
    }, 200);
  });

  ws.on('answer_ack', (payload) => {
    document.getElementById('ack').textContent = `Answer status: ${payload.status}`;
  });

  ws.on('reveal', (payload) => {
    if (payload.roomCode !== roomCode) return;
    document.getElementById('ack').textContent = `Correct answer: ${payload.correct}`;
  });
}
