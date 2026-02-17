import { initDebugConsole, log } from './debug.js';
import { getRoute, onRouteChange } from './router.js';
import { loadDecks, renderDeckLibrary, getDeckById } from './decks.js';
import { renderFlashcards } from './flashcards.js';
import { renderSoloQuiz } from './soloQuiz.js';
import { renderFillBlank } from './fillBlank.js';
import { parseImportText } from './importer.js';
import { saveImportedDecks, getPlayerId, getStats, setAnalyticsOptIn, getAnalyticsOptIn } from './storage.js';
import { WsClient } from './wsClient.js';
import { renderHost } from './multiplayerHost.js';
import { renderJoin } from './multiplayerPlayer.js';
import { loadFeatureFlags } from './featureFlags.js';
import { track } from './analytics.js';
import { renderAuthCard } from './auth.js';

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

  if (!rows) return '<p class="muted">No study stats yet. Play a round to start tracking mastery.</p>';
  return `<table class="stats-table"><thead><tr><th>Deck</th><th>Attempts</th><th>Accuracy</th><th>Best streak</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderModeSwitcher(active) {
  return `<section class="card" aria-label="Mode Switcher">
    <div class="row">
      <button type="button" data-nav="#/solo" ${active === 'solo' ? 'aria-current="page"' : ''}>Study</button>
      <button type="button" data-nav="#/import" ${active === 'import' ? 'aria-current="page"' : ''}>Import</button>
      <button type="button" data-nav="#/host" ${active === 'host' ? 'aria-current="page"' : ''}>Host</button>
      <button type="button" data-nav="#/join" ${active === 'join' ? 'aria-current="page"' : ''}>Join</button>
    </div>
  </section>`;
}

function bindModeNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.hash = btn.dataset.nav;
    });
  });
}

function launchMode(root, deck, mode) {
  const modeRoot = document.createElement('section');
  modeRoot.id = 'mode-root';
  root.appendChild(modeRoot);

  track('study_mode_opened', { deckId: deck.id, mode });

  if (mode === 'flashcards') return renderFlashcards(modeRoot, deck);
  if (mode === 'quiz') {
    const timerInput = document.getElementById('solo-timer');
    const shuffleInput = document.getElementById('solo-shuffle');
    return renderSoloQuiz(modeRoot, deck, {
      timerSec: Number(timerInput?.value) || 10,
      shuffle: Boolean(shuffleInput?.checked),
    });
  }
  if (mode === 'fillBlank') return renderFillBlank(modeRoot, deck);
}

async function renderSoloRoute(decks) {
  app.innerHTML = `${renderModeSwitcher('solo')}
  <section class="card">
    <h2>Deck Library</h2>
    <p class="muted">Select a deck mode below to start studying.</p>
    <div class="row">
      <label>Quiz timer seconds<input id="solo-timer" type="number" min="5" max="90" value="10" /></label>
      <label>Shuffle quiz questions<input id="solo-shuffle" type="checkbox" /></label>
    </div>
    <section id="deck-library" class="deck-library">${renderDeckLibrary(decks)}</section>
  </section>
  <section class="card"><h2>Mastery Snapshot</h2>${renderMasterySnapshot(decks)}</section>`;

  bindModeNav();
  renderAuthCard(app, await loadFeatureFlags());

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
  app.innerHTML = `${renderModeSwitcher('import')}
  <section class="card">
    <h2>Import Decks</h2>
    <p class="muted">Upload CSV or JSON deck payload with validation.</p>
    <label>Import type</label>
    <select id="importType"><option value="csv">CSV</option><option value="json">JSON</option></select>
    <label>Paste text</label>
    <textarea id="importText" rows="10" placeholder="Paste CSV/JSON here"></textarea>
    <label>Or upload file</label>
    <input id="importFile" type="file" accept=".csv,.json,text/csv,application/json" />
    <button id="importBtn" type="button">Import</button>
    <pre id="importReport" class="muted"></pre>
  </section>`;

  bindModeNav();

  async function getText() {
    const pasted = document.getElementById('importText')?.value.trim();
    if (pasted) return pasted;
    const file = document.getElementById('importFile')?.files?.[0];
    if (!file) return '';
    return file.text();
  }

  document.getElementById('importBtn')?.addEventListener('click', async () => {
    try {
      const inputText = await getText();
      if (!inputText) {
        document.getElementById('importReport').textContent = 'No input provided';
        return;
      }
      const type = document.getElementById('importType').value;
      const report = parseImportText(inputText, type);
      if (report.ok) {
        saveImportedDecks(report.decks);
        track('deck_imported', { sourceType: report.sourceType, count: report.decks.length });
      }
      document.getElementById('importReport').textContent = JSON.stringify(report, null, 2);
    } catch {
      document.getElementById('importReport').textContent = 'Import failed. Please check file format and try again.';
      track('deck_import_failed');
    }
  });
}

function renderAnalyticsToggle(flags) {
  if (!flags.analytics) return '';
  const checked = getAnalyticsOptIn() ? 'checked' : '';
  return `<section class="card"><label><input type="checkbox" id="analyticsOpt" ${checked} /> Enable anonymous analytics</label></section>`;
}

async function render() {
  const route = getRoute();
  const decks = await loadDecks();
  const playerId = getPlayerId();
  const flags = await loadFeatureFlags();

  if (route === 'solo') {
    await renderSoloRoute(decks);
    app.insertAdjacentHTML('beforeend', renderAnalyticsToggle(flags));
    document.getElementById('analyticsOpt')?.addEventListener('change', (e) => setAnalyticsOptIn(e.target.checked));
    return;
  }

  if (route === 'host') {
    app.innerHTML = renderModeSwitcher('host');
    bindModeNav();
    if (!flags.multiplayer) {
      app.insertAdjacentHTML('beforeend', '<section class="card"><p>Multiplayer is temporarily disabled by feature flag.</p></section>');
      return;
    }
    renderHost(app, decks, ws, playerId);
    return;
  }

  if (route === 'join') {
    app.innerHTML = renderModeSwitcher('join');
    bindModeNav();
    if (!flags.multiplayer) {
      app.insertAdjacentHTML('beforeend', '<section class="card"><p>Multiplayer is temporarily disabled by feature flag.</p></section>');
      return;
    }
    renderJoin(app, ws, playerId);
    return;
  }

  if (route === 'import') {
    await renderImportRoute();
    return;
  }

  app.innerHTML = `${renderModeSwitcher('solo')}<section class="card"><h2>Not found</h2><p>Use navigation tabs.</p></section>`;
  bindModeNav();
}

onRouteChange(render);
render();
