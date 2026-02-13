import { normalizeText } from './utils.js';

export function renderFillBlank(root, deck) {
  const items = deck?.modes?.fillBlank || [];
  if (!items.length) {
    root.innerHTML = '<div class="card"><p>No fill-in-the-blank items for this deck.</p></div>';
    return;
  }

  let idx = 0;
  const missed = [];
  let score = 0;
  let hintStep = 0;

  function nextQuestion() {
    idx += 1;
    hintStep = 0;
    if (idx >= items.length && missed.length) {
      items.push(...missed.splice(0));
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
    const item = items[idx];
    if (!item) {
      const accuracy = items.length ? Math.round((score / items.length) * 100) : 0;
      root.innerHTML = `<div class="card"><h3>Fill-Blank Complete</h3><p>Score: ${score}/${items.length}</p><p>Accuracy: ${accuracy}%</p></div>`;
      return;
    }

    root.innerHTML = `
      <div class="card">
        <h3>${deck.title} • Fill in the Blank</h3>
        <p><strong>Q ${idx + 1}/${items.length}</strong></p>
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
