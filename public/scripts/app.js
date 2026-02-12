import { initDebugConsole, log } from './debug.js';
import { getRoute, onRouteChange } from './router.js';
import { loadDecks, renderDeckLibrary } from './decks.js';
import { renderFlashcards } from './flashcards.js';
import { renderSoloQuiz } from './soloQuiz.js';
import { parseAndImportCsv } from './csv.js';
import { saveImportedDeck, getPlayerId } from './storage.js';
import { WsClient } from './wsClient.js';
import { renderHost } from './multiplayerHost.js';
import { renderJoin } from './multiplayerPlayer.js';

initDebugConsole();

const app = document.getElementById('app');
const ws = new WsClient();
ws.connect();
ws.on('error', (p) => log('server.error', p));

async function render() {
  const route = getRoute();
  const decks = await loadDecks();
  const flashDeck = decks.find((d) => d.type === 'flashcards');
  const mcqDeck = decks.find((d) => d.type === 'mcq');
  const playerId = getPlayerId();

  if (route === 'solo') {
    app.innerHTML = `<section class="card"><h2>Deck Library</h2>${renderDeckLibrary(decks)}</section>
      <section id="soloMode"></section>
      <section id="flashMode"></section>`;
    renderSoloQuiz(document.getElementById('soloMode'), mcqDeck);
    renderFlashcards(document.getElementById('flashMode'), flashDeck);
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
    app.innerHTML = `<section class="card">
      <h2>Import CSV</h2>
      <label>Deck type</label>
      <select id="importType"><option value="flashcards">Flashcards</option><option value="mcq">MCQ</option></select>
      <label>Paste CSV text</label>
      <textarea id="importText" rows="8" placeholder="Paste CSV here"></textarea>
      <label>Or upload CSV file</label>
      <input id="importFile" type="file" accept=".csv,text/csv" />
      <button id="importBtn">Import</button>
      <pre id="importReport" class="muted"></pre>
    </section>`;

    async function getCsvText() {
      const pasted = document.getElementById('importText').value.trim();
      if (pasted) return pasted;
      const file = document.getElementById('importFile').files?.[0];
      if (!file) return '';
      return file.text();
    }

    document.getElementById('importBtn')?.addEventListener('click', async () => {
      const csvText = await getCsvText();
      if (!csvText) {
        document.getElementById('importReport').textContent = 'No CSV provided';
        return;
      }
      const deckType = document.getElementById('importType').value;
      const report = parseAndImportCsv(csvText, deckType);
      if (report.ok) saveImportedDeck(report.deck);
      document.getElementById('importReport').textContent = JSON.stringify(report, null, 2);
    });
    return;
  }

  app.innerHTML = '<section class="card"><h2>Not found</h2><p>Use navigation tabs.</p></section>';
}

onRouteChange(render);
render();
