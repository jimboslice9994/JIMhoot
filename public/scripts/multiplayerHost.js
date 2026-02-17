import { sanitizeNickname } from './utils.js';

export function renderHost(root, decks, ws, playerId) {
  const playable = decks.filter((deck) => deck.modes.quiz.length > 0);
  const options = playable.map((deck) => `<option value="${deck.id}">${deck.title} (${deck.modes.quiz.length})</option>`).join('');

  root.innerHTML = `<section class="card">
    <h2>Host Game</h2>
    <p id="hostWsState" class="muted">Connecting WebSocket…</p>
    <p id="hostLatency" class="muted">RTT: -- ms</p>
    <label>Nickname</label><input id="hostNick" value="Host" />
    <label>Quiz Deck</label><select id="hostDeck">${options}</select>
    <button id="hostCreate" type="button" ${playable.length ? '' : 'disabled'}>Create room</button>
    <p id="hostRoom" class="muted">${playable.length ? '' : 'No quiz decks available. Import CSV first.'}</p>
    <div class="row">
      <button id="hostStart" class="hidden" type="button">Start game</button>
      <button id="hostNext" class="hidden" type="button">Skip wait / Next</button>
    </div>
  </section>`;

  let roomCode = null;
  const selectedDeck = () => playable.find((deck) => deck.id === document.getElementById('hostDeck')?.value);

  document.getElementById('hostCreate')?.addEventListener('click', () => {
    const nickname = sanitizeNickname(document.getElementById('hostNick')?.value) || 'Host';
    const deck = selectedDeck();
    if (!deck) return;
    ws.send('join_room', { role: 'host', playerId, nickname, deckId: deck.id });
  });

  document.getElementById('hostStart')?.addEventListener('click', () => {
    if (roomCode) ws.send('start_game', { roomCode, playerId });
  });

  document.getElementById('hostNext')?.addEventListener('click', () => {
    if (roomCode) ws.send('next_question', { roomCode, playerId });
  });

  ws.on('connection_state', (state) => {
    const el = document.getElementById('hostWsState');
    if (el) el.textContent = state.connected
      ? `Realtime connected (reconnects: ${state.reconnectCount || 0})`
      : 'Realtime disconnected. Reconnecting…';
  });

  ws.on('latency', (data) => {
    const el = document.getElementById('hostLatency');
    if (el) el.textContent = `RTT: ${Number.isFinite(data.rttMs) ? data.rttMs : '--'} ms`;
  });

  ws.on('lobby_state', (payload) => {
    roomCode = payload.roomCode;
    ws.setRejoinPayload({ roomCode, playerId, nickname: sanitizeNickname(document.getElementById('hostNick')?.value || 'Host') });
    const roomEl = document.getElementById('hostRoom');
    if (roomEl) roomEl.textContent = `Room: ${roomCode} • Players: ${payload.players.length} • State: ${payload.state}`;
    document.getElementById('hostStart')?.classList.remove('hidden');
    document.getElementById('hostNext')?.classList.remove('hidden');
  });

  ws.on('question', (payload) => {
    const roomEl = document.getElementById('hostRoom');
    if (roomEl) roomEl.textContent = `Q ${payload.index + 1}/${payload.total} live (code ${payload.roomCode})`;
  });

  ws.on('phase_update', (payload) => {
    if (payload.roomCode !== roomCode) return;
    const roomEl = document.getElementById('hostRoom');
    if (roomEl) roomEl.textContent = `Room ${roomCode} • Phase: ${payload.state}`;
  });
}
