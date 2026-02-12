import { getStats, saveStats } from './storage.js';

export function renderFlashcards(root, deck) {
  if (!deck || !deck.items.length) {
    root.innerHTML = '<div class="card"><p>No flashcards available.</p></div>';
    return;
  }
  let idx = 0;
  let showingBack = false;
  const missed = [];

  function saveResult(correct) {
    const stats = getStats();
    stats[deck.id] = stats[deck.id] || { attempts: 0, correct: 0 };
    stats[deck.id].attempts += 1;
    if (correct) stats[deck.id].correct += 1;
    saveStats(stats);
  }

  function nextCard() {
    idx += 1;
    showingBack = false;
    if (idx >= deck.items.length && missed.length) {
      deck = { ...deck, items: [...missed] };
      idx = 0;
      missed.length = 0;
    }
    draw();
  }

  function draw() {
    const card = deck.items[idx];
    if (!card) {
      root.innerHTML = '<div class="card"><h3>Done!</h3><p>Completed flashcards.</p></div>';
      return;
    }
    root.innerHTML = `<div class="card">
      <h3>${deck.title}</h3>
      <p><strong>Card ${idx + 1}/${deck.items.length}</strong></p>
      <p>${showingBack ? card.back : card.front}</p>
      <button id="revealBtn">${showingBack ? 'Hide answer' : 'Reveal answer'}</button>
      <div class="row">
        <button id="correctBtn">Correct</button>
        <button id="wrongBtn">Incorrect</button>
      </div>
    </div>`;

    document.getElementById('revealBtn')?.addEventListener('click', () => { showingBack = !showingBack; draw(); });
    document.getElementById('correctBtn')?.addEventListener('click', () => { saveResult(true); nextCard(); });
    document.getElementById('wrongBtn')?.addEventListener('click', () => { saveResult(false); missed.push(card); nextCard(); });
  }

  draw();
}
