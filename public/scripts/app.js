import { initDebugConsole, log } from './debug.js';
import { getRoute, onRouteChange } from './router.js';
import { loadDecks, renderDeckLibrary, getDeckById } from './decks.js';
import { renderFlashcards } from './flashcards.js';
import { renderSoloQuiz } from './soloQuiz.js';
import { renderFillBlank } from './fillBlank.js';
import { parseAndImportCsv } from './csv.js';
import { saveImportedDecks, getPlayerId, getStats } from './storage.js';
import { WsClient } from './wsClient.js';
import { renderHost } from './multiplayerHost.js';
import { renderJoin } from './multiplayerPlayer.js';

initDebugConsole();

const app = document.getElementById('app');
const ws = new WsClient();
ws.connect();
ws.on('error', (p) => log('server.error', p));
ws.on('latency', (p) => log('ws.latency', p));

function renderMasterySnapshot(decks) {
  const stats = getStats();
  const rows = decks
    .map((deck) => {
      const s = stats[deck.id];
      if (!s || !s.attempts) return null;
      const accuracy = Math.round((s.correct / s.attempts) * 100);
      return `<tr><td>${deck.title}</td><td>${s.attempts}</td><td>${accuracy}%</td><td>${s.bestStreak || 0}</td></tr>`;
    })
    .filter(Boolean)
    .join('');

  if (!rows) {
    return '<p class="muted">No study stats yet. Play a round to start tracking mastery.</p>';
  }

  return `<table class="stats-table">
    <thead><tr><th>Deck</th><th>Attempts</th><th>Accuracy</th><th>Best streak</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function launchMode(root, deck, mode) {
  const modeRoot = document.createElement('section');
  modeRoot.id = 'mode-root';
  root.appendChild(modeRoot);

  if (mode === 'flashcards') {
    renderFlashcards(modeRoot, deck);
    return;
  }
  if (mode === 'quiz') {
    const timerInput = document.getElementById('solo-timer');
    const shuffleInput = document.getElementById('solo-shuffle');
    renderSoloQuiz(modeRoot, deck, {
      timerSec: Number(timerInput?.value) || 10,
      shuffle: Boolean(shuffleInput?.checked),
    });
    return;
  }
  if (mode === 'fillBlank') {
    renderFillBlank(modeRoot, deck);
  }
}

async function renderSoloRoute(decks) {
  app.innerHTML = `<section class="card">
    <h2>Deck Library</h2>
    <p class="muted">Select a deck mode below to start studying.</p>
    <div class="row">
      <label>Quiz timer seconds<input id="solo-timer" type="number" min="5" max="90" value="10" /></label>
      <label>Shuffle quiz questions<input id="solo-shuffle" type="checkbox" /></label>
    </div>
    <section id="deck-library" class="deck-library">${renderDeckLibrary(decks)}</section>
  </section>
  <section class="card">
    <h2>Mastery Snapshot</h2>
    ${renderMasterySnapshot(decks)}
  </section>`;

  const library = document.getElementById('deck-library');
  library?.addEventListener('click', (event) => {
    const target = event.target.closest('.mode-launch');
    if (!target) return;
    const deck = getDeckById(decks, target.dataset.deckId);
    if (!deck) return;
    const existing = document.getElementById('mode-root');
    if (existing) existing.remove();
    launchMode(app, deck, target.dataset.mode);
  });
}

async function renderImportRoute() {
  app.innerHTML = `<section class="card">
    <h2>Import CSV</h2>
    <p class="muted">Required column: deck_name. Optional mode columns auto-generate flashcards, quiz, and fill-in-the-blank.</p>
    <label>Paste CSV text</label>
    <textarea id="importText" rows="10" placeholder="Paste CSV here"></textarea>
    <label>Or upload CSV file</label>
    <input id="importFile" type="file" accept=".csv,text/csv" />
    <button id="importBtn" type="button">Import</button>
    <pre id="importReport" class="muted"></pre>
  </section>`;

  async function getCsvText() {
    const pasted = document.getElementById('importText')?.value.trim();
    if (pasted) return pasted;
    const file = document.getElementById('importFile')?.files?.[0];
    if (!file) return '';
    return file.text();
  }

  document.getElementById('importBtn')?.addEventListener('click', async () => {
    const csvText = await getCsvText();
    if (!csvText) {
      document.getElementById('importReport').textContent = 'No CSV provided';
      return;
    }
    const report = parseAndImportCsv(csvText);
    if (report.ok) {
      saveImportedDecks(report.decks);
    }
    document.getElementById('importReport').textContent = JSON.stringify(report, null, 2);
  });
}

async function render() {
  const route = getRoute();
  const decks = await loadDecks();
  const playerId = getPlayerId();

  if (route === 'solo') {
    await renderSoloRoute(decks);
    return;
  }

  if (route === 'host') {
    renderHost(app, decks, ws, playerId);
    return;
  }

  if (route === 'join') {
    renderJoin(app, ws, playerId);
    return;
  }

  if (route === 'import') {
    await renderImportRoute();
    return;
  }

  app.innerHTML = '<section class="card"><h2>Not found</h2><p>Use navigation tabs.</p></section>';
}

onRouteChange(render);
render();
