import { updateDeckStats } from './storage.js';
import { evaluateFillBlank } from './learning.js';

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
  let asked = 0;
  let hintStep = 0;

  function record(itemId, resultScore) {
    updateDeckStats(deck.id, (s) => {
      s.attempts += 1;
      s.correct += resultScore;
      if (resultScore >= 0.75) {
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
      } else {
        s.streak = 0;
      }
      const prev = s.itemProgress?.[itemId] || { attempts: 0, score: 0 };
      s.itemProgress[itemId] = {
        attempts: prev.attempts + 1,
        score: Number((prev.score + resultScore).toFixed(2)),
      };
      return s;
    });
  }

  function nextQuestion() {
    idx += 1;
    asked += 1;
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
      const totalAnswered = Math.max(asked, 1);
      const accuracy = Math.round((score / totalAnswered) * 100);
      root.innerHTML = `<div class="card"><h3>Fill-Blank Complete</h3><p>Score: ${score.toFixed(2)}/${asked}</p><p>Accuracy: ${accuracy}%</p></div>`;
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
        <p id="fb-feedback" class="muted" aria-live="polite"></p>
        <button id="fb-next" class="hidden" type="button">Next</button>
      </div>
    `;

    const answerEl = document.getElementById('fb-answer');
    const feedbackEl = document.getElementById('fb-feedback');
    const nextBtn = document.getElementById('fb-next');

    function lockAndShow(userAnswer) {
      const evalResult = evaluateFillBlank(userAnswer, item.answer, item.synonyms || []);
      score += evalResult.score;
      if (evalResult.score < 0.75) missed.push(item);

      if (evalResult.status === 'exact') feedbackEl.textContent = `Correct. ${item.explanation || ''}`;
      else if (evalResult.status === 'close') feedbackEl.textContent = `Close enough (+0.75). Expected: ${item.answer}. ${item.explanation || ''}`;
      else if (evalResult.status === 'partial') feedbackEl.textContent = `Partial credit (+0.5). Expected: ${item.answer}. ${item.explanation || ''}`;
      else feedbackEl.textContent = `Not quite. Answer: ${item.answer}. ${item.explanation || ''}`;

      record(item.id, evalResult.score);
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
