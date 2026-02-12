import { sanitizeNickname } from './utils.js';

export function renderHost(root, decks, ws, playerId) {
  const mcqDecks = decks.filter((d) => d.type === 'mcq');
  const options = mcqDecks.map((d) => `<option value="${d.id}">${d.title} (${d.items.length})</option>`).join('');
  root.innerHTML = `<section class="card">
    <h2>Host Game</h2>
    <label>Nickname</label><input id="hostNick" value="Host" />
    <label>MCQ Deck</label><select id="hostDeck">${options}</select>
    <button id="hostCreate">Create room</button>
    <p id="hostRoom" class="muted"></p>
    <button id="hostStart" class="hidden">Start game</button>
    <button id="hostNext" class="hidden">Next question</button>
  </section>`;

  let roomCode = null;
  const selectedDeck = () => mcqDecks.find((d) => d.id === document.getElementById('hostDeck')?.value);

  document.getElementById('hostCreate')?.addEventListener('click', () => {
    const nickname = sanitizeNickname(document.getElementById('hostNick')?.value) || 'Host';
    ws.send('join_room', { role: 'host', playerId, nickname, deck: selectedDeck() });
  });

  document.getElementById('hostStart')?.addEventListener('click', () => {
    if (roomCode) ws.send('start_game', { roomCode, playerId });
  });

  document.getElementById('hostNext')?.addEventListener('click', () => {
    if (roomCode) ws.send('next_question', { roomCode, playerId });
  });

  ws.on('lobby_state', (payload) => {
    roomCode = payload.roomCode;
    ws.setRejoinPayload({ roomCode, playerId, nickname: sanitizeNickname(document.getElementById('hostNick')?.value || 'Host') });
    document.getElementById('hostRoom').textContent = `Room: ${roomCode} • Players: ${payload.players.length}`;
    document.getElementById('hostStart').classList.remove('hidden');
  });

  ws.on('question', (payload) => {
    document.getElementById('hostRoom').textContent = `Q ${payload.index + 1}/${payload.total} live (code ${payload.roomCode})`;
    document.getElementById('hostNext').classList.remove('hidden');
  });
}
