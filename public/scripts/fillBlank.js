import { updateDeckStats } from './storage.js';
import { normalizeText } from './utils.js';

export function renderFillBlank(root, deck) {
  const source = deck?.modes?.fillBlank || [];
  if (!source.length) {
    root.innerHTML = '<div class="card"><p>No fill-in-the-blank items for this deck.</p></div>';
    return;
  }

  let idx = 0;
  let queue = [...source];
  const missed = [];
  let score = 0;
  let hintStep = 0;

  function record(correct) {
    updateDeckStats(deck.id, (s) => {
      s.attempts += 1;
      if (correct) {
        s.correct += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
      } else {
        s.streak = 0;
      }
      return s;
    });
  }

  function nextQuestion() {
    idx += 1;
    hintStep = 0;
    if (idx >= queue.length && missed.length) {
      queue = [...missed];
      missed.length = 0;
      idx = 0;
    }
    draw();
  }

  function hintFor(answer) {
    if (hintStep === 0) {
      hintStep = 1;
      return `Hint: starts with "${answer.charAt(0)}"`;
    }
    hintStep = 2;
    const revealChars = Math.max(1, Math.floor(answer.length / 2));
    return `Hint: ${answer.slice(0, revealChars)}${'•'.repeat(Math.max(0, answer.length - revealChars))}`;
  }

  function draw() {
    const item = queue[idx];
    if (!item) {
      const accuracy = queue.length ? Math.round((score / queue.length) * 100) : 0;
      root.innerHTML = `<div class="card"><h3>Fill-Blank Complete</h3><p>Score: ${score}/${queue.length}</p><p>Accuracy: ${accuracy}%</p></div>`;
      return;
    }

    root.innerHTML = `
      <div class="card">
        <h3>${deck.title} • Fill in the Blank</h3>
        <p><strong>Q ${idx + 1}/${queue.length}</strong></p>
        <p>${item.sentence}</p>
        <input id="fb-answer" type="text" placeholder="Type your answer" autocomplete="off" />
        <div class="row">
          <button id="fb-submit" type="button">Submit</button>
          <button id="fb-hint" type="button">Hint</button>
        </div>
        <p id="fb-feedback" class="muted"></p>
        <button id="fb-next" class="hidden" type="button">Next</button>
      </div>
    `;

    const answerEl = document.getElementById('fb-answer');
    const feedbackEl = document.getElementById('fb-feedback');
    const nextBtn = document.getElementById('fb-next');

    function lockAndShow(userAnswer) {
      const correct = normalizeText(userAnswer) === normalizeText(item.answer);
      if (correct) {
        score += 1;
        feedbackEl.textContent = `Correct. ${item.explanation || ''}`;
      } else {
        missed.push(item);
        feedbackEl.textContent = `Not quite. Answer: ${item.answer}. ${item.explanation || ''}`;
      }
      record(correct);
      answerEl.disabled = true;
      document.getElementById('fb-submit').disabled = true;
      nextBtn.classList.remove('hidden');
    }

    document.getElementById('fb-submit')?.addEventListener('click', () => lockAndShow(answerEl.value));
    document.getElementById('fb-hint')?.addEventListener('click', () => {
      feedbackEl.textContent = hintFor(String(item.answer || ''));
    });
    nextBtn?.addEventListener('click', nextQuestion);
  }

  draw();
}
