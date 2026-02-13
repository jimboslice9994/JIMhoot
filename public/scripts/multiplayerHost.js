import { sanitizeNickname } from './utils.js';

function joinUrlForRoom(roomCode) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/join?room=${encodeURIComponent(roomCode)}`;
}

function qrImageUrl(joinUrl) {
  const size = '220x220';
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}&data=${encodeURIComponent(joinUrl)}`;
}

export function renderHost(root, decks, ws, playerId) {
  const playable = decks.filter((deck) => deck.modes.quiz.length > 0);
  const options = playable.map((deck) => `<option value="${deck.id}">${deck.title} (${deck.modes.quiz.length})</option>`).join('');

  root.innerHTML = `<section class="card">
    <h2>Host Game</h2>
    <p id="hostWsState" class="muted">Connecting WebSocket…</p>
    <p id="hostLatency" class="muted">RTT: -- ms</p>
    <label>Nickname</label><input id="hostNick" value="Host" />
    <label>Quiz Deck</label><select id="hostDeck">${options}</select>
    <label>Game mode</label><select id="hostMode"><option value="classic">Classic (simultaneous answers)</option></select>
    <label>Question timer (seconds)</label><input id="hostTimer" type="number" min="5" max="120" value="10" />
    <button id="hostCreate" type="button" ${playable.length ? '' : 'disabled'}>Create room</button>
    <p id="hostRoom" class="muted">${playable.length ? '' : 'No quiz decks available. Import CSV first.'}</p>
    <section id="hostShare" class="card hidden">
      <h3>Player Join QR</h3>
      <p class="muted">Scan this QR code or open the link to join quickly.</p>
      <img id="hostQr" alt="QR code for joining this room" loading="lazy" />
      <label>Join link<input id="hostJoinLink" readonly /></label>
      <button id="hostCopyLink" type="button">Copy join link</button>
      <p id="hostCopyState" class="muted" aria-live="polite"></p>
    </section>
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
    const gameMode = document.getElementById('hostMode')?.value || 'classic';
    const timerSec = Number(document.getElementById('hostTimer')?.value) || 10;
    const importedDeck = deck.source === 'imported'
      ? { id: deck.id, title: deck.title, modes: { quiz: deck.modes.quiz } }
      : undefined;
    ws.send('join_room', { role: 'host', playerId, nickname, deckId: deck.id, importedDeck, gameMode, timerSec });
  });

  document.getElementById('hostStart')?.addEventListener('click', () => {
    if (roomCode) ws.send('start_game', { roomCode, playerId });
  });

  document.getElementById('hostNext')?.addEventListener('click', () => {
    if (roomCode) ws.send('next_question', { roomCode, playerId });
  });


  document.getElementById('hostCopyLink')?.addEventListener('click', async () => {
    const link = document.getElementById('hostJoinLink')?.value || '';
    const state = document.getElementById('hostCopyState');
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (state) state.textContent = 'Join link copied.';
    } catch {
      if (state) state.textContent = 'Copy unavailable on this browser; long-press/select link to share.';
    }
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

    const joinUrl = joinUrlForRoom(roomCode);
    const share = document.getElementById('hostShare');
    const qr = document.getElementById('hostQr');
    const linkInput = document.getElementById('hostJoinLink');
    if (share) share.classList.remove('hidden');
    if (qr) qr.src = qrImageUrl(joinUrl);
    if (linkInput) linkInput.value = joinUrl;

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
