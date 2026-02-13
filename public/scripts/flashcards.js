import { getStats, saveStats } from './storage.js';

export function renderFlashcards(root, deck) {
  const cards = deck?.modes?.flashcards || [];
  if (!cards.length) {
    root.innerHTML = '<div class="card"><p>No flashcards available for this deck.</p></div>';
    return;
  }

  let idx = 0;
  let flipped = false;
  const missed = [];

  function saveResult(correct) {
    const stats = getStats();
    stats[deck.id] = stats[deck.id] || { attempts: 0, correct: 0 };
    stats[deck.id].attempts += 1;
    if (correct) stats[deck.id].correct += 1;
    saveStats(stats);
  }

  root.innerHTML = `
    <div class="card">
      <h3 id="fc-title"></h3>
      <p id="fc-progress"></p>
      <button id="fc-flip" type="button">Flip card</button>
      <div class="flashcard-shell" id="fc-shell">
        <div class="flashcard" id="fc-card" role="button" tabindex="0" aria-label="Flashcard">
          <div class="flashcard-face flashcard-front" id="fc-front"></div>
          <div class="flashcard-face flashcard-back" id="fc-back"></div>
        </div>
      </div>
      <div class="row">
        <button id="fc-correct" type="button">Correct</button>
        <button id="fc-wrong" type="button">Incorrect</button>
      </div>
    </div>
  `;

  const titleEl = document.getElementById('fc-title');
  const progressEl = document.getElementById('fc-progress');
  const cardEl = document.getElementById('fc-card');
  const frontEl = document.getElementById('fc-front');
  const backEl = document.getElementById('fc-back');

  function drawCard() {
    const card = cards[idx];
    if (!card) {
      root.innerHTML = '<div class="card"><h3>Done!</h3><p>Completed flashcards.</p></div>';
      return;
    }
    titleEl.textContent = deck.title;
    progressEl.textContent = `Card ${idx + 1}/${cards.length}`;
    frontEl.textContent = card.front;
    backEl.textContent = card.back;
    flipped = false;
    cardEl.classList.remove('is-flipped');
  }

  function flipCard() {
    flipped = !flipped;
    cardEl.classList.toggle('is-flipped', flipped);
  }

  function nextCard(correct) {
    const card = cards[idx];
    saveResult(correct);
    if (!correct && card) missed.push(card);
    idx += 1;

    if (idx >= cards.length && missed.length) {
      cards.push(...missed.splice(0));
    }
    drawCard();
  }

  cardEl.addEventListener('click', flipCard);
  cardEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flipCard();
    }
  });
  document.getElementById('fc-flip')?.addEventListener('click', flipCard);
  document.getElementById('fc-correct')?.addEventListener('click', () => nextCard(true));
  document.getElementById('fc-wrong')?.addEventListener('click', () => nextCard(false));

  drawCard();
}
