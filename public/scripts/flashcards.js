import { updateDeckStats } from './storage.js';
import { sm2Schedule } from './learning.js';

function sortByDue(cards, deckStats) {
  return [...cards].sort((a, b) => {
    const aDue = deckStats?.itemProgress?.[a.id]?.dueAt || 0;
    const bDue = deckStats?.itemProgress?.[b.id]?.dueAt || 0;
    return aDue - bDue;
  });
}

export function renderFlashcards(root, deck) {
  const sourceCards = deck?.modes?.flashcards || [];
  if (!sourceCards.length) {
    root.innerHTML = '<div class="card"><p>No flashcards available for this deck.</p></div>';
    return;
  }

  let idx = 0;
  let flipped = false;
  let queue = [...sourceCards];
  const missed = [];

  function saveResult(cardId, correct) {
    let updatedStats = null;
    updateDeckStats(deck.id, (s) => {
      s.attempts += 1;
      if (correct) {
        s.correct += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
      } else {
        s.streak = 0;
      }
      const prev = s.itemProgress?.[cardId] || {};
      const schedule = sm2Schedule(prev, correct ? 4 : 2);
      s.itemProgress[cardId] = { ...prev, ...schedule };
      updatedStats = s;
      return s;
    });
    queue = sortByDue(queue, updatedStats);
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
    const card = queue[idx];
    if (!card) {
      root.innerHTML = '<div class="card"><h3>Done!</h3><p>Completed flashcards.</p></div>';
      return;
    }
    titleEl.textContent = deck.title;
    progressEl.textContent = `Card ${idx + 1}/${queue.length}`;
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
    const card = queue[idx];
    if (!card) return;
    saveResult(card.id, correct);
    if (!correct) missed.push(card);
    idx += 1;

    if (idx >= queue.length && missed.length) {
      queue = [...missed];
      missed.length = 0;
      idx = 0;
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
