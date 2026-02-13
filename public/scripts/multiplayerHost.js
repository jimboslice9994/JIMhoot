import { sanitizeNickname } from './utils.js';

function toServerDeck(deck) {
  return {
    id: deck.id,
    title: deck.title,
    type: 'mcq',
    items: deck.modes.quiz.map((q) => ({
      id: q.id,
      question: q.question,
      choices: q.choices,
      correct: q.correctChoice,
      explanation: q.explanation || '',
      timeLimitSec: q.timeLimitSec || 10,
    })),
  };
}

export function renderHost(root, decks, ws, playerId) {
  const playable = decks.filter((deck) => deck.modes.quiz.length > 0);
  const options = playable.map((deck) => `<option value="${deck.id}">${deck.title} (${deck.modes.quiz.length})</option>`).join('');

  root.innerHTML = `<section class="card">
    <h2>Host Game</h2>
    <p id="hostWsState" class="muted">Connecting WebSocket…</p>
    <label>Nickname</label><input id="hostNick" value="Host" />
    <label>Quiz Deck</label><select id="hostDeck">${options}</select>
    <button id="hostCreate" type="button" ${playable.length ? '' : 'disabled'}>Create room</button>
    <p id="hostRoom" class="muted">${playable.length ? '' : 'No quiz decks available. Import CSV first.'}</p>
    <button id="hostStart" class="hidden" type="button">Start game</button>
    <button id="hostNext" class="hidden" type="button">Next question</button>
  </section>`;

  let roomCode = null;
  const selectedDeck = () => playable.find((deck) => deck.id === document.getElementById('hostDeck')?.value);

  document.getElementById('hostCreate')?.addEventListener('click', () => {
    const nickname = sanitizeNickname(document.getElementById('hostNick')?.value) || 'Host';
    const deck = selectedDeck();
    if (!deck) return;
    ws.send('join_room', { role: 'host', playerId, nickname, deck: toServerDeck(deck) });
  });

  document.getElementById('hostStart')?.addEventListener('click', () => {
    if (roomCode) ws.send('start_game', { roomCode, playerId });
  });

  document.getElementById('hostNext')?.addEventListener('click', () => {
    if (roomCode) ws.send('next_question', { roomCode, playerId });
  });

  ws.on('connection_state', (state) => {
    const el = document.getElementById('hostWsState');
    if (el) el.textContent = state.connected ? 'Realtime connected' : 'Realtime disconnected. Reconnecting…';
  });

  ws.on('lobby_state', (payload) => {
    roomCode = payload.roomCode;
    ws.setRejoinPayload({ roomCode, playerId, nickname: sanitizeNickname(document.getElementById('hostNick')?.value || 'Host') });
    const roomEl = document.getElementById('hostRoom');
    if (roomEl) roomEl.textContent = `Room: ${roomCode} • Players: ${payload.players.length} • State: ${payload.state}`;
    document.getElementById('hostStart')?.classList.remove('hidden');
  });

  ws.on('question', (payload) => {
    const roomEl = document.getElementById('hostRoom');
    if (roomEl) roomEl.textContent = `Q ${payload.index + 1}/${payload.total} live (code ${payload.roomCode})`;
    document.getElementById('hostNext')?.classList.remove('hidden');
  });
}
